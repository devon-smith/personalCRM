# Gmail & Calendar push sync setup

Closes the 2-minute polling window on Gmail / Calendar with push
notifications — new messages and event changes land in the CRM
within seconds rather than every few minutes.

## What you'll need

- A Google Cloud project (free tier is fine).
- An https URL where Google can reach the CRM (your prod host, or
  a `ngrok`/`cloudflared` tunnel for local dev).
- ~15 minutes for first-time setup.

## One-time setup

### 1. Cloud Pub/Sub topic (for Gmail push)

```bash
# Replace <project-id> with your GCP project
gcloud pubsub topics create gmail-updates --project=<project-id>

# Grant Gmail's service account permission to publish to it.
gcloud pubsub topics add-iam-policy-binding gmail-updates \
  --project=<project-id> \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

# Create a push subscription pointing at the CRM webhook.
gcloud pubsub subscriptions create gmail-updates-push \
  --project=<project-id> \
  --topic=gmail-updates \
  --push-endpoint="https://<your-crm-host>/api/webhooks/gmail/<WEBHOOK_TOKEN>"
```

`<WEBHOOK_TOKEN>` is a random string you pick — same value goes in
`.env.local`. Acts as a shared secret so random internet hits can't
trigger sync.

### 2. Generate a webhook token

```bash
# Pick something long and random.
openssl rand -hex 32
```

### 3. Add env vars to `.env.local` (or your hosting platform)

```env
GMAIL_PUBSUB_TOPIC=projects/<project-id>/topics/gmail-updates
WEBHOOK_BASE_URL=https://<your-crm-host>
WEBHOOK_TOKEN=<the random string from step 2>
```

Restart the dev server / worker.

### 4. Establish the watches

Hit the setup endpoint while signed in:

```bash
curl -X POST https://<your-crm-host>/api/integrations/setup-push \
  -H "Cookie: <your session cookie>"
```

Response shows what was established:

```json
{
  "gmail": { "ok": true, "expiresAt": "2026-05-31T..." },
  "calendar": { "ok": true, "channels": 1 },
  "configured": { "gmailPubsub": true, "webhookBase": true, "webhookToken": true }
}
```

Either field reports `ok: false` with an error message when something
upstream is wrong (most often: scope drift on the Google account,
needs a Reconnect; or the Pub/Sub topic permissions don't include
`gmail-api-push@system.gserviceaccount.com`).

### 5. Verify

Send yourself an email or create a calendar event. Within ~5 seconds:
- `/admin/jobs` Recent jobs section should show a fresh `gmail-sync`
  or `calendar-sync` row triggered by `triggeredBy=webhook`.
- The inbox / dashboard should pick up the change without a manual refresh.

## How it stays alive

- Gmail watches expire after 7 days. The worker `watch-renew` task
  fires every 6 days at 03:17 UTC and re-establishes any expiring
  watch (Google replaces the prior watch automatically — no need
  to stop first).
- Calendar channels expire on a per-channel basis (default ~30 days).
  Same `watch-renew` task re-establishes channels within 48h of
  expiration.

## Disabling / teardown

```bash
# Stop the Gmail watch
curl -X POST https://gmail.googleapis.com/gmail/v1/users/me/stop \
  -H "Authorization: Bearer <access-token>"

# Stop a Calendar channel
curl -X POST https://www.googleapis.com/calendar/v3/channels/stop \
  -H "Authorization: Bearer <access-token>" \
  -H "Content-Type: application/json" \
  -d '{"id": "<channelId>", "resourceId": "<resourceId>"}'
```

The CRM's `stopGmailWatch` / Calendar teardown helpers do this for
you via Prisma + the access token; surface a UI button if you need
it routinely.

## Local dev with ngrok

```bash
ngrok http 3003
# WEBHOOK_BASE_URL becomes whatever https URL ngrok prints
```

Pub/Sub push subscriptions require https, and Google won't deliver
to a host without DNS. ngrok solves both for free.

## Security note

The webhook token is a shared secret in the URL path. This is fine
for a single-user personal CRM but not appropriate for multi-tenant
use. For stronger auth, swap to OIDC token verification on the
`Authorization` header (Pub/Sub can sign deliveries with a
configurable identity).
