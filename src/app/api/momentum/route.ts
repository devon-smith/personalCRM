import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getContactMomentum } from "@/lib/momentum";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contactIds = req.nextUrl.searchParams.get("contactIds");
  const ids = contactIds ? contactIds.split(",").filter(Boolean) : undefined;

  const momentum = await getContactMomentum(session.user.id, ids);

  return NextResponse.json({ momentum });
}
