import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy interaction dedup API is disabled. Use checked-in maintenance scripts for intentional deduping.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
