import { NextResponse } from "next/server";

const disabledResponse = {
  error:
    "Legacy admin job inspection API is disabled. Worker health is surfaced through Sources and usage telemetry.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
