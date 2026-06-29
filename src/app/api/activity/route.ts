import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy activity API is disabled. Use the inbox and dashboard surfaces.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
