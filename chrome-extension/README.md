# Personal CRM — LinkedIn Extension

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `chrome-extension/` folder
5. The extension icon appears in your toolbar

## Setup

1. Click the extension icon in your toolbar
2. Set your CRM URL (default: `http://localhost:3003`)
3. Make sure you're logged into the CRM in the same browser
4. Navigate to any LinkedIn profile — the sidebar should appear

## Usage

### Profile pages (`/in/*`)
- The CRM sidebar appears automatically on the right side
- Shows contact status, tier, circles, tags, notes, interaction history
- If the person isn't in your CRM, shows a **Save to CRM** button
- Detects job changes (company/role) and highlights them
- Quick actions: add notes, tags, or view in CRM — all without leaving LinkedIn

### Messaging (`/messaging/*`)
- A **Sync to CRM** button appears in conversation headers
- Click to sync the visible messages as interactions
- Messages are deduplicated by timestamp

### Feed & Network (`/feed/*`, `/mynetwork/*`)
- Small green badge appears on profile links for people in your CRM
- Helps you recognize contacts while scrolling

### Popup
- Shows connection status (green = connected, red = disconnected)
- Today's stats: profiles synced, messages logged
- Quick links to open CRM or check follow-ups
- CRM URL is configurable

## Architecture

```
chrome-extension/
├── manifest.json          # Manifest V3 config
├── background.js          # Service worker: health checks, message relay
├── content-profile.js     # Profile page: extraction, sidebar, sync
├── content-messaging.js   # Messaging: DM sync button
├── content-feed.js        # Feed: badge known contacts
├── sidebar.css            # Sidebar overlay styles
├── popup.html + popup.js  # Extension popup
└── icons/                 # Extension icons
```

### API Endpoints (server-side)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/extension/ping` | GET | Health check |
| `/api/extension/sync-profile` | POST | Sync LinkedIn profile to CRM |
| `/api/extension/lookup` | GET | Get contact card by LinkedIn URL |
| `/api/extension/sync-messages` | POST | Sync LinkedIn DMs |
| `/api/extension/add-note` | POST | Add a note to a contact |
| `/api/extension/add-tags` | POST | Add tags to a contact |
| `/api/extension/log-activity` | POST | Log profile views, connections |
| `/api/extension/follow-ups` | GET | Get overdue follow-ups |

## Troubleshooting

- **Sidebar doesn't appear**: LinkedIn may have changed their DOM structure. Check the browser console for errors. DOM selectors in `content-profile.js` may need updating.
- **"Disconnected" status**: Make sure the CRM dev server is running and you're logged in at the CRM URL.
- **No data showing**: Check that you've run the backfill and have contacts in the CRM.
- **CORS errors**: The CRM must allow requests from `https://www.linkedin.com`. The extension uses `credentials: "include"` to share browser cookies with the CRM for auth.

## Notes

- All DOM selectors are best-effort with multiple fallbacks. LinkedIn updates their DOM frequently, so selectors may need periodic maintenance.
- Profile data is cached for 1 hour per URL to avoid excessive API calls.
- Activity logging (profile views) is debounced to once per hour per contact.
- For production deployment, replace cookie-based auth with a token: generate one in CRM settings, paste into the extension popup, and send as `Authorization` header.
