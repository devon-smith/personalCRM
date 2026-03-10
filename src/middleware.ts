import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  // Skip auth in development mode
  if (process.env.NODE_ENV === "development") {
    return NextResponse.next();
  }

  const sessionToken =
    req.cookies.get("authjs.session-token") ??
    req.cookies.get("__Secure-authjs.session-token");

  const isLoggedIn = !!sessionToken;

  if (!isLoggedIn) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/contacts/:path*",
    "/pipeline/:path*",
    "/interactions/:path*",
    "/reminders/:path*",
    "/insights/:path*",
    "/map/:path*",
    "/settings/:path*",
  ],
};
