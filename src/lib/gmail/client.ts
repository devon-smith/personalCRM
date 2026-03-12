import { prisma } from "@/lib/prisma";

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

/**
 * Get a valid Google access token for a user.
 * Automatically refreshes if expired.
 */
export async function getGoogleAccessToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });

  if (!account?.access_token) return null;

  // Check if token is expired (with 5 min buffer)
  const isExpired =
    account.expires_at != null &&
    account.expires_at * 1000 < Date.now() + 5 * 60 * 1000;

  if (!isExpired) {
    return account.access_token;
  }

  // Refresh the token
  if (!account.refresh_token) return null;

  const refreshed = await refreshGoogleToken(account.refresh_token);
  if (!refreshed) return null;

  // Update stored token
  await prisma.account.update({
    where: { id: account.id },
    data: {
      access_token: refreshed.access_token,
      expires_at: Math.floor(Date.now() / 1000) + refreshed.expires_in,
    },
  });

  return refreshed.access_token;
}

async function refreshGoogleToken(
  refreshToken: string,
): Promise<TokenResponse | null> {
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!res.ok) {
      console.error("Google token refresh failed:", res.status, await res.text());
      return null;
    }

    return (await res.json()) as TokenResponse;
  } catch (error) {
    console.error("Google token refresh error:", error);
    return null;
  }
}

/**
 * Get valid access tokens for ALL linked Google accounts.
 * Returns an array of { accountId, token, email } for each account.
 */
export async function getAllGoogleAccessTokens(
  userId: string,
): Promise<Array<{ accountId: string; token: string }>> {
  const accounts = await prisma.account.findMany({
    where: { userId, provider: "google" },
  });

  const results: Array<{ accountId: string; token: string }> = [];

  for (const account of accounts) {
    if (!account.access_token) continue;

    const isExpired =
      account.expires_at != null &&
      account.expires_at * 1000 < Date.now() + 5 * 60 * 1000;

    if (!isExpired) {
      results.push({ accountId: account.id, token: account.access_token });
      continue;
    }

    if (!account.refresh_token) continue;

    const refreshed = await refreshGoogleToken(account.refresh_token);
    if (!refreshed) continue;

    await prisma.account.update({
      where: { id: account.id },
      data: {
        access_token: refreshed.access_token,
        expires_at: Math.floor(Date.now() / 1000) + refreshed.expires_in,
      },
    });

    results.push({ accountId: account.id, token: refreshed.access_token });
  }

  return results;
}

/**
 * Make an authenticated request to a Google API.
 */
export async function googleFetch(
  userId: string,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getGoogleAccessToken(userId);
  if (!token) {
    throw new Error("No valid Google access token. User may need to reconnect.");
  }

  return fetch(url, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });
}
