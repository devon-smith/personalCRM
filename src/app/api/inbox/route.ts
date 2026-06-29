import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy inbox API is disabled. Use /api/inbox-items.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
