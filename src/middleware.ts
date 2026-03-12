import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  // Skip auth in development mode
  if (process.env.NODE_ENV === "development") {
    // Still check onboarding in dev mode
    const onboardingComplete = req.cookies.get("crm-onboarding-complete");
    const isOnboardingRoute = req.nextUrl.pathname.startsWith("/onboarding");
    const isDashboardRoute = !isOnboardingRoute && !req.nextUrl.pathname.startsWith("/api");

    if (!onboardingComplete && isDashboardRoute) {
      return NextResponse.redirect(new URL("/onboarding", req.nextUrl));
    }
    if (onboardingComplete && isOnboardingRoute) {
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
    }
    return NextResponse.next();
  }

  const sessionToken =
    req.cookies.get("authjs.session-token") ??
    req.cookies.get("__Secure-authjs.session-token");

  const isLoggedIn = !!sessionToken;

  if (!isLoggedIn) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  // Check onboarding for authenticated users
  const onboardingComplete = req.cookies.get("crm-onboarding-complete");
  const isOnboardingRoute = req.nextUrl.pathname.startsWith("/onboarding");

  if (!onboardingComplete && !isOnboardingRoute) {
    return NextResponse.redirect(new URL("/onboarding", req.nextUrl));
  }
  if (onboardingComplete && isOnboardingRoute) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/people/:path*",
    "/circles/:path*",
    "/activity/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
  ],
};
