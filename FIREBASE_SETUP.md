# Firebase setup

The planner now uses Firebase Google Authentication and Realtime Database instead of Supabase. A Google account is separate from any Supabase login. On the first sign-in, the planner copies the current browser's local planner data to `users/{uid}/ca_inter_planner_data`; existing Supabase cloud records are not imported automatically.

## Firebase

1. In Firebase Authentication, enable the Google provider and configure its support email.
2. Verify that Firebase Cloud Messaging is enabled and configure a Web Push certificate. The VAPID public key and web app configuration in `index.html` and `fcm/messaging-sw.js` are public client settings; never put a service-account private key in either file.
3. Add the deployed site hostname to Firebase Authentication's authorized domains.
4. Deploy the included Realtime Database rules to the configured project. They keep root access denied and permit each signed-in user to access only their own planner and reminder records.
5. Host the site over HTTPS (or localhost during development). Browser push notifications do not work from a `file://` URL.

If you already signed in with Email/Password in an earlier version, Firebase does not automatically merge that identity with Google. The Google account may have a different Firebase UID; copy/migrate any cloud-only planner data before switching.

## GitHub Actions push delivery

1. Add a repository Actions secret named `FIREBASE_SERVICE_ACCOUNT_JSON` containing the full JSON key for a service account in the configured Firebase project. Store it only as a GitHub secret; do not commit the JSON.
2. Enable GitHub Actions and scheduled workflows for the repository. The workflow at `.github/workflows/send-ca-planner-reminders.yml` checks for due reminders every five minutes.
3. Sign in to the deployed planner, select **Enable reminders**, and allow notifications. The app registers the device token and synchronizes lecture reminders up to 400 days ahead; the sender evaluates recurring personal slots from the saved planner data.

The foreground timer can alert close to the configured slot time while the page is open and the browser is running. Background push delivery depends on GitHub Actions schedule timing, GitHub availability, network connectivity, and browser notification settings; scheduled workflows can be delayed, so exact delivery while the app is closed cannot be guaranteed.
