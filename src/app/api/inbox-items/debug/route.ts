import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy inbox debug API is disabled. Use focused logs or maintenance scripts for diagnostics.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
