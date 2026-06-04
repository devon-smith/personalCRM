# Mobile (Capacitor) setup

The CRM ships as a native iOS / Android shell that wraps the existing
web app in a webview, loaded from your hosted server. Web updates ship
without rebuilding the native binary — the shell exists for platform
access (mic, notifications, install-on-home-screen) rather than UI
duplication.

---

## Install on your iPhone — free, no Developer Program (the in-depth path)

This is the path for putting the app on **your own** iPhone with just a
free Apple ID. No $99/yr Apple Developer membership. The catch: the app
signature expires after **7 days**, so you re-run one build step weekly.
Everything else persists.

### What you need (once)

- A Mac with **Xcode 15+** installed (App Store, free).
- Your iPhone + a **USB-to-Lightning / USB-C cable** for the first run.
- A free **Apple ID** (the one on your iPhone is fine).
- The Next.js server running somewhere the phone can reach — your Mac on
  the same Wi-Fi is simplest (see "Network setup" below).

### Step 1 — Generate the iOS project

From the repo root on the Mac:

```bash
npm install                 # if you haven't already
npm run mobile:add:ios      # creates ios/App/ (Xcode project + CocoaPods)
```

### Step 2 — Point the shell at your running server

The webview loads the live app from a URL. For your Mac on the LAN:

```bash
# Find your Mac's LAN IP (e.g. 192.168.1.42)
ipconfig getifaddr en0

# Start the dev server (leave it running in its own terminal)
npm run dev

# Bake that URL into the native shell
CAPACITOR_SERVER_URL=http://192.168.1.42:3003 npm run mobile:sync
```

> Sanity check: open `http://192.168.1.42:3003` in **Safari on the
> iPhone**. If it loads, the shell will too. If it doesn't, fix the
> network before touching Xcode (it's almost always a firewall or a
> different Wi-Fi network).

### Step 3 — Open Xcode and sign with your free Apple ID

```bash
npm run mobile:open:ios     # opens ios/App/App.xcworkspace in Xcode
```

In Xcode:

1. Select the **App** target in the left sidebar (the blue icon at top).
2. Go to **Signing & Capabilities**.
3. Tick **Automatically manage signing**.
4. **Team** → **Add an Account…** → sign in with your Apple ID →
   then pick your name (Personal Team) as the Team.
5. If you see a red "bundle identifier is not available" error, change
   the **Bundle Identifier** to something unique, e.g.
   `com.<yourname>.personalcrm.dev` — free personal teams can't reuse an
   identifier someone else registered.

### Step 4 — Run it on the phone

1. Plug in the iPhone. The first time, tap **Trust** on the phone.
2. In Xcode's top device dropdown, pick your iPhone (not a simulator).
3. Press **▶︎ (Run)** or ⌘R. Xcode builds, installs, and launches.
4. **First launch will fail with "Untrusted Developer."** This is
   expected. On the iPhone: **Settings → General → VPN & Device
   Management → [your Apple ID] → Trust**. Then tap the app icon again.

That's it — the app is on your home screen.

### The weekly re-sign (the 7-day cost)

Free-team signatures expire after 7 days. When the app refuses to open
(or ~weekly, pre-emptively):

1. Plug the phone back into the Mac.
2. `npm run mobile:open:ios`, pick the phone, press ▶︎.

That re-signs and reinstalls in place — **your data and login persist**
(they live on the server, not the binary). ~30 seconds of friction once
a week. If that ever gets annoying, the $99/yr Developer Program raises
the expiry to 90 days and unlocks TestFlight (no cable, over-the-air).

### Wireless runs after the first cable run

Once you've run over USB at least once, enable **Connect via network**
in Xcode (Window → Devices and Simulators → select your iPhone → tick
"Connect via network"). After that the weekly re-sign works over Wi-Fi
with no cable, as long as the phone and Mac are on the same network.

### Common snags

| Symptom | Fix |
|---|---|
| Blank white screen in the app | `CAPACITOR_SERVER_URL` wrong or `npm run dev` not running. Load the URL in mobile Safari to confirm. |
| "Untrusted Developer" on launch | Settings → General → VPN & Device Management → Trust your Apple ID. |
| "Bundle identifier not available" | Change it to a unique string in Signing & Capabilities. |
| App opened last week, now won't | Signature expired — re-run from Xcode (Step 4, the weekly re-sign). |
| Works on Wi-Fi, dead on cellular | The Mac's LAN IP isn't reachable off-network. Use Tailscale (below) or deploy the server publicly. |

---

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
