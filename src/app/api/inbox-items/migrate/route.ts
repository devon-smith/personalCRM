import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy inbox migration API is disabled. Use checked-in maintenance scripts for intentional migrations.",
};

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
