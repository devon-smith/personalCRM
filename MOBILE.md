# Mobile (Capacitor) setup

The CRM ships as a native iOS / Android shell that wraps the existing
web app in a webview, loaded from your hosted server. Web updates ship
without rebuilding the native binary — the shell exists for platform
access (mic, notifications, install-on-home-screen) rather than UI
duplication.

## One-time per platform

```bash
# Add iOS (needs a Mac with Xcode installed)
npm run mobile:add:ios

# Add Android (needs Android Studio installed)
npm run mobile:add:android
```

Generated `ios/` and `android/` folders are git-ignored. Each device /
developer runs the add commands themselves.

## Each rebuild

```bash
# Tell the shell which server to load (overrides capacitor.config.ts default)
export CAPACITOR_SERVER_URL=https://crm.your-domain.com

# Sync web → native (copies config, plugin updates, etc.)
npm run mobile:sync

# Open in Xcode / Android Studio
npm run mobile:open:ios
npm run mobile:open:android
```

In Xcode hit ▶︎ to build + install on the connected device / simulator.

## Local dev pointing at your laptop

```bash
# Find your laptop's LAN IP (e.g. 192.168.1.42)
ipconfig getifaddr en0     # macOS

# Run the Next.js dev server
npm run dev

# Sync Capacitor pointing at the laptop
CAPACITOR_SERVER_URL=http://192.168.1.42:3003 npm run mobile:sync
npm run mobile:open:ios
```

The `cleartext: true` config in `capacitor.config.ts` only activates
when the URL is http — production https hosts skip that flag.

## What changes for the web app

Nothing required. The existing app loads inside the webview verbatim.
Code paths that want to detect the shell (e.g. to swap a web file picker
for a native one later) can:

```ts
import { isMobileShell, getMobilePlatform } from "@/lib/mobile";

if (isMobileShell()) {
  // native code path (haptics, native share sheet, etc.)
}
```

## Adding native capabilities later

When you want native features (push notifications, native mic, native
share), install the relevant Capacitor plugin and run `mobile:sync`:

```bash
npm install @capacitor/share @capacitor/haptics @capacitor/push-notifications
npm run mobile:sync
```

The web side detects via `isMobileShell()` and uses the native API
inside the shell; web fallbacks (Web Share API, vibration, etc.) keep
working in a regular browser tab.

## Why webview-loaded-from-server

For a personal CRM the laptop+server lives on the same network the
phone is usually on. Loading from the server has three advantages over
a static export:

1. Next.js API routes (auth, draft generation, search) work without
   rewriting for an export target.
2. Updates ship instantly — no App Store review cycle for a fix.
3. The native binary stays trivial — just a shell, no bundled JS to
   re-build per change.

The downside is the phone needs network access to the CRM server. If
the laptop is asleep the app shows the loading state. Acceptable
tradeoff for personal use.
