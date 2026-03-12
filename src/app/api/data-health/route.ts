import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface DataSource {
  name: string;
  key: string;
  status: "connected" | "available" | "coming_soon";
  lastSync: string | null;
  captured: string;
  canSync: boolean;
}

export interface CoverageStat {
  label: string;
  current: number;
  total: number;
  key: string;
}

export interface UnmatchedSender {
  email: string;
  count: number;
}

export interface ZeroInteractionContact {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
}

export interface DataHealthResponse {
  sources: DataSource[];
  coverage: CoverageStat[];
  zeroInteractionContacts: ZeroInteractionContact[];
  unmatchedSenders: UnmatchedSender[];
  hasGoogleOAuth: boolean;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  // Check if Google OAuth is actually connected by looking for a real account
  // with an access token — not just any account record
  const googleAccount = await prisma.account.findFirst({
    where: { userId, provider: "google" },
    select: { id: true, access_token: true, scope: true },
  });

  const hasGoogleOAuth = !!googleAccount?.access_token;
  const grantedScopes = googleAccount?.scope ?? "";
  const hasGmailScope = grantedScopes.includes("gmail.readonly");
  const hasContactsScope = grantedScopes.includes("contacts.readonly");
  const hasCalendarScope = grantedScopes.includes("calendar.readonly");

  // Run data queries in parallel
  const [
    syncState,
    totalContacts,
    importedContacts,
    contactsWithEmail,
    contactsWithPhone,
    contactsWithPhoto,
    contactsWithZeroInteractions,
    emailInteractionCount,
    meetingInteractionCount,
    imessageInteractionCount,
  ] = await Promise.all([
    prisma.gmailSyncState.findUnique({ where: { userId } }),

    prisma.contact.count({ where: { userId } }),

    // Only count contacts that were actually imported from Google
    prisma.contact.count({
      where: { userId, importedAt: { not: null } },
    }),

    prisma.contact.count({
      where: { userId, email: { not: null } },
    }),

    prisma.contact.count({
      where: { userId, phone: { not: null } },
    }),

    prisma.contact.count({
      where: { userId, avatarUrl: { not: null } },
    }),

    prisma.contact.findMany({
      where: {
        userId,
        interactions: { none: {} },
      },
      select: {
        id: true,
        name: true,
        email: true,
        company: true,
      },
      orderBy: { name: "asc" },
      take: 30,
    }),

    prisma.interaction.count({
      where: { userId, type: "EMAIL" },
    }),

    prisma.interaction.count({
      where: { userId, type: "MEETING", sourceId: { startsWith: "cal:" } },
    }),

    prisma.interaction.count({
      where: { userId, type: "MESSAGE", sourceId: { startsWith: "imsg:" } },
    }),
  ]);

  // ─── Data Sources (honest status) ───

  const sources: DataSource[] = [
    {
      name: "Google Contacts",
      key: "google-contacts",
      status: hasGoogleOAuth && hasContactsScope
        ? syncState?.contactsImported
          ? "connected"
          : "available"
        : hasGoogleOAuth
          ? "available" // OAuth exists but missing scope
          : "coming_soon", // not labeled "coming soon" — just needs setup
      lastSync: syncState?.contactsImported
        ? syncState.updatedAt.toISOString()
        : null,
      captured: syncState?.contactsImported
        ? `${importedContacts} imported`
        : "Not imported yet",
      canSync: hasGoogleOAuth && hasContactsScope,
    },
    {
      name: "Gmail",
      key: "gmail",
      status: hasGoogleOAuth && hasGmailScope
        ? syncState?.syncEnabled
          ? "connected"
          : "available"
        : hasGoogleOAuth
          ? "available"
          : "coming_soon",
      lastSync: syncState?.lastSyncAt?.toISOString() ?? null,
      captured: emailInteractionCount > 0
        ? `${emailInteractionCount} emails matched`
        : "No emails synced yet",
      canSync: hasGoogleOAuth && hasGmailScope,
    },
    {
      name: "Google Calendar",
      key: "google-calendar",
      status: hasGoogleOAuth && hasCalendarScope
        ? meetingInteractionCount > 0
          ? "connected"
          : "available"
        : hasGoogleOAuth
          ? "available"
          : "coming_soon",
      lastSync: null,
      captured: meetingInteractionCount > 0
        ? `${meetingInteractionCount} meetings synced`
        : "Not synced yet",
      canSync: hasGoogleOAuth && hasCalendarScope,
    },
    {
      name: "iMessage",
      key: "imessage",
      status: imessageInteractionCount > 0 ? "connected" : "available",
      lastSync: null,
      captured: imessageInteractionCount > 0
        ? `${imessageInteractionCount} messages synced`
        : "Not synced yet",
      canSync: true,
    },
  ];

  // ─── Coverage Stats ───

  const coverage: CoverageStat[] = [
    {
      label: "contacts have email addresses",
      current: contactsWithEmail,
      total: totalContacts,
      key: "email",
    },
    {
      label: "contacts have phone numbers",
      current: contactsWithPhone,
      total: totalContacts,
      key: "phone",
    },
    {
      label: "contacts have photos",
      current: contactsWithPhoto,
      total: totalContacts,
      key: "photo",
    },
    {
      label: "contacts have interactions",
      current: totalContacts - contactsWithZeroInteractions.length,
      total: totalContacts,
      key: "interactions",
    },
  ];

  // ─── Gap Analysis: Unmatched Senders from Gmail Sync ───

  const rawSenders = (syncState?.unmatchedSenders ?? []) as Array<{
    email: string;
    count: number;
  }>;

  // Filter out senders who have since been added as contacts
  const allContactEmails = await prisma.contact.findMany({
    where: { userId, email: { not: null } },
    select: { email: true },
  });
  const knownEmails = new Set(
    allContactEmails.map((c) => c.email!.toLowerCase()),
  );
  const unmatchedSenders = rawSenders.filter(
    (s) => !knownEmails.has(s.email.toLowerCase()),
  );

  return NextResponse.json({
    sources,
    coverage,
    zeroInteractionContacts: contactsWithZeroInteractions,
    unmatchedSenders: unmatchedSenders.slice(0, 10),
    hasGoogleOAuth,
  } satisfies DataHealthResponse);
}
