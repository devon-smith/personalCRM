import { prisma } from "@/lib/prisma";
import { logProviderCall } from "@/lib/provider-call-log";
import { incrementProviderCall } from "@/lib/sync/provider-call-counter";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  refresh_token?: string;
}

type RefreshResult =
  | { ok: true; data: TokenResponse }
  | { ok: false; kind: "terminal"; error: string; status?: number }
  | { ok: false; kind: "transient"; error: string; status?: number };

export interface GoogleProviderCallTelemetry {
  userId?: string | null;
  service: "gmail" | "calendar" | "people" | "oauth";
  operation: string;
  feature: string;
  metadata?: Record<string, unknown>;
}

const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const TERMINAL_OAUTH_ERRORS = new Set([
  "invalid_grant",
  "invalid_client",
  "unauthorized_client",
]);

// In-process per-account serialization. For a single-process deployment this
// prevents two concurrent callers from racing the same refresh_token. In a
// multi-instance deployment a Postgres advisory lock would be needed; defer
// that until we see real evidence of cross-instance races.
const refreshInFlight = new Map<string, Promise<string | null>>();

/**
 * Get a valid Google access token for a user.
 * Automatically refreshes if expired. Returns null when the account needs
 * user reconsent — caller surfaces the Reconnect banner.
 */
export async function getGoogleAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });
  if (!account) return null;
  return resolveAccessToken(account);
}

/**
 * Get valid access tokens for ALL linked Google accounts. Accounts flagged
 * as needsReconnect are skipped (no refresh attempts).
 */
export async function getAllGoogleAccessTokens(
  userId: string,
): Promise<Array<{ accountId: string; token: string }>> {
  const accounts = await prisma.account.findMany({
    where: { userId, provider: "google" },
  });

  const results = await Promise.all(
    accounts.map(async (account) => {
      const token = await resolveAccessToken(account);
      return token ? { accountId: account.id, token } : null;
    }),
  );

  return results.filter((r): r is { accountId: string; token: string } => r !== null);
}

async function resolveAccessToken(
  account: { id: string; userId: string; access_token: string | null; refresh_token: string | null; expires_at: number | null; needsReconnect: boolean },
): Promise<string | null> {
  if (account.needsReconnect) return null;
  if (!account.access_token) return null;

  const isExpired =
    account.expires_at != null &&
    account.expires_at * 1000 < Date.now() + 5 * 60 * 1000;

  if (!isExpired) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    await markNeedsReconnect(account.id, account.userId, "missing_refresh_token");
    return null;
  }

  // Serialize concurrent refreshes for the same account.
  const existing = refreshInFlight.get(account.id);
  if (existing) return existing;

  const promise = doRefresh(account.id, account.userId, account.refresh_token);
  refreshInFlight.set(account.id, promise);
  try {
    return await promise;
  } finally {
    refreshInFlight.delete(account.id);
  }
}

async function doRefresh(
  accountId: string,
  userId: string,
  refreshToken: string,
): Promise<string | null> {
  const result = await refreshWithBackoff(refreshToken, { userId, accountId });

  if (result.ok) {
    await prisma.account.update({
      where: { id: accountId },
      data: {
        access_token: result.data.access_token,
        expires_at: Math.floor(Date.now() / 1000) + result.data.expires_in,
        // Preserve existing refresh_token unless Google rotated and sent a new one.
        ...(result.data.refresh_token
          ? { refresh_token: result.data.refresh_token }
          : {}),
        lastRefreshAt: new Date(),
        lastRefreshError: null,
        needsReconnect: false,
      },
    });
    await logSync(userId, accountId, "refresh_success", null);
    return result.data.access_token;
  }

  if (result.kind === "terminal") {
    await markNeedsReconnect(accountId, userId, result.error, result.status);
    return null;
  }

  // Transient failure exhausted retries — record but don't mark needsReconnect.
  await prisma.account.update({
    where: { id: accountId },
    data: {
      lastRefreshAt: new Date(),
      lastRefreshError: `transient: ${result.error}`,
    },
  });
  await logSync(userId, accountId, "refresh_transient", result.error, {
    status: result.status,
  });
  return null;
}

async function refreshWithBackoff(
  refreshToken: string,
  telemetry: { userId: string; accountId: string },
): Promise<RefreshResult> {
  const delays = [0, 1000, 2000, 4000];
  let last: RefreshResult = { ok: false, kind: "transient", error: "no_attempt" };

  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt] > 0) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
    last = await refreshGoogleToken(refreshToken, {
      ...telemetry,
      attempt: attempt + 1,
    });
    if (last.ok) return last;
    if (last.kind === "terminal") return last;
  }
  return last;
}

/**
 * Classify a Google token endpoint failure as terminal (needs reconsent) or
 * transient (retryable). Exported for unit testing.
 */
