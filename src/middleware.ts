import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  // Handle CORS preflight for extension API routes
  if (req.nextUrl.pathname.startsWith("/api/extension/")) {
    if (req.method === "OPTIONS") {
      return new NextResponse(null, {
        status: 204,
        headers: corsHeaders(req),
      });
    }
    // Add CORS headers to actual responses
    const response = NextResponse.next();
    for (const [key, value] of Object.entries(corsHeaders(req))) {
      response.headers.set(key, value);
    }
    return response;
  }

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

function corsHeaders(req: NextRequest): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed =
    origin === "https://www.linkedin.com" ||
    origin.startsWith("http://localhost") ||
    origin.startsWith("chrome-extension://");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/people/:path*",
    "/circles/:path*",
    "/activity/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/api/extension/:path*",
  ],
};
