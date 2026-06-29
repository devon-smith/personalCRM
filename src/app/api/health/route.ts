import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAllGoogleAccessTokens } from "@/lib/gmail/client";
import { noStoreHeaders, privateCacheHeaders } from "@/lib/http/cache";

/**
 * GET /api/health
 *
 * Returns the health status of all data sources and sync states.
 * Used by the dashboard to show alerts when re-auth is needed.
 *
 * By default this stays DB-only. Pass ?live=1 when debugging if you
 * want to spend a Gmail profile request to verify that a token works.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const liveCheck =
    new URL(request.url).searchParams.get("live") === "1";

  // Check Google accounts without materializing OAuth tokens in the
  // DB-only health path. Live checks below deliberately resolve tokens
  // through the Google client.
  const [googleAccounts, usableGoogleAccountCount] = await Promise.all([
    prisma.account.findMany({
      where: { userId, provider: "google" },
      select: {
        id: true,
        providerAccountId: true,
        expires_at: true,
        needsReconnect: true,
        lastRefreshError: true,
      },
    }),
    prisma.account.count({
      where: {
        userId,
        provider: "google",
        access_token: { not: null },
        needsReconnect: false,
      },
    }),
  ]);

  let gmailStatus: "connected" | "expired" | "disconnected" = "disconnected";
  let gmailError: string | null = null;

  if (googleAccounts.length === 0) {
    gmailStatus = "disconnected";
    gmailError = "No Google account connected.";
  } else if (!liveCheck) {
    if (usableGoogleAccountCount > 0) {
      gmailStatus = "connected";
    } else {
      gmailStatus = "expired";
      gmailError =
        googleAccounts.find((account) => account.lastRefreshError)
          ?.lastRefreshError ??
        "Google token expired. Re-connect your account to resume email sync.";
    }
  } else {
    // Try to get valid tokens
    const tokens = await getAllGoogleAccessTokens(userId);
    if (tokens.length === 0) {
      gmailStatus = "expired";
      gmailError =
        "Google token expired. Re-connect your account to resume email sync.";
    } else {
      // Verify at least one token works with a lightweight API call
      let anyWorking = false;
      let lastStatus = 0;
      for (const { token } of tokens) {
        try {
          const res = await fetch(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (res.ok) {
            anyWorking = true;
            break;
          }
          lastStatus = res.status;
        } catch {
          // Try next token
        }
      }

      if (anyWorking) {
        gmailStatus = "connected";
      } else {
        gmailStatus = "expired";
        gmailError = `Gmail API returned ${lastStatus}. Re-connect your account.`;
      }
    }
  }

  // Get sync timestamps
  const gmailSync = await prisma.gmailSyncState.findUnique({
    where: { userId },
    select: { lastSyncAt: true, syncEnabled: true },
  });

  // Count interactions by source prefix
  const [totalInteractions, gmailCount] =
    await Promise.all([
      prisma.interaction.count({ where: { userId } }),
      prisma.interaction.count({
        where: {
          userId,
          type: "EMAIL",
        },
      }),
    ]);

  // Count contacts by source
  const csvContacts = await prisma.contact.count({
    where: { userId, source: "CSV_IMPORT" },
  });

  // Count contacts from CSV that have zero interactions
  const csvContactsNoInteractions = await prisma.contact.count({
    where: {
      userId,
      source: "CSV_IMPORT",
      interactions: { none: {} },
    },
  });

  // Count old daily summary interactions (boilerplate, no real content)
  const oldSummaryInteractions = await prisma.interaction.count({
    where: {
      userId,
      type: "MESSAGE",
      OR: [
        { summary: { contains: "messages (" } },
        { summary: { contains: "message (" } },
      ],
    },
  });

  return NextResponse.json(
    {
      gmail: {
        status: gmailStatus,
        error: gmailError,
        accountCount: googleAccounts.length,
        lastSyncAt: gmailSync?.lastSyncAt ?? null,
        syncEnabled: gmailSync?.syncEnabled ?? false,
      },
      interactions: {
        total: totalInteractions,
        gmail: gmailCount,
      },
      contacts: {
        csvImported: csvContacts,
        csvNoInteractions: csvContactsNoInteractions,
      },
      cleanup: {
        oldSummaryInteractions,
      },
    },
    {
      headers: liveCheck
        ? noStoreHeaders
        : privateCacheHeaders(60, 5 * 60),
    },
  );
}
