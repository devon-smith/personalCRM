import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getPendingChangelog } from "@/lib/changelog";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entries = await getPendingChangelog(session.user.id);
  return NextResponse.json({ entries });
}
