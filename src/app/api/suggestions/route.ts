import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy proactive suggestions API is disabled. Use active page-specific suggestions instead.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
