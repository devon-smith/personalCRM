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
        providerAccountId: true,
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

  const accountStatuses = accounts.map((account, index) => ({
    id: account.id,
    email: fallbackEmails[index] ?? `Google account ${account.providerAccountId}`,
    needsReconnect: account.needsReconnect,
    lastSyncedAt: account.lastRefreshAt?.toISOString() ?? null,
    lastRefreshError: account.lastRefreshError,
  }));

  return {
    accounts: accountStatuses,
    hasGoogleOAuth: accounts.length > 0,
    needsReconnect: accountStatuses.some((account) => account.needsReconnect),
  };
}
