import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { extractActionItems } from "@/lib/gmail/extract-actions";

/**
 * POST /api/gmail/extract-actions
 * Run AI extraction on recent email threads to find action items.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await extractActionItems(session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[POST /api/gmail/extract-actions]", error);
    return NextResponse.json(
      { error: "Failed to extract email actions" },
      { status: 500 },
    );
  }
}
