import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy HTTP backfill API is disabled. Use checked-in maintenance scripts for intentional backfills.",
};

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
