import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy iMessage sync API is disabled. Gmail is the active message ingestion source.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
