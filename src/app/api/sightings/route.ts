import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Generic sightings review is disabled. Use the Merge and LinkedIn review flows.",
};

export async function GET() {
  return NextResponse.json(disabledResponse, { status: 404 });
}

export async function PATCH() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
