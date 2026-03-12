import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export interface GoogleAccountInfo {
  id: string;
  email: string;
  hasGmail: boolean;
  hasCalendar: boolean;
  hasContacts: boolean;
}

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
  googleAccounts: GoogleAccountInfo[];
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

  // Check ALL linked Google accounts for tokens and scopes
  const googleAccounts = await prisma.account.findMany({
    where: { userId, provider: "google" },
    select: { id: true, access_token: true, scope: true, id_token: true },
  });

  const hasGoogleOAuth = googleAccounts.some((a) => !!a.access_token);

  const hasGmailScope = googleAccounts.some(
    (a) => a.access_token && (!a.scope || a.scope.includes("gmail.readonly")),
  );
  const hasContactsScope = googleAccounts.some(
    (a) => a.access_token && (!a.scope || a.scope.includes("contacts.readonly")),
  );
  const hasCalendarScope = googleAccounts.some(
    (a) => a.access_token && (!a.scope || a.scope.includes("calendar.readonly")),
  );

  // Build per-account info with email extracted from id_token
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  const syncState = await prisma.gmailSyncState.findUnique({
    where: { userId },
  });

  const allUserEmails = [
    user?.email,
    ...(syncState?.additionalUserEmails ?? []),
  ].filter((e): e is string => !!e);

  // Map accounts to emails by decoding id_token JWT payload
  const accountInfos: GoogleAccountInfo[] = googleAccounts
    .filter((a) => !!a.access_token)
    .map((a, idx) => {
      let email = allUserEmails[idx] ?? `Account ${idx + 1}`;
      // Try to extract email from id_token (JWT payload)
      if (a.id_token) {
        try {
          const payload = JSON.parse(
            Buffer.from(a.id_token.split(".")[1], "base64").toString(),
          );
          if (payload.email) email = payload.email;
        } catch {
          // ignore decode errors
        }
      }
      return {
        id: a.id,
        email,
        hasGmail: !a.scope || a.scope.includes("gmail.readonly"),
        hasCalendar: !a.scope || a.scope.includes("calendar.readonly"),
        hasContacts: !a.scope || a.scope.includes("contacts.readonly"),
      };
    });

  // Run data queries in parallel
  const [
    totalContacts,
    importedContacts,
    contactsWithEmail,
    contactsWithPhone,
    contactsWithPhoto,
    contactsWithZeroInteractions,
    emailInteractionCount,
    meetingInteractionCount,
    lastCalendarSync,
    imessageInteractionCount,
    lastImessageSync,
    appleContactCount,
    lastAppleSync,
    linkedinContactCount,
  ] = await Promise.all([
    prisma.contact.count({ where: { userId } }),

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
      where: { userId, interactions: { none: {} } },
      select: { id: true, name: true, email: true, company: true },
      orderBy: { name: "asc" },
      take: 30,
    }),

    prisma.interaction.count({
      where: { userId, type: "EMAIL" },
    }),

    prisma.interaction.count({
      where: { userId, type: "MEETING", sourceId: { startsWith: "cal:" } },
    }),

    prisma.interaction.findFirst({
      where: { userId, type: "MEETING", sourceId: { startsWith: "cal:" } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),

    prisma.interaction.count({
      where: { userId, type: "MESSAGE", sourceId: { startsWith: "imsg:" } },
    }),

    prisma.interaction.findFirst({
      where: { userId, type: "MESSAGE", sourceId: { startsWith: "imsg:" } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),

    prisma.contact.count({
      where: { userId, source: "APPLE_CONTACTS" },
    }),

    prisma.contact.findFirst({
      where: { userId, source: "APPLE_CONTACTS" },
      orderBy: { importedAt: "desc" },
      select: { importedAt: true },
    }),

    prisma.contact.count({
      where: { userId, source: "LINKEDIN" },
    }),
  ]);

  // ─── Data Sources ───

  const sources: DataSource[] = [
    {
      name: "Gmail",
      key: "gmail",
      status: hasGoogleOAuth && hasGmailScope
        ? syncState?.syncEnabled ? "connected" : "available"
        : hasGoogleOAuth ? "available" : "coming_soon",
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
        ? meetingInteractionCount > 0 ? "connected" : "available"
        : hasGoogleOAuth ? "available" : "coming_soon",
      lastSync: lastCalendarSync?.createdAt?.toISOString() ?? null,
      captured: meetingInteractionCount > 0
        ? `${meetingInteractionCount} meetings synced`
        : "Not synced yet",
      canSync: hasGoogleOAuth && hasCalendarScope,
    },
    {
      name: "Google Contacts",
      key: "google-contacts",
      status: hasGoogleOAuth && hasContactsScope
        ? syncState?.contactsImported ? "connected" : "available"
        : hasGoogleOAuth ? "available" : "coming_soon",
      lastSync: syncState?.contactsImported
        ? syncState.updatedAt.toISOString()
        : null,
      captured: syncState?.contactsImported
        ? `${importedContacts} imported`
        : "Not imported yet",
      canSync: hasGoogleOAuth && hasContactsScope,
    },
    {
      name: "Apple Contacts",
      key: "apple-contacts",
      status: appleContactCount > 0 ? "connected" : "available",
      lastSync: lastAppleSync?.importedAt?.toISOString() ?? null,
      captured: appleContactCount > 0
        ? `${appleContactCount} imported`
        : "Not imported yet",
      canSync: true,
    },
    {
      name: "iMessage",
      key: "imessage",
      status: imessageInteractionCount > 0 ? "connected" : "available",
      lastSync: lastImessageSync?.createdAt?.toISOString() ?? null,
      captured: imessageInteractionCount > 0
        ? `${imessageInteractionCount} conversations synced`
        : "Not synced yet",
      canSync: true,
    },
    {
      name: "LinkedIn",
      key: "linkedin",
      status: linkedinContactCount > 0 ? "connected" : "available",
      lastSync: null,
      captured: linkedinContactCount > 0
        ? `${linkedinContactCount} imported`
        : "Not imported yet",
      canSync: true,
    },
  ];

  // ─── Coverage Stats ───

  const coverage: CoverageStat[] = [
    { label: "contacts have email addresses", current: contactsWithEmail, total: totalContacts, key: "email" },
    { label: "contacts have phone numbers", current: contactsWithPhone, total: totalContacts, key: "phone" },
    { label: "contacts have photos", current: contactsWithPhoto, total: totalContacts, key: "photo" },
    { label: "contacts have interactions", current: totalContacts - contactsWithZeroInteractions.length, total: totalContacts, key: "interactions" },
  ];

  // ─── Gap Analysis ───

  const rawSenders = (syncState?.unmatchedSenders ?? []) as Array<{ email: string; count: number }>;
  const allContactEmails = await prisma.contact.findMany({
    where: { userId, email: { not: null } },
    select: { email: true },
  });
  const knownEmails = new Set(allContactEmails.map((c) => c.email!.toLowerCase()));
  const unmatchedSenders = rawSenders.filter((s) => !knownEmails.has(s.email.toLowerCase()));

  return NextResponse.json({
    sources,
    googleAccounts: accountInfos,
    coverage,
    zeroInteractionContacts: contactsWithZeroInteractions,
    unmatchedSenders: unmatchedSenders.slice(0, 10),
    hasGoogleOAuth,
  } satisfies DataHealthResponse);
}
