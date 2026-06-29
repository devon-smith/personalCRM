import { NextResponse } from "next/server";

const disabledResponse = {
  error:
    "Legacy extension feed intelligence API is disabled. Use Gmail, Calendar, and explicit notes as relationship sources.",
};

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
