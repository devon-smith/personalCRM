import { NextResponse } from "next/server";

const disabledResponse = {
  error:
    "Legacy morning brief preview API is disabled. Morning briefs run through the scheduled worker task.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
