import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy thread backfill API is disabled. Current sync paths create and link threads directly.",
};

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
