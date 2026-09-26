# Reserve-A-Room

Room reservations for **Stonehill Seventh-day Adventist Church**
([stonehillchurch.org](https://stonehillchurch.org)).

Production: https://reservearoom.stonehillchurch.org

> **Status:** the production baseline is live from `main`. Recurrence, lifecycle,
> navigation, legal-consent, and export enhancements are implemented locally and remain
> pending the migration/deployment checklist below.

## What it does

- Church members and guests reserve rooms **without creating an account**.
- Each room has its own rules:
  - capacity
  - approval required, or confirmed instantly
  - maximum advance reservation period
  - food and drinks policy
- Admins review, approve, decline, edit and cancel reservations. Super Admins also
  manage rooms, ministries, users, settings and the audit log.
- Admins can create bounded daily, weekday, weekly, monthly, and yearly recurring
  schedules—including combinations such as the second and fourth Saturday—and download
  the filtered reservation list as Excel-compatible CSV or PDF.
- Guests explicitly accept the published Privacy Policy and Terms of Service; the
  accepted document versions and timestamps are retained with the reservation.
- Mobile users receive context-aware floating navigation without changing the desktop
  header or admin sidebar.
- Double-bookings are prevented by the database itself.
- Installable as a Progressive Web App, with light and dark mode.

The design and every major decision are documented in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tech stack

- **Framework:** Next.js 16 (App Router, Turbopack), React 19, TypeScript (strict)
- **UI:** Tailwind CSS 4, shadcn/ui, Lucide icons
- **Backend:** Supabase (Postgres, Auth, Storage)
- **Email:** Resend + React Email
- **Validation and dates:** Zod, date-fns
- **Testing:** Vitest, Playwright
- **Hosting:** Vercel

## Local setup

Requirements: Node.js 22.18 or newer (developed on 24) and npm. Docker is optional: the
database tests run on an in-process Postgres, so no local Supabase stack is needed.

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase values (see below)
npm run dev                  # http://localhost:3000
```

## Development commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run typecheck` | Generate route types and run the TypeScript compiler |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (Vitest) |
| `npm run test:db` | Database tests: real migrations on in-process Postgres (PGlite), covering conflicts, booking rules, RLS and grants |
| `npm run check` | Typecheck + lint + unit tests + database tests |
| `npm run test:e2e` | End-to-end tests (Playwright) against a production build and a test-only mock Supabase |
| `npm run e2e:mock` | Start the test-only mock Supabase by hand (manual QA without Docker) |
| `npm run db:types` | Regenerate database TypeScript types from the migrations |
| `npm run bootstrap:super-admin` | One-time creation of the first Super Admin (see below) |
| `npm run brand:generate` | Rebuild logos and icons from `assets/branding/` |

## Branding

- **Source files:** the official logo and app icon are in `assets/branding/`
  (`logo-source.png`, `favicon-source.png`).
- **Generated assets:** `npm run brand:generate` creates every web asset from them:
  - logos, including a dark-mode variant with a white wordmark
  - favicon and PWA icons
  - Apple touch icon
  - social-share image

  To update the logo, replace the source file, run the script, and commit the results.
- **Colors:** brand navy `#031e47` and gold `#dea621`. Every color is defined as a design
  token in `src/app/globals.css`. Adjust colors there, never in components.

## Environment variables

See [.env.example](.env.example). Copy it to `.env.local` for local development and set
the same variables in Vercel → Settings → Environment Variables for **Production** and
**Preview**. Never commit real values. This repository is public.

| Variable | Needed in production | Where it's used |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Yes: `https://reservearoom.stonehillchurch.org` | Links in emails and metadata. Previews use their own branch URL automatically. |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL (browser-safe) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes | Supabase publishable/anon key (browser-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **Server only.** Guest reservations, invitations, email outbox |
| `GUEST_LINK_SECRET` | Yes (the app refuses to run without it in production) | Derives guest management links. Changing it invalidates every emailed link. |
| `RATE_LIMIT_SECRET` | Yes (the app refuses to run without it in production) | HMAC for rate-limit keys, so no raw IPs or emails are stored |
| `RESEND_API_KEY` | Yes | Sending email |
| `RESEND_FROM_EMAIL` | Yes, e.g. `reservations@reservearoom.stonehillchurch.org` | Sender address (the display name comes from Settings) |
| `RESEND_REPLY_TO` | Optional | Reply-to for requester emails (defaults to the Settings contact email) |
| `CRON_SECRET` | Recommended | Protects the scheduled recurrence materializer and email-outbox sweep |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Optional (both or neither) | Cloudflare Turnstile on the guest form |
| `INITIAL_SUPER_ADMIN_EMAIL` / `INITIAL_SUPER_ADMIN_NAME` | Only in `.env.local`, for the one-time bootstrap | `npm run bootstrap:super-admin` |

Generate each secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Deployments

- **Production:** `main` is the Vercel production branch, served at
  `https://reservearoom.stonehillchurch.org`.
- **Development:** use review branches or managed worktrees; preview deployments are
  validated before merging to `main`.
- **Merging:** nothing is merged to `main` without the owner's approval.

## Supabase setup

Project: `atnwrwrehexnwgqqnyek` (region us-west-2).

1. **API keys:** in Supabase → Settings → API Keys, copy:
   - the Project URL and the publishable/anon key into `NEXT_PUBLIC_SUPABASE_URL` and
     `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - the **service_role / secret** key into `SUPABASE_SERVICE_ROLE_KEY`, server only and
     never shared

   Set them in `.env.local` and in Vercel → Settings → Environment Variables.
2. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up".
   Staff accounts are created only by invitation.
3. **Authentication → URL Configuration:**
   - Site URL: `https://reservearoom.stonehillchurch.org`
   - Redirect URLs: add `https://reservearoom.stonehillchurch.org/**`, your Vercel URLs
     (e.g. `https://reserve-a-room.vercel.app/**`) and `http://localhost:3000/**`
4. **Authentication email:** no Supabase SMTP or template customization is required.
   The app asks Supabase to generate/verify one-time invitation and recovery tokens, then
   renders and sends the branded messages directly through Resend. Supabase does not send
   those messages.

## Database migrations

All schema changes live in `supabase/migrations/`. To apply them to the hosted project:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref atnwrwrehexnwgqqnyek
```

```bash
npx supabase db push
```

`link` asks for the database password (Supabase → Settings → Database). `db push`
applies only migrations that haven't run yet. `supabase/seed.sql` is never applied to
the hosted project.

The migrations create the initial reference data: the **Conference Room** (capacity 15,
confirmed instantly, bookable up to 4 weeks ahead, no food or drinks), 11 ministries, a
starter amenity list, and the default settings.

The enhancement rollout adds these append-only migrations, in order:

- `20260925100000_recurring_reservations.sql`
- `20260925110000_staff_account_lifecycle.sql`
- `20260925120000_super_admin_disable_protection.sql`
- `20260925130000_reservation_legal_consent.sql`
- `20260925140000_reservation_exports.sql`

After changing a migration, regenerate the TypeScript types:

```bash
npm run db:types
```

## First Super Admin bootstrap

There is no public sign-up and no "make me admin" page. The first Super Admin is created
once, from your computer:

1. In `.env.local`, set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL`, e.g. `https://reservearoom.stonehillchurch.org`
   - `INITIAL_SUPER_ADMIN_EMAIL`, and optionally `INITIAL_SUPER_ADMIN_NAME`
2. Run the script:

   ```bash
   npm run bootstrap:super-admin
   ```

3. The script sends a branded password-setup email through Resend. If Resend is not
   configured locally, it prints the link instead.

The script refuses to create a second Super Admin. Add further administrators from
**Users & Roles** inside the app. Re-running it for the same email prints a fresh link if
the first one expired.

## Resend setup

Reservation emails are sent through [Resend](https://resend.com) from the verified domain
`reservearoom.stonehillchurch.org`.

1. **Domain:** in Resend → Domains, confirm `reservearoom.stonehillchurch.org` shows
   **Verified** (SPF and DKIM records). Adding a DMARC record for the domain is recommended.
2. **API key:** Resend → API Keys → create a key with **Sending access**, limited to that
   domain. Set it as `RESEND_API_KEY` in Vercel (Production and Preview).
3. **Sender:** set `RESEND_FROM_EMAIL` to an address on the verified domain, for example
   `reservations@reservearoom.stonehillchurch.org`. The display name comes from
   **Settings → Email sender name** in the app, so staff can change it without a redeploy.
4. **Replies:** optionally set `RESEND_REPLY_TO` (e.g. the church office inbox). Without it,
   replies to requester emails go to the contact email from Settings. Staff notification
   emails always reply to the requester.
5. **Staff account emails:** invitations and password resets use the same Resend key,
   sender, React Email branding and app-owned confirmation route as the rest of the app.
   Supabase SMTP is not used.
6. **Cron:** set `CRON_SECRET` in Vercel (any long random string). `vercel.json` schedules
   `/api/cron/email-outbox`; each authenticated run first materializes due recurring
   occurrences, then drains both reservation and system-email outboxes.

**How sending works.** A reservation change queues its emails in `email_logs` in the same
database transaction. Right after the response is sent, the server renders the React Email
template (`src/emails/`) and sends it. Every email is recorded on the reservation page as
Sent, Sending…, Not delivered (with the provider's error) or Not sent (email not
configured). Staff can press **Send again** on any email that wasn't delivered. A failed
requester email also creates an in-app notification. Anything left queued is picked up by
the daily sweep.

Emails sent:

| Event | Recipient |
| --- | --- |
| Request received (approval-required room) | Requester |
| New request to review | Staff (active staff with email notifications on, plus extra addresses from Settings) |
| Reservation confirmed (instant room or created by staff) | Requester |
| Request approved / not approved | Requester |
| Reservation updated by staff (date, time or room of an approved reservation) | Requester |
| Reservation cancelled (by the requester or by staff) | Requester |
| Cancelled by requester | Staff |
| Staff invitation | Invited administrator |
| Password reset | Administrator |
| Invited administrator accepts and enters the portal for the first time | Active Super Admins |

**Without a key.** In local development and previews without `RESEND_API_KEY`, emails are
marked "Not sent" and their subject is logged (locally, the whole plain-text body
including the private link is printed to the terminal). In production a missing key is
recorded as a delivery failure, so staff are alerted.

**Previewing templates:**

```bash
EMAIL_PREVIEW_DIR=./email-previews npx vitest run src/lib/email
```

This writes each template as HTML and plain text to `./email-previews` (gitignored).

## Room policy configuration

Super Admins manage rooms under **Admin → Rooms**. Each room has:

| Setting | Effect |
| --- | --- |
| Capacity | Guests see it on every room card; entering more attendees shows a warning (never a refusal). |
| Approval Required / Instant Reservation | Approval rooms create **Pending** requests that staff approve or decline. Instant rooms are **Approved** immediately. |
| Maximum advance reservation | A number of days, weeks or months, or the app default from Settings. Later dates can't be picked, and the database rejects them too. |
| Food & drinks | Allowed or Not Allowed. Shown before booking, on the review step, the confirmation and in emails. |
| Active | Inactive rooms are archived: hidden everywhere, history kept. Rooms are never deleted. |
| Open for reservations | Turn off to mark a room temporarily unavailable, with an optional message. |

The editor shows a plain-language summary before saving, for example: *"Guests may
reserve this room up to 4 weeks in advance. Reservations require approval. Food and
drinks are not allowed."*

Changes apply to new reservations and to rescheduling. Existing reservations keep the
policies they were booked with. A Pending request stays Pending if a room stops
requiring approval, and an Admin decides it. Every change is recorded in the
**Audit Log**.

Other Super Admin areas:
- **Ministries:** add, rename, reorder, deactivate.
- **Users & Roles:** invite, set Admin or Super Admin, disable or re-enable. The last
  active Super Admin can't be demoted or disabled.
- **Settings:** timezone, bookable hours, time increments, minimum notice, default
  advance limit, guest cancellation, and extra notification emails.
## PWA behavior

Reserve-A-Room can be installed on phones, tablets and desktops (manifest:
`src/app/manifest.ts`, icons in `public/icons/`).

- **Installing:**
  - **Chrome, Edge and Android:** a small "Install this app" card appears on public pages
    a few seconds after loading.
  - **iPhone and iPad:** the same card opens step-by-step "Add to Home Screen"
    instructions.
  - **Where it's hidden:** during a reservation (`/reserve`, `/reservation/...`) and when
    already running as an installed app.
  - **Dismissing:** "Not now" hides the card for 30 days. The footer's **Install app**
    link stays available.
- **Offline:**
  - The service worker (`public/sw.js`) pre-caches only the offline page, the assets it
    needs and the brand images.
  - When a page can't load, "You're offline" is shown, and it reloads by itself when the
    connection returns.
  - Availability, reservations and the staff portal are never cached, and nothing can be
    submitted offline. The reservation form also disables submission while offline.
  - Private reservation links (`/reservation/...`) are never handled by the service
    worker.
- **Updates:** each deployment registers `/sw.js?v=<commit>`, which installs a fresh
  worker and removes the previous version's caches. `/sw.js` is served with `no-cache`
  headers.
- **Development:** the service worker is registered only in production builds
  (`npm run build && npm run start`), so `npm run dev` is never affected by caching.

## Testing

| Command | What it runs | Needs |
| --- | --- | --- |
| `npm test` | Unit tests (Vitest): validation, date/time and DST math, availability, policies, email templates, formatting | nothing |
| `npm run test:db` | Database tests: the real migrations on [PGlite](https://pglite.dev) (Postgres compiled to WebAssembly). They cover RLS, grants (catalog-wide function allowlist), triggers, the exclusion constraint, the status machine, guest tokens, the email outbox, and TypeScript/SQL parity | nothing (no Docker) |
| `npm run test:e2e` | Playwright end-to-end tests against a production build | Chromium (`npx playwright install chromium`) |
| `npm run check` | Typecheck + lint + unit + database tests | nothing |

**End-to-end suite** (`e2e/`):
- **How it runs:** Playwright starts `e2e/support/mock-supabase.ts`, a **test-only** stand-in
  for Supabase that runs the real migrations on PGlite, with a minimal auth server and
  fixed test accounts. It then builds the app into `.next-e2e` and serves it on
  port 3300. No network, credentials or email provider are involved. Emails are processed
  and recorded as "Not sent".
- **Guest flows:** instant reservation, the private-link cookie, guest cancellation (and
  the released time), validation and focus, and unavailable rooms.
- **Approval flows:** request → approve with a message → guest sees it, decline with a
  private note that never reaches the guest, and the email log's "Send again".
- **Double booking:** two visitors submit overlapping times at the same moment. Exactly
  one wins, and the other is sent back with a clear message.
- **Staff access:**
  - sign-in (wrong password, redirect back, sign out) and off-site `next=` rejection;
  - Admin vs Super Admin pages;
  - the cron secret.
- **Quality:**
  - axe WCAG 2.2 AA on 23 pages in light and dark mode;
  - no horizontal scrolling at 320, 768 and 1920 px;
  - security headers.
- **PWA:** manifest and icons, the offline fallback, and that nothing private is cached.

To use an already-installed Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome`.
The mock can also be run by hand for manual QA: `npm run e2e:mock`. Then start the app with
`NEXT_PUBLIC_SUPABASE_URL=http://localhost:54400`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=e2e-mock-anon-key` and
`SUPABASE_SERVICE_ROLE_KEY=e2e-mock-service-key`. Test accounts are in
`e2e/support/accounts.ts`.

**CI:** `.github/workflows/ci.yml` runs `npm run check` and the end-to-end suite on every
push to `main` or `claude/**` and on pull requests.

## Production deployment & domain

Follow these steps in order the first time. Each one is done by the owner, in the
relevant dashboard.

**1. Database (Supabase)**
1. Apply the migrations (see [Database migrations](#database-migrations)):
   `npx supabase login`, then `npx supabase link --project-ref atnwrwrehexnwgqqnyek`,
   then `npx supabase db push`.
2. Complete [Supabase setup](#supabase-setup):
   - sign-ups off
   - Site URL and redirect URLs
   - no Supabase SMTP or auth-template setup is needed; the app sends through Resend
3. In Supabase → Storage, confirm the `room-images` bucket exists. The migrations create
   it.

**2. Vercel project**
1. **Environment variables:** set every variable in the table above for Production (and
   Preview, if previews should work fully).
2. **Branch:** confirm the reviewed commit is merged to `main`; Vercel already tracks
   `main` as the production branch.
3. **Deploy:** confirm the `main` deployment succeeds after the database migration step.

**3. Custom domain**
1. In Vercel → Settings → Domains, add `reservearoom.stonehillchurch.org`.
2. Vercel shows the exact DNS record to create, usually a `CNAME` for `reservearoom`.
   Add it where `stonehillchurch.org`'s DNS is managed. Use the value Vercel displays,
   not one copied from elsewhere.
3. Wait for Vercel to show the domain as valid. HTTPS is issued automatically.
4. Set `NEXT_PUBLIC_APP_URL=https://reservearoom.stonehillchurch.org` and redeploy.

**4. First administrator**
1. Run `npm run bootstrap:super-admin` from your computer (see
   [First Super Admin bootstrap](#first-super-admin-bootstrap)). Then open the link and
   choose a password.
2. Sign in at `/admin`, review **Settings**: contact email and phone, sender name,
   booking hours, and extra notification emails.
3. Review the **Conference Room** and add any other rooms.
4. Invite other administrators from **Users & Roles**.

**5. Smoke test (about 10 minutes)**
- [ ] `/rooms` and `/availability` load and show the Conference Room.
- [ ] Make a guest reservation with your own email. The confirmation email arrives, and
      its "View or cancel" link opens the reservation.
- [ ] Cancel it from the link. The cancellation email arrives, and the time is free again.
- [ ] For an approval-required room (create a test room if needed): submit a request →
      staff get the "New request" email and an in-app notification → approve it → the
      requester gets the approval email.
- [ ] On the reservation page, the email log shows every email as **Sent**.
- [ ] On a phone, the site fits the screen with no sideways scrolling, and "Install app"
      works.
- [ ] Sign out, and confirm `/admin` asks you to sign in.
- [ ] Delete or deactivate any test rooms.

**Ongoing**
- **Schema changes:** add a new file in `supabase/migrations/`, run `npm run db:types`,
  then `npx supabase db push`, then deploy.
- **Supabase Free:** projects pause after a week without activity. Normal use keeps the
  project active. If it pauses, restore it from the Supabase dashboard.
- **Backups:** Supabase Free keeps daily backups for a short period. Export important data
  (Supabase → Database → Backups, or `pg_dump`) if you need longer retention.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Pages say rooms can't be loaded right now | Supabase variables missing or wrong, migrations not applied (`npx supabase db push`), or the Supabase project is paused (restore it in the dashboard). |
| Guest submission fails with a server error in logs mentioning `GUEST_LINK_SECRET` or `RATE_LIMIT_SECRET` | Set both secrets in Vercel and redeploy. |
| Emails show "Not delivered: … domain is not verified" | `RESEND_FROM_EMAIL` must use the verified domain `reservearoom.stonehillchurch.org`. Fix it, redeploy, then press **Send again** on the reservation. |
| Emails show "Not delivered: Email delivery is not configured" | `RESEND_API_KEY` or `RESEND_FROM_EMAIL` is missing in production. |
| Emails show "Not sent: email delivery isn't configured" | Expected in local development and in previews without a Resend key. |
| Email links point at the wrong site | Set `NEXT_PUBLIC_APP_URL` for Production and redeploy. Previews link to their own URL on purpose. |
| Invitation or reset links say the link is invalid | Confirm `NEXT_PUBLIC_APP_URL`, the two Supabase public variables and the service-role key are valid in the active Vercel deployment. Links are single-use and expire; send a new one after fixing the variables. |
| "This account doesn't have access" after signing in | The account has no active staff profile. A Super Admin can re-enable it in **Users & Roles**. |
| A time slot can't be chosen although it looks free | It's too soon (minimum notice), outside bookable hours, or beyond the room's advance limit. Check Settings and the room's rules. |
| "That room was just reserved…" | Someone else took the time a moment earlier. Pick another time. The database never allows two reservations to overlap. |
| The installed app shows an old version | Close and reopen it. Each deployment installs a fresh service worker on the next visit. |
| Turnstile widget missing or failing | Both Turnstile keys must be set (or neither), and the site key must allow the production domain. |
| `npm run test:e2e` can't find a browser | Run `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. |
