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
            "openid email profile https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
  },
  callbacks: {
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }
      return session;
    },
  },
});

export const { handlers, signIn, signOut } = nextAuth;

// In development, bypass auth and use the first user in the database
export const auth =
  process.env.NODE_ENV === "development"
    ? async () => {
        const realSession = await nextAuth.auth();
        if (realSession?.user?.id) return realSession;

        // Fall back to first user in DB (seeded user)
        const user = await prisma.user.findFirst();
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
