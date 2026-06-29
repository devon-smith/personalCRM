import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error:
        "Legacy iMessage debug API is disabled. Gmail is the active message ingestion source.",
    },
    { status: 404 },
  );
}
