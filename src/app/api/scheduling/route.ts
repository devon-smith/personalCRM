import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy scheduling suggestions API is disabled. Use Calendar and reply queue workflows instead.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
