import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { SessionProvider } from "@/components/auth/session-provider";
import { QueryProvider } from "@/components/providers/query-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // viewport-fit=cover is REQUIRED for env(safe-area-inset-*) to
  // return non-zero values on notched iPhones. Without it the sticky
  // header sits under the notch and content hides behind the home
  // indicator. (M0.x.17)
  viewportFit: "cover",
  themeColor: "#1A1A1A",
};

export const metadata: Metadata = {
  title: "Professor CRM",
  description: "Jennifer's relationship intelligence workspace",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Professor CRM",
  },
  icons: {
    apple: "/icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${GeistSans.variable} antialiased`}>
        <SessionProvider>
          <QueryProvider>
            {children}
            <Toaster />
          </QueryProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
