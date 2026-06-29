import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy feed visit API is disabled.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
