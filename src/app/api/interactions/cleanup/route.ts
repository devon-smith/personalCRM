import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy interaction cleanup API is disabled. Use checked-in maintenance scripts for intentional cleanup.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
