import { NextResponse } from "next/server";

const disabledResponse = {
  error: "Legacy changelog API is disabled. Changelog context is now loaded through focused surfaces.",
};

export async function PATCH() {
  return NextResponse.json(disabledResponse, { status: 404 });
}
