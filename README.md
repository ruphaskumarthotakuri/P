# Northstar authentication

A responsive React sign in and sign up page with Supabase Auth, an Express API, password reset, auto-confirmed email sign-up, and a protected `GET /api/me` endpoint that verifies the current Supabase access token.

## Run locally

1. Create a Supabase project and open **Project Settings → API**.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to `.env`. The local `.env` is ignored by Git. Never put a Supabase `service_role` key in the browser or this file.
3. In Supabase **Authentication → URL Configuration**, set the local Site URL to `http://localhost:5173` and add it to the redirect URL allow list.
4. Install dependencies and start both apps:

   ```sh
   npm install
   npm run dev
   ```

5. Open `http://localhost:5173`. For production, run `npm run build` then `npm start`; Express serves the built React app and the API on port 3001.

The sign-up API creates and auto-confirms the account on the server, so users can sign in immediately without a confirmation email. This requires `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) in the server `.env`. The sign-up form collects a name and saves it as the user's `full_name` auth metadata. Passwords must be at least 8 characters.

The profile settings save account details to user metadata and publish a member profile for the signed-in community. Members can browse a feed, open other member profiles, and share photo posts with a caption and required detected location. Run `supabase/posts-schema.sql` in the Supabase SQL Editor to create the profiles and posts tables, backfill existing member details, and apply row-level access policies. Post images use the private `photo` Storage bucket under each signed-in user's folder; the storage policies in `supabase/photo-storage-policies.sql` must also be installed in the project.

The admin dashboard is available from the sign-in page. Local development uses `ADMIN_EMAIL=admin@gmail.com` and `ADMIN_PASSWORD=admin`; these credentials must be replaced with a strong password before deployment. The server also needs `ADMIN_SESSION_SECRET` and `SUPABASE_SECRET_KEY` (or the legacy `SUPABASE_SERVICE_ROLE_KEY`) in `.env`. The secret key stays on the Node server and is never sent to the browser. The admin workbook includes profile fields, user IDs, account timestamps, metadata JSON, and a photo link signed for seven days.

Admins can send a manually composed WhatsApp message from each member row or send one message to all members. The app runs its own Baileys connection and checks that each recipient's stored phone number is on WhatsApp before sending. Set `WHATSAPP_SENDER_NUMBER` in `.env` to the number for the linked account. When the session is unlinked, the admin page shows a QR code; scan it from WhatsApp → Linked devices. The app stores its linked-device credentials in `.whatsapp-auth` in this project folder and applies a 100-attempt daily cap. Bulk messages are sent sequentially, skip missing, invalid, duplicate, or non-WhatsApp numbers, and return a recipient summary. Restart the app after configuring the sender number.

## API

- `GET /api/health` reports whether the server has Supabase configuration.
- `GET /api/me` requires `Authorization: Bearer <access_token>` and returns the verified user's id and email.

Only the Supabase anon/public key is needed. Row level security and policies should be enabled for any future user-owned database tables.
# P
## Browser notifications

Apply `supabase/browser-push.sql` after `supabase/member-features.sql` in the Supabase SQL Editor. New comment notifications will show the comment text. Older notifications have no stored link to the original comment.

1. Generate one VAPID key pair with `npx web-push generate-vapid-keys`. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a contact URI such as `mailto:admin@example.com`) in the server environment.
2. Generate a separate random secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and set it as `PUSH_WEBHOOK_SECRET` in the same server environment.
3. In Supabase Database Webhooks, add an INSERT webhook for `public.notifications`. Use POST to the deployed HTTPS app URL followed by `/api/push/deliver`. Add a header named `x-push-secret` with the same secret from step 2.
4. Deploy, then sign in and select **Enable browser alerts** in Notifications. A second account can follow, like, or comment to verify delivery, including with the app tab closed.
