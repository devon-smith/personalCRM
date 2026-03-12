import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

const nextAuth = NextAuth({
  adapter: PrismaAdapter(prisma as never),
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope:
            "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/calendar.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  events: {
    // PrismaAdapter doesn't save scope from OAuth — persist it here
    async linkAccount({ account }) {
      if (account.provider === "google" && account.scope) {
        await prisma.account.updateMany({
          where: {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
          data: { scope: account.scope },
        });
      }
    },
  },
  callbacks: {
    async signIn({ account }) {
      // Persist scopes on every sign-in (linkAccount only fires on first link)
      if (account?.provider === "google" && account.scope) {
        await prisma.account.updateMany({
          where: {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
          data: { scope: account.scope },
        });
      }
      return true;
    },
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
});

export const { handlers, signIn, signOut } = nextAuth;

// In development, try real auth first, then fall back to seeded user
export const auth =
  process.env.NODE_ENV === "development"
    ? async () => {
        const realSession = await nextAuth.auth();
        if (realSession?.user?.id) return realSession;

        // Fall back to first user with a linked Google account,
        // or the first user in DB if none have Google linked
        const userWithGoogle = await prisma.user.findFirst({
          where: { accounts: { some: { provider: "google" } } },
        });
        const user = userWithGoogle ?? (await prisma.user.findFirst());
        if (!user) return null;

        return {
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            image: user.image,
          },
          expires: new Date(Date.now() + 86400000).toISOString(),
        };
      }
    : nextAuth.auth;
