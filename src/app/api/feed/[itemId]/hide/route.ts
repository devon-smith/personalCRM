import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy feed hide API is disabled.",
};

export async function POST() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
