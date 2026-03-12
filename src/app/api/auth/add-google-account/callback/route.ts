import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

/**
 * GET — OAuth callback after user authorizes an additional Google account.
 * Exchanges code for tokens, stores the account, and redirects back.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const storedState = req.cookies.get("add_google_state")?.value;

  if (!code || !state || state !== storedState) {
    return NextResponse.redirect(
      new URL("/integrations?error=invalid_state", req.url),
    );
  }

  const redirectUri = `${req.nextUrl.origin}/api/auth/add-google-account/callback`;

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      console.error("Token exchange failed:", await tokenRes.text());
      return NextResponse.redirect(
        new URL("/integrations?error=token_failed", req.url),
      );
    }

    const tokens = await tokenRes.json();

    // Get user info for this Google account
    const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoRes.ok) {
      return NextResponse.redirect(
        new URL("/integrations?error=userinfo_failed", req.url),
      );
    }

    const userInfo = await userInfoRes.json();
    const googleAccountId = userInfo.id as string;
    const googleEmail = (userInfo.email as string)?.toLowerCase();

    // Check if this Google account is already linked to this user
    const existing = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "google",
          providerAccountId: googleAccountId,
        },
      },
    });

    if (existing && existing.userId === session.user.id) {
      // Already linked — update tokens
      await prisma.account.update({
        where: { id: existing.id },
        data: {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token ?? existing.refresh_token,
          expires_at: tokens.expires_in
            ? Math.floor(Date.now() / 1000) + tokens.expires_in
            : existing.expires_at,
          scope: tokens.scope ?? existing.scope,
        },
      });
    } else if (existing) {
      // Linked to a different user — can't steal it
      return NextResponse.redirect(
        new URL("/integrations?error=account_taken", req.url),
      );
    } else {
      // Create new account link
      await prisma.account.create({
        data: {
          userId: session.user.id,
          type: "oauth",
          provider: "google",
          providerAccountId: googleAccountId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: tokens.expires_in
            ? Math.floor(Date.now() / 1000) + tokens.expires_in
            : null,
          token_type: tokens.token_type,
          scope: tokens.scope,
          id_token: tokens.id_token,
        },
      });
    }

    // Also store the email in additionalUserEmails for sync direction detection
    if (googleEmail) {
      const syncState = await prisma.gmailSyncState.findUnique({
        where: { userId: session.user.id },
        select: { additionalUserEmails: true },
      });

      const currentEmails = new Set(
        (syncState?.additionalUserEmails ?? []).map((e) => e.toLowerCase()),
      );

      if (!currentEmails.has(googleEmail) && googleEmail !== session.user.email?.toLowerCase()) {
        await prisma.gmailSyncState.upsert({
          where: { userId: session.user.id },
          create: {
            userId: session.user.id,
            additionalUserEmails: [googleEmail],
          },
          update: {
            additionalUserEmails: { push: googleEmail },
          },
        });
      }
    }

    const response = NextResponse.redirect(
      new URL("/integrations?added=" + encodeURIComponent(googleEmail ?? "account") + "&sync=true", req.url),
    );

    // Clear the state cookie
    response.cookies.delete("add_google_state");

    return response;
  } catch (error) {
    console.error("Add Google account error:", error);
    return NextResponse.redirect(
      new URL("/integrations?error=unexpected", req.url),
    );
  }
}
