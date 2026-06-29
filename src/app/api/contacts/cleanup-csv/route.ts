import { NextResponse } from "next/server";

const disabledResponse = {
  error:
    "Legacy CSV contact cleanup API is disabled. Contact cleanup should happen through reviewed merge/import flows.",
};

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
