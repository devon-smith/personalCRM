import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy dashboard stats API is disabled. Use /api/dashboard/bootstrap.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
