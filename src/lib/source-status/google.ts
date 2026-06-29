import { prisma } from "@/lib/prisma";

export interface GoogleSourceAccountStatus {
  id: string;
  email: string;
  needsReconnect: boolean;
  lastSyncedAt: string | null;
  lastRefreshError: string | null;
}

export interface GoogleSourceStatus {
  accounts: GoogleSourceAccountStatus[];
  hasGoogleOAuth: boolean;
  needsReconnect: boolean;
}

export async function getGoogleSourceStatus(
  userId: string,
): Promise<GoogleSourceStatus> {
  const [user, syncState, accounts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    }),
    prisma.gmailSyncState.findUnique({
      where: { userId },
      select: { additionalUserEmails: true },
    }),
    prisma.account.findMany({
      where: { userId, provider: "google" },
      select: {
        id: true,
        access_token: true,
        id_token: true,
        needsReconnect: true,
        lastRefreshAt: true,
        lastRefreshError: true,
      },
    }),
  ]);

  const fallbackEmails = [
    user?.email,
    ...(syncState?.additionalUserEmails ?? []),
  ].filter((email): email is string => Boolean(email));

  const connectedAccounts = accounts.filter((account) => !!account.access_token);
  const accountStatuses = connectedAccounts.map((account, index) => ({
    id: account.id,
    email: extractEmailFromIdToken(account.id_token) ?? fallbackEmails[index] ?? `Account ${index + 1}`,
    needsReconnect: account.needsReconnect,
    lastSyncedAt: account.lastRefreshAt?.toISOString() ?? null,
    lastRefreshError: account.lastRefreshError,
  }));

  return {
    accounts: accountStatuses,
    hasGoogleOAuth: connectedAccounts.length > 0,
    needsReconnect: accountStatuses.some((account) => account.needsReconnect),
  };
}

function extractEmailFromIdToken(idToken: string | null): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1] ?? "", "base64").toString(),
    );
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}
