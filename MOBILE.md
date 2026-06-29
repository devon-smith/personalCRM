# Professor CRM iOS Build

This app uses Capacitor as a native iOS shell around the live Next.js CRM.
The phone loads `CAPACITOR_SERVER_URL`; it does not run the API, database, AI
jobs, or Google sync locally.

## Requirements

- Node.js 22 or newer (`nvm use` will read `.nvmrc`).
- Xcode signed into the Apple Developer account.
- An iPhone registered for development builds, or TestFlight access.
- A running CRM backend with the same database/env values the web app uses.

Before running the mobile scripts from a fresh shell:

```bash
nvm use 22
```

## Local Device Build

Use this when the Mac and Jennifer's iPhone are on the same Wi-Fi network.

1. Start the web app on the LAN:

   ```bash
   npm run dev:mobile
   ```

2. Find the Mac's Wi-Fi IP:

   ```bash
   ipconfig getifaddr en0
   ```

3. Sync the iOS project against that URL:

   ```bash
   CAPACITOR_SERVER_URL=http://YOUR_MAC_IP:3003 npm run mobile:sync:ios
   ```

4. Open Xcode:

   ```bash
   npm run mobile:open:ios
   ```

5. In Xcode:
   - Select the `App` target.
   - Set Team to the Apple Developer team.
   - Confirm Bundle Identifier is `com.devonsmith.professorcrm` or change it
     to another unique identifier owned by the team.
   - Select Jennifer's iPhone as the run target.
   - Press Run.

Local builds only work while the iPhone can reach `http://YOUR_MAC_IP:3003`.

## TestFlight / Real-World Build

Use this for a downloadable app that works away from the Mac.

1. Deploy the Next.js backend to an HTTPS domain.

2. Set production env values on that backend:

   ```bash
   NEXTAUTH_URL=https://crm.your-domain.com
   AUTH_URL=https://crm.your-domain.com
   AUTH_ALLOWED_EMAILS=devontjsmith@gmail.com,jaaker@stanford.edu
   WEBHOOK_BASE_URL=https://crm.your-domain.com
   ```

3. In Google Cloud OAuth settings, add these authorized redirect URIs:

   ```text
   https://crm.your-domain.com/api/auth/callback/google
   https://crm.your-domain.com/api/auth/add-google-account/callback
   ```

4. Sync iOS against the production domain:

   ```bash
   CAPACITOR_SERVER_URL=https://crm.your-domain.com npm run mobile:sync:ios
   ```

5. Check the native project configuration:

   ```bash
   npm run mobile:doctor:ios
   ```

6. In Xcode:
   - Product > Archive
   - Distribute App > App Store Connect
   - Upload
   - Add Jennifer as an internal or external tester in TestFlight.

After the TestFlight shell points at the HTTPS app URL, normal web changes ship
through the deployed Next.js app. Jennifer only needs a new TestFlight install
when native shell settings, plugins, signing, app icons, or capabilities change.

## Notes

- Google OAuth may be blocked in embedded webviews. The fastest path is to keep
  Jennifer's Google account linked through the hosted web app, then use the
  mobile shell for day-to-day access.
- Native OAuth can be added later if we want first-run Google sign-in to happen
  entirely inside the installed app.
- The current native project uses Swift Package Manager through Capacitor 8.