export function classifyRefreshFailure(
  status: number,
  bodyText: string,
): { kind: "terminal" | "transient"; error: string; status: number } {
  let errorCode = "unknown";
  try {
    const parsed = JSON.parse(bodyText) as { error?: string };
    if (parsed.error) errorCode = parsed.error;
  } catch {
    // body not JSON
  }

  if (TERMINAL_OAUTH_ERRORS.has(errorCode)) {
    return { kind: "terminal", error: errorCode, status };
  }
  if (TRANSIENT_HTTP_STATUSES.has(status)) {
    return { kind: "transient", error: errorCode, status };
  }
  // Unknown 4xx — treat as terminal so we don't hammer Google.
  if (status >= 400 && status < 500) {
    return { kind: "terminal", error: errorCode, status };
  }
  return { kind: "transient", error: errorCode, status };
}

async function refreshGoogleToken(
  refreshToken: string,
  telemetry: { userId: string; accountId: string; attempt: number },
): Promise<RefreshResult> {
  let res: Response;
  const startedAt = Date.now();
  try {
    incrementProviderCall("google");
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch (error) {
    await logGoogleProviderCall({
      userId: telemetry.userId,
      service: "oauth",
      operation: "oauth.token.refresh",
      feature: "google_token_refresh",
      startedAt,
      ok: false,
      error: error instanceof Error ? error.message : "network_error",
      metadata: {
        accountId: telemetry.accountId,
        attempt: telemetry.attempt,
      },
    });
    return {
      ok: false,
      kind: "transient",
      error: error instanceof Error ? error.message : "network_error",
    };
  }

  if (res.ok) {
    await logGoogleProviderCall({
      userId: telemetry.userId,
      service: "oauth",
      operation: "oauth.token.refresh",
      feature: "google_token_refresh",
      startedAt,
      ok: true,
      metadata: {
        accountId: telemetry.accountId,
        attempt: telemetry.attempt,
        httpStatus: res.status,
      },
    });
    const data = (await res.json()) as TokenResponse;
    return { ok: true, data };
  }

  const bodyText = await res.text();
  const classified = classifyRefreshFailure(res.status, bodyText);
  await logGoogleProviderCall({
    userId: telemetry.userId,
    service: "oauth",
    operation: "oauth.token.refresh",
    feature: "google_token_refresh",
    startedAt,
    ok: false,
    error: classified.error,
    metadata: {
      accountId: telemetry.accountId,
      attempt: telemetry.attempt,
      httpStatus: res.status,
      failureKind: classified.kind,
    },
  });
  return { ok: false, ...classified };
}

async function markNeedsReconnect(
  accountId: string,
  userId: string,
  reason: string,
  status?: number,
): Promise<void> {
  await prisma.account.update({
    where: { id: accountId },
    data: {
      needsReconnect: true,
      lastRefreshAt: new Date(),
      lastRefreshError: `terminal: ${reason}`,
    },
  });
  await logSync(userId, accountId, "refresh_terminal", reason, { status });
}

async function logSync(
  userId: string,
  accountId: string | null,
  kind: string,
  message: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.syncLog.create({
      data: {
        userId,
        accountId,
        kind,
        message,
        metadata: metadata ? (metadata as object) : undefined,
      },
    });
  } catch (err) {
    // Logging must never break the caller.
    console.error("SyncLog write failed:", err);
  }
}

/**
 * Make an authenticated fetch using a pre-resolved token.
 */
export function googleFetchWithToken(
  token: string,
  url: string,
  init?: RequestInit,
  telemetry?: GoogleProviderCallTelemetry,
): Promise<Response> {
  incrementProviderCall("google");
  return fetchGoogleWithTelemetry(token, url, init, telemetry);
}

/**
 * Make an authenticated request to a Google API.
 * Uses the first available Google account for the user.
 */
export async function googleFetch(
  userId: string,
  url: string,
  init?: RequestInit,
  telemetry?: Omit<GoogleProviderCallTelemetry, "userId">,
): Promise<Response> {
  const token = await getGoogleAccessToken(userId);
  if (!token) {
    throw new Error("No valid Google access token. User may need to reconnect.");
  }

  return googleFetchWithToken(
    token,
    url,
    init,
    telemetry ? { ...telemetry, userId } : undefined,
  );
}

async function fetchGoogleWithTelemetry(
  token: string,
  url: string,
  init?: RequestInit,
  telemetry?: GoogleProviderCallTelemetry,
): Promise<Response> {
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${token}`,
      },
    });
    if (telemetry) {
      await logGoogleProviderCall({
        ...telemetry,
        startedAt,
        ok: res.ok,
        error: res.ok ? undefined : `http_${res.status}`,
        metadata: {
          ...telemetry.metadata,
          httpStatus: res.status,
        },
      });
    }
    return res;
  } catch (error) {
    if (telemetry) {
      await logGoogleProviderCall({
        ...telemetry,
        startedAt,
        ok: false,
        error: error instanceof Error ? error.message : "network_error",
      });
    }
    throw error;
  }
}

async function logGoogleProviderCall(input: GoogleProviderCallTelemetry & {
  startedAt: number;
  ok: boolean;
  error?: string;
}): Promise<void> {
  await logProviderCall({
    userId: input.userId,
    provider: "google",
    service: input.service,
    operation: input.operation,
    feature: input.feature,
    status: input.ok ? "success" : "error",
    latencyMs: Date.now() - input.startedAt,
    error: input.error ?? null,
    metadata: input.metadata ?? null,
  });
}
