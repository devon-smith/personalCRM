# whatsapp-sidecar-openwa

Replacement WhatsApp sidecar using
[`@open-wa/wa-automate`](https://www.open-wa.org/) (Puppeteer-driven
WhatsApp Web automation) instead of Baileys (pure-JS protocol
reimplementation). Built to dual-run alongside the existing
`whatsapp-sidecar/` (Baileys) during the migration window — once
this one is proven stable on the live account, retire Baileys.

## Why swap?

WhatsApp's anti-abuse stack flags protocol reimplementations
(Baileys, whatsmeow) more aggressively than real-browser automation
(open-wa, whatsapp-web.js). Ban rate is meaningfully lower with
open-wa because the traffic is indistinguishable from a logged-in
human using WhatsApp Web. Heavier resource footprint (a real Chrome
instance) is acceptable for single-user, low-throughput use.

## Setup

```bash
cd whatsapp-sidecar-openwa
npm install        # downloads Chromium on first run unless CHROME_PATH is set
cp .env.example .env
# edit .env: CRM_BASE_URL, CRM_EXTENSION_TOKEN
npm start
```

The first run prints a QR code to stdout. Scan it from
**Settings → Linked devices → Link a device** in your WhatsApp app.
The session persists in `./session-data/` so subsequent runs reconnect
without rescanning.

## Dual-run with the baileys sidecar

WhatsApp permits up to 4 linked devices per account, so both sidecars
can run simultaneously as separate devices. The CRM's
`/api/whatsapp/sync` endpoint deduplicates by `messageId`, which is
the canonical WhatsApp message ID and is identical across both
sidecars — so no double-writes.

Suggested flow:

1. Leave `whatsapp-sidecar/` running as today.
2. Start this sidecar. Scan QR.
3. Watch the CRM for a week. Verify messages still appear with no
   duplicates and the heartbeat reports both as connected.
4. If stable, stop `whatsapp-sidecar/` and revoke its linked device
   from the WhatsApp app (Settings → Linked devices → Personal CRM).
5. (Future) Move history backfill into this sidecar via
   `client.getAllChatIds() + client.getAllMessagesInChat()`.

## What this sidecar does (and doesn't) do

Inbound + outbound message capture, group + 1:1, buffered every 5s
and flushed to `POST /api/whatsapp/sync`. Heartbeat every 60s to
`POST /api/whatsapp/heartbeat`. One-shot history backfill on first
connection per session (last 20 messages per chat).

The history backfill is sentinel-gated via `.backfill-done` inside
`SESSION_DIR` so it runs exactly once per session. Delete that file
to re-trigger.

## Cutover from baileys

When ready to retire the baileys sidecar:

1. Stop the open-wa sidecar.
2. Delete `SESSION_DIR/.backfill-done` so history re-pulls fresh.
3. Stop the baileys sidecar.
4. Start the open-wa sidecar — it'll backfill history once on
   connect, then settle into live-mode.
5. Open WhatsApp → Settings → Linked devices, revoke the
   baileys "Personal CRM" device entry.

The CRM-side dedup at `/api/whatsapp/sync` (by `messageId`) means
overlapping windows during the cutover don't double-write.

## Environment variables

| var | required | default | meaning |
|---|---|---|---|
| `CRM_BASE_URL` | yes | `http://localhost:3003` | where to POST sync/heartbeat |
| `CRM_EXTENSION_TOKEN` | yes | — | bearer token (matches `ExtensionToken` row) |
| `SESSION_DIR` | no | `./session-data` | open-wa session store path |
| `SESSION_ID` | no | `personalcrm` | open-wa sessionId |
| `CHROME_PATH` | no | — | use installed Chrome instead of downloading Chromium |
| `LOG_LEVEL` | no | `info` | `info` \| `debug` \| `warn` \| `error` |
