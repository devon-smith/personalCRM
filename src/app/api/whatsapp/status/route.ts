import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy WhatsApp status API is disabled. Gmail and Calendar are the active ingestion sources.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
