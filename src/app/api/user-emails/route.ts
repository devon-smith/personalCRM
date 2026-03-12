import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** GET — List user's additional email addresses */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const syncState = await prisma.gmailSyncState.findUnique({
    where: { userId: session.user.id },
    select: { additionalUserEmails: true },
  });

  return NextResponse.json({
    primaryEmail: session.user.email ?? null,
    additionalEmails: syncState?.additionalUserEmails ?? [],
  });
}

/** POST — Add an additional email address */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const email = (body.email as string)?.trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  // Ensure sync state exists
  const syncState = await prisma.gmailSyncState.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, additionalUserEmails: [email] },
    update: {},
    select: { additionalUserEmails: true },
  });

  // Deduplicate
  const existing = new Set(syncState.additionalUserEmails.map((e) => e.toLowerCase()));
  if (existing.has(email)) {
    return NextResponse.json({ additionalEmails: syncState.additionalUserEmails });
  }

  const updated = await prisma.gmailSyncState.update({
    where: { userId: session.user.id },
    data: { additionalUserEmails: { push: email } },
    select: { additionalUserEmails: true },
  });

  return NextResponse.json({ additionalEmails: updated.additionalUserEmails });
}

/** DELETE — Remove an additional email address */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const email = (body.email as string)?.trim().toLowerCase();

  if (!email) {
    return NextResponse.json({ error: "Email required" }, { status: 400 });
  }

  const syncState = await prisma.gmailSyncState.findUnique({
    where: { userId: session.user.id },
    select: { additionalUserEmails: true },
  });

  if (!syncState) {
    return NextResponse.json({ additionalEmails: [] });
  }

  const filtered = syncState.additionalUserEmails.filter(
    (e) => e.toLowerCase() !== email,
  );

  const updated = await prisma.gmailSyncState.update({
    where: { userId: session.user.id },
    data: { additionalUserEmails: filtered },
    select: { additionalUserEmails: true },
  });

  return NextResponse.json({ additionalEmails: updated.additionalUserEmails });
}
