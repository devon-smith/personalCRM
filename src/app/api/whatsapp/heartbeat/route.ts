import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy WhatsApp heartbeat API is disabled.",
};

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
