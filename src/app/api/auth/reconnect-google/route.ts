import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * DELETE — Remove the user's Google account link so re-signing in
 * creates a fresh OAuth connection with all scopes and a new token.
 */
export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.account.deleteMany({
    where: {
      userId: session.user.id,
      provider: "google",
    },
  });

  return NextResponse.json({ ok: true });
}
