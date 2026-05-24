import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Personal CRM mobile shell — Capacitor wraps the existing Next.js app
 * as an iOS/Android webview. The web app is loaded from a hosted URL
 * (CAPACITOR_SERVER_URL env at build time) rather than a static export,
 * which:
 *   - lets us ship web updates without rebuilding the native binary
 *   - keeps the Next.js API routes (auth, draft generation, etc.)
 *     working without an export rewrite
 *   - means the phone needs network access to the CRM server — fine for
 *     personal use; the laptop+server lives at home anyway.
 *
 * Build with:
 *   CAPACITOR_SERVER_URL=https://crm.your-domain.com npx cap sync
 * Or for local dev pointing at the laptop:
 *   CAPACITOR_SERVER_URL=http://192.168.1.X:3003 npx cap sync
 */
const serverUrl = process.env.CAPACITOR_SERVER_URL;

const config: CapacitorConfig = {
  appId: "com.devonsmith.personalcrm",
  appName: "Personal CRM",
  webDir: "out", // unused when server.url is set; placeholder for static build
  ...(serverUrl
    ? {
        server: {
          url: serverUrl,
          // cleartext only matters in dev (http://192.168.x.x). Production
          // host should always be https; this line is a no-op there.
          cleartext: serverUrl.startsWith("http://"),
          allowNavigation: [new URL(serverUrl).hostname],
        },
      }
    : {}),
  ios: {
    // Required for the in-app webview to access mic / camera reliably.
    contentInset: "automatic",
  },
};

export default config;
