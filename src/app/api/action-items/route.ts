import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy action items API is disabled. Use Gmail action extraction and the reply queue.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
