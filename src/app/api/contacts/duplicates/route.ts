import { NextResponse } from "next/server";

const disabledResponse = {
  error:
    "Legacy contact duplicates API is disabled. Use the Merge page bootstrap flow for duplicate review.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
