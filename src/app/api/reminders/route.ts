import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getOverdueContacts, getUpcomingFollowUps } from "@/lib/followups";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [overdue, upcoming] = await Promise.all([
    getOverdueContacts(session.user.id),
    getUpcomingFollowUps(session.user.id, 7),
  ]);

  return NextResponse.json({ overdue, upcoming });
}
