import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAllGoogleAccessTokens } from "@/lib/gmail/client";
import { checkIMessageAccess } from "@/lib/imessage";

/**
 * GET /api/health
 *
 * Returns the health status of all data sources and sync states.
 * Used by the dashboard to show alerts when re-auth is needed.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Check Google accounts
  const googleAccounts = await prisma.account.findMany({
    where: { userId, provider: "google" },
    select: {
      id: true,
      providerAccountId: true,
      access_token: true,
      refresh_token: true,
      expires_at: true,
    },
  });

  let gmailStatus: "connected" | "expired" | "disconnected" = "disconnected";
  let gmailError: string | null = null;

  if (googleAccounts.length === 0) {
    gmailStatus = "disconnected";
    gmailError = "No Google account connected.";
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

  // Check iMessage access
  const imessageError = checkIMessageAccess();
  const imessageStatus = imessageError ? "unavailable" : "connected";

  // Get sync timestamps
  const [gmailSync, notionSync, imessageSyncCount] = await Promise.all([
    prisma.gmailSyncState.findUnique({
      where: { userId },
      select: { lastSyncAt: true, syncEnabled: true },
    }),
    prisma.notionSyncState.findUnique({
      where: { userId },
      select: { lastSyncAt: true },
    }),
    prisma.iMessageSyncState.count({ where: { userId } }),
  ]);

  // Count interactions by source prefix
  const [totalInteractions, imsgCount, notionCount, gmailCount] =
    await Promise.all([
      prisma.interaction.count({ where: { userId } }),
      prisma.interaction.count({
        where: { userId, sourceId: { startsWith: "imsg" } },
      }),
      prisma.interaction.count({
        where: { userId, sourceId: { startsWith: "notion:" } },
      }),
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

  return NextResponse.json({
    gmail: {
      status: gmailStatus,
      error: gmailError,
      accountCount: googleAccounts.length,
      lastSyncAt: gmailSync?.lastSyncAt ?? null,
      syncEnabled: gmailSync?.syncEnabled ?? false,
    },
    imessage: {
      status: imessageStatus,
      error: imessageError,
      handlesTracked: imessageSyncCount,
    },
    notion: {
      status: notionSync ? "configured" : "not_configured",
      lastSyncAt: notionSync?.lastSyncAt ?? null,
    },
    interactions: {
      total: totalInteractions,
      imessage: imsgCount,
      notion: notionCount,
      gmail: gmailCount,
    },
    contacts: {
      csvImported: csvContacts,
      csvNoInteractions: csvContactsNoInteractions,
    },
    cleanup: {
      oldSummaryInteractions,
    },
  });
}
