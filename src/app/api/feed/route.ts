import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy feed API is disabled. Use dashboard, inbox, and meeting prep surfaces.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
