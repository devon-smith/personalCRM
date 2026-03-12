import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  generateCircleSuggestions,
  type CircleSuggestion,
} from "@/lib/circle-suggestions";

export type { CircleSuggestion };

/** GET — Smart circle suggestions based on contact data */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const suggestions = await generateCircleSuggestions(session.user.id);
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error("[GET /api/circles/suggestions]", error);
    return NextResponse.json(
      { error: "Failed to generate suggestions" },
      { status: 500 },
    );
  }
}
