import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy backfill coverage API is disabled. Use focused app surfaces and maintenance scripts.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
