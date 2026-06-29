import { NextResponse } from "next/server";

const disabledResponse = {
  error:
    "Legacy extension activity logging API is disabled. Use explicit notes or inbox/reply flows for relationship context.",
};

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
