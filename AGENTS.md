<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Reserve-A-Room agent handoff protocol

This file is the durable entry point for any agent continuing work on this repository. Keep it accurate whenever a work session changes the implementation state. Never remove or weaken the generated Next.js rules above.

## Mandatory pickup sequence

Before editing application code, every agent must:

1. Read this entire file.
2. Read `README.md`, `docs/ARCHITECTURE.md`, and `docs/ENHANCEMENTS_IMPLEMENTATION_PLAN.md`.
3. Run `git status --short --branch` and inspect all existing diffs. The worktree may contain valid work from a previous agent; never discard, overwrite, reset, or reformat unrelated changes.
4. Read the relevant Next.js 16.3.6 guides under `node_modules/next/dist/docs/` before changing Next.js code, as required by the generated rules above.
5. Confirm the current plan checkpoint and continue the first incomplete phase unless the user changes priorities.
6. Update the plan checkpoint and this file's live checkpoint before ending a substantial work session.

If `docs/ENHANCEMENTS_IMPLEMENTATION_PLAN.md` is missing, recreate it from the seven user requirements recorded below before implementing them.

## Project and production context

- Application: Reserve-A-Room for Stonehill Seventh-day Adventist Church.
- Production URL: `https://reservearoom.stonehillchurch.org`.
- Git production branch: `main`; Vercel tracks and deploys `main`.
- Stack: Next.js 16 App Router, React 19, TypeScript, Supabase Auth/Postgres/RLS/Storage, Resend, Tailwind CSS, Vitest, PGlite database tests, and Playwright.
- Application timezone: `America/Chicago`. Recurrence calculations and displayed reservation times must retain local wall-clock intent across DST changes.
- Supabase migrations are append-only once applied remotely. Create new timestamped migrations; do not edit already-applied migrations to change production behavior.
- Browser code must never receive the Supabase service-role key, Resend API key, cron secrets, rate-limit secrets, or guest-link secrets.
- Authorization must be enforced server-side and in Postgres/RLS or SECURITY DEFINER RPCs where applicable. Hiding or disabling a button is not an authorization boundary.
- All application-managed email, including invitations, password setup/reset, and new-admin activation notices, uses branded Resend templates. Supabase may generate/verify auth tokens but must not send the application emails.

## Requested enhancement scope

The user requested the original seven items plus twenty-one follow-up expansions below. Treat `docs/ENHANCEMENTS_IMPLEMENTATION_PLAN.md` as the detailed specification and source of implementation status.

1. Admins and Super Admins can create recurring room reservations: weekly (for example every Saturday), monthly by ordinal weekday (for example first or second Saturday), and an optional end date.
2. Add a premium floating bottom navigation bar on mobile, with agent-selected high-value menu items and no regression to desktop navigation.
3. Add `Developed By TechiLounge` to the footer. Only `TechiLounge` is linked to `https://techilounge.com`, and it opens in a separate tab with safe `rel` attributes.
4. Audit Trail records Admin and Super Admin login events / last-login activity.
5. Prevent accidental disabling of the Super Admin account. The UI control must be disabled, and the server/database must enforce the invariant.
6. Notify Super Admins by email when an invited Admin accepts the invitation and signs in for the first time. Delivery must be idempotent.
7. Add a polished `#dea621` gold ring treatment to room-selection cards on `/reserve`, including selected, hover, keyboard-focus, dark-mode, and accessible-contrast states.
8. Expand recurring schedules to daily/every-X-days, weekdays, every-X-weeks on multiple weekdays, monthly day-of-month or ordinal-weekday intervals, and fixed-date or ordinal-weekday yearly rules. Expansion is capped at the earlier of one year or 50 instances.
9. Make the admin brand link return home and expose an Admin entry in the public top navigation for authenticated staff.
10. Implement `/privacy` and `/terms` from `privacy.md` and `terms-of-service.md`.
11. Require auditable Privacy Policy and Terms acceptance in the public reservation flow.
12. Allow Admins and Super Admins to export filtered reservations as Excel-compatible CSV and branded PDF.
13. Support complex monthly schedules such as second and fourth Saturday through an `Add week of month` control, show series start/end dates in the preview, and surface unapplied database migrations clearly.
14. Show the year on reservation preview and reservation-list dates.
15. Add live Audit Log search, preset/custom date filtering, and pagination across the complete result set.
16. Allow Super Admins to upload and automatically compress up to four supported room images, with a 2 MB per-image limit.
17. Add a focused public recurring-reservation request flow and staff review experience without expanding the standard reservation wizard.
18. Add a clickable Availability link to the `/reserve` introduction.
19. Diagnose the production Turnstile connection error and provide actionable failure/retry feedback without weakening verification.
20. Email opted-in Admins and Super Admins for every new reservation and every requester- or staff-initiated cancellation.
21. Use a branded, accessible confirmation dialog instead of native browser confirmation prompts across the app.
22. Make Audit Log search match copied human-readable entry titles such as `Amenity created · Chairs` across the full result set.
23. Restore the room edit page when the application runs briefly against a database where the gallery migration is not yet available.
24. Make every uploaded room image selectable from the public room detail page, with clear active state and keyboard accessibility.
25. Add an intuitive Admin/Super Admin recurring-reservations how-to guide covering every supported scenario, with sidebar and mobile navigation access.
26. Let Super Admins safely resend a fresh branded password-setup link for an active administrator whose invitation is still unaccepted.
27. Send the requester a branded acknowledgement whenever they submit a recurring-date request, while clearly stating that the dates are not yet confirmed.
28. Use the standard configured time dropdowns in the recurring-date request form and retain every entered value when validation fails.

## Live checkpoint — 2026-09-27

### Completed and deployed before this enhancement request

- The initial database migrations were pushed to the hosted Supabase project.
- Production is deployed from `main` and the custom domain is active.
- Resend-branded auth emails were implemented.
- Commit `1148568` (`Complete production authentication and email setup`) is on `origin/main`.

### Password-setup reliability fix

A password-setup reliability fix was committed and pushed as `13d9042` (`Protect password setup links from email scanners`) and is present on both local `main` and `origin/main`. It replaces token-consuming `GET /admin/auth/confirm` behavior with a non-consuming confirmation page plus a user-initiated Server Action. This prevents email security scanners from consuming one-time links and prevents expired-link failures from being silently masked by a redirect to `/admin`. On 2026-09-25, `gh api repos/techilounge/Reserve-A-Room/commits/13d9042/status` reported a successful Vercel deployment for this commit; local `main`, `origin/main`, and `origin/HEAD` all resolve to it.

Files in that fix include:

- `src/app/admin/(auth)/auth/confirm/page.tsx` (new)
- `src/app/admin/(auth)/auth/confirm/actions.ts` (new)
- `src/app/admin/(auth)/auth/confirm/route.ts` (deleted)
- `src/lib/auth/setup-link.ts`
- `e2e/admin-access.spec.ts`
- `e2e/support/mock-supabase.ts`
- `docs/ARCHITECTURE.md`

Verification completed for that fix before commit:

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm test` passed: 20 files / 141 tests.
- `npm run build` passed.
- `npx playwright test e2e/admin-access.spec.ts` passed: 6 tests, using the installed Chrome executable through `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

### Enhancement implementation and rollout status

- All enhancement phases and the authorized production rollout are complete.
- `src/lib/recurrence/` supports daily intervals, weekdays, interval weekly rules on multiple days, monthly calendar-day and multi-ordinal-weekday intervals (such as second and fourth Saturday), yearly fixed-date and ordinal-weekday rules, inclusive boundaries, skipped/de-duplicated calendar dates, labels, validation, a one-year/50-instance cap, conflict grouping, and per-occurrence DST validation.
- New append-only migration `20260925100000_recurring_reservations.sql` adds typed series and exception tables, occurrence linkage, staff create/read/end RPCs, service-role lease claim/materialization RPCs, RLS/grants, audit entries, idempotency, and conflict/unavailable-room handling. `database.types.ts` was regenerated.
- All enhancement phases are complete locally: recurring UI/management and protected-cron materialization; multi-ordinal monthly rules and explicit preview boundaries; lifecycle audit/first-login email; Super Admin disable protection; mobile navigation and visual polish; legal pages and versioned required consent; bounded CSV/PDF exports; documentation; and integrated QA.
- Commit `a0d92f3` (`Add recurring reservations and admin enhancements`) is on local and remote `main`, and GitHub/Vercel reported a successful production deployment.
- The five append-only migrations from `20260925100000` through `20260925140000` were applied successfully to the linked hosted Supabase project. A follow-up migration listing confirmed local/remote alignment.
- Before migration, Supabase reported no available physical backup and no PITR; Docker logical dumping was unavailable because WSL is not installed. With explicit user authorization, a temporary local snapshot of all REST-exposed public application relations was created outside the repository and checksum-verified, then removed after deployment and smoke checks passed.
- Production smoke checks passed for the public/legal pages, the non-submitting consent flow, unauthenticated admin/export redirects, cron authorization rejection, and the presence of the new database tables/RPCs. No production test reservation or email was created.
- Latest verification: `npm run check` passed (typecheck, lint, 26 unit-test files / 176 tests, and 11 database-test files / 137 tests); `npm run build` passed; `npm run test:e2e` passed 85/85; `git diff --check` passed; the changed-file secret-pattern scan passed; and rendered multi-page PDF inspection passed.
- Remaining operational follow-up: monitor Vercel/Supabase/Resend during normal use and complete authenticated production recurrence-create/export and first-login-email delivery checks when a staff test login is available.

### Phase 14-16 follow-up rollout status

- The Phase 14-16 follow-up requirements were committed as `43dccd1` (`Add reservation operations and admin reliability`), pushed to `origin/main`, and deployed successfully by Vercel on 2026-09-26.
- New append-only migrations are `20260926100000_audit_log_date_filters.sql`, `20260926110000_room_image_gallery.sql`, and `20260926120000_recurring_reservation_requests.sql`; `database.types.ts` was regenerated.
- Phase 15 adds append-only migration `20260926130000_staff_reservation_email_notifications.sql`, which completes branded staff emails for confirmed reservations and staff cancellations without duplicating the existing pending-request and requester-cancellation alerts.
- The application now uses year-inclusive compact dates in recurrence previews and reservation lists; server-side Audit Log search/date filters/pagination; ordered four-image room galleries with JPEG/PNG/WebP validation, a 2 MB limit, and browser compression; a focused public recurring-request flow with legal consent, rate limiting, staff notifications, and staff read-only review; and clean Availability/recurring-request discovery from `/reserve`.
- Production inspection confirmed the Turnstile script and iframe are allowed and load under the application CSP. A later `110200` regression was traced to Cloudflare Hostname Management authorizing `reservearoom.stonehillchurch.com` instead of the live `.org` hostname. The widget was corrected to `reservearoom.stonehillchurch.org`, the production site key remained unchanged, and a live review-step smoke test reached Cloudflare's `Success!` state without submitting a reservation. The application retains actionable callback codes and retry behavior for future failures.
- A narrow public-catalog compatibility fallback retries without `image_paths` only for PostgreSQL missing-column error `42703`, so the local/pre-migration homepage remains available while unrelated database failures still surface.
- The four append-only migrations `20260926100000` through `20260926130000` were applied to the hosted Supabase project through the authenticated SQL editor because outbound PostgreSQL ports were blocked on the rollout host. Each migration ran in its own transaction and was recorded in `supabase_migrations.schema_migrations`; a follow-up query confirmed all four versions and the gallery column/RPC, recurring-request table/RPC, and staff-email trigger.
- After the compatibility fix, `npm run typecheck` and `npm run lint` passed, and `http://localhost:3000` returned HTTP 200 with the room catalog rendered against the pre-migration database.
- Final Phase 15 verification: typecheck and lint passed; 28 unit-test files / 184 tests passed; 11 database-test files / 140 tests passed; `npm run db:types` regenerated 15 tables / 55 functions / 6 enums; the production build passed; 14 focused Playwright reservation/approval/recurrence tests passed; the complete Playwright suite passed 92/92; and `git diff --check` passed.
- Phase 16 adds a reusable branded confirmation dialog and removes the final `window.confirm`; normalizes Audit Log punctuation and requires every search term to match the combined action/actor/entity/id/metadata text before pagination; and falls back to the legacy room image only for missing gallery-RPC errors during a rolling or pre-migration deployment.
- Phase 16 verification: typecheck and lint passed; 28 unit-test files / 185 tests passed; 11 database-test files / 141 tests passed; the production build passed; the custom-confirmation and exact-title Audit Log focused checks passed 2/2; room-detail light/dark accessibility checks passed 2/2; the complete Playwright suite passed 92/92; and `git diff --check` passed (with pre-existing line-ending notices only).
- Vercel reported `Deployment has completed` for `43dccd1`. Production smoke checks returned HTTP 200 for `/`, `/reserve`, `/recurring-request`, `/privacy`, `/terms`, and `/availability`.
- Remaining operational follow-up: monitor Supabase, Vercel, Resend, room-image uploads, recurring requests, and staff lifecycle emails during normal production use. No synthetic production reservation or cancellation was created during this rollout.

### Phase 17 local follow-up status

- Public room details now use a focused client-side gallery whose thumbnail buttons update the large preview, retain access to the primary image, expose `aria-pressed` state, and support native keyboard activation.
- The E2E Supabase mock serves two room images and the focused Playwright test verifies pointer and keyboard selection. Local private-IP image optimization is allowed only when `NEXT_PUBLIC_SUPABASE_URL` explicitly points to `localhost` or `127.0.0.1`; production remains limited to the public Supabase storage path.
- Verification: typecheck and lint passed; 28 unit-test files / 185 tests passed; 11 database-test files / 141 tests passed; the production build passed; the focused room-gallery Playwright test passed 1/1; and the complete Playwright suite passed 93/93.
- Phase 17 was committed as `f1a35d2` (`Make room galleries interactive`), pushed to `origin/main`, and deployed successfully by Vercel. A production HTTP check returned 200 with the gallery markup, and a live headless-browser check confirmed that selecting the second Main Sanctuary thumbnail updates the large preview and `aria-pressed` state.
- No migration was required. Next: monitor normal production use and investigate only if room-image or gallery telemetry reports a failure.

### Phase 18 rollout status

- `/admin/recurring-guide` documents all eight practical recurrence scenarios using the exact New reservation field labels, examples, edge cases, limits, conflict behavior, and post-creation actions.
- `Recurring Guide` is permission-filtered for both active staff roles in the desktop sidebar and mobile More sheet. Guide calls to action link to the new `#recurrence` scroll target in the create form.
- Verification: typecheck and lint passed; 28 unit-test files / 185 tests passed; 11 database-test files / 141 tests passed; the production build passed; focused guide tests passed 2/2; focused light/dark accessibility/responsive tests passed 2/2; and the complete Playwright suite passed 97/97.
- No migration was required. Phase 18 was committed as `0687c40` (`Add recurring reservations guide`), pushed to `origin/main`, and deployed successfully by Vercel on 2026-09-27.

### Phase 19 rollout status

- Users & Roles marks active invited profiles with no acceptance timestamp as `Invitation pending` and offers a confirmation-protected `Resend invite` action.
- The Server Action reasserts Super Admin permission and reloads the profile before generating a fresh recovery/setup token and sending the existing branded invitation template. Ineligible profiles fail closed. Password setup now invokes the idempotent invitation lifecycle RPC for invite and recovery setup sessions so a resent link preserves the one-time acceptance audit and notification.
- No migration is required. Verification: typecheck and lint passed; 28 unit-test files / 185 tests passed; 11 database-test files / 141 tests passed; the production build passed; the focused resend check passed 1/1; the focused Admin access file passed 10/10; and the complete Playwright suite passed 98/98.
- Phase 19 shipped with Phases 20–21 in commit `1c2e55d` (`Improve invitations and recurring requests`), which was pushed to `origin/main` and deployed successfully by Vercel on 2026-09-27.

### Phase 20 rollout status

- Recurring-date request inserts now queue one idempotent branded acknowledgement to the requester
  through the existing durable system-email outbox. The request Server Action schedules an immediate
  post-response attempt, and the existing cron continues to retry queued or failed delivery.
- New append-only migration `20260927100000_recurring_requester_confirmation_email.sql` adds the
  transactional queue trigger and extends service-role email context with the recurring request and
  room. The user confirmed it was applied to the hosted project on 2026-09-27.
- Verification: typecheck and lint passed; 28 unit-test files / 186 tests passed; 11 database-test
  files / 141 tests passed; the production build passed; the focused recurring-request browser test
  passed 1/1; and the complete Playwright suite passed 98/98.
- Phase 20 shipped with Phases 19 and 21 in commit `1c2e55d`; Vercel reported a successful production deployment after the migration was applied.

### Phase 21 rollout status

- The recurring-date request form now uses the same configured booking grid and native-select styling
  as the one-time reservation flow. End times unlock after a start selection and include only later
  boundaries; the Server Action rejects off-grid times independently.
- All visible inputs use one controlled client draft. Hydrated submission dispatches the Server Action
  without the framework's automatic form reset, and every error response carries the submitted values
  as a progressive-enhancement fallback.
- Verification: typecheck and lint passed; 28 unit-test files / 186 tests passed; 11 database-test
  files / 141 tests passed; the production build passed; the focused browser regression passed 1/1;
  and the complete Playwright suite passed 98/98.
- No migration is required for Phase 21. Phases 19–21 shipped in commit `1c2e55d`; production smoke checks returned HTTP 200 for `/`, `/reserve`, `/recurring-request`, and `/admin/login`.

### Phase 22 local follow-up status

- **Duplicate staff emails:** root cause documented as ADR-42. Series occurrences no longer queue per-reservation staff emails; creating a series queues one `recurring_series_staff_created` summary per staff recipient. Append-only migration `20261003100000_series_staff_email_summary.sql` also deletes still-queued per-occurrence staff emails. **Applied to the hosted project on 2026-10-03** with `supabase db push`; a follow-up query confirmed no per-occurrence staff emails remain queued.
- **Primary image:** the room editor's image list has a `Make primary` button on every non-primary image (reorder only; the first path is the primary). No schema change.
- **10 MB source images:** accepted source size is 10 MB; the browser compresses stepwise to under 1.5 MB and rejects an image that cannot fit under the unchanged 2 MB storage cap. Browsers that cannot encode WebP fall back to JPEG.
- Verification: typecheck and lint passed; 28 unit-test files / 192 tests passed; 11 database-test files / 142 tests passed; the production build passed; the complete Playwright suite passed 99/99.
- Rollout: the code was deployed from `45de824` first, then the migration was applied. `20260927100000_recurring_requester_confirmation_email.sql` had been run earlier through the SQL editor without a ledger entry, so it was marked applied with `supabase migration repair --status applied 20260927100000` before the push.
- Still to observe: the next recurring series created should send each opted-in staff member one "New recurring reservation" email.

### Phase 23 local follow-up status

- **Export limits removed:** reservation CSV/PDF exports no longer require dates, no longer default to the current year, and no longer stop at one year or 1,000 rows. No dates means every matching reservation ("All dates" in the PDF header); `from`/`to` are optional bounds. Details are in ADR-33.
- Append-only migration `20261004100000_unbounded_reservation_export.sql` replaces `admin_export_reservations` with optional `p_from`/`p_to` and a new `p_offset`. **Not yet applied to the hosted project.** It accepts every call the previous version did, so it is safe to apply before or after the deploy.
- The server reads pages of 1,000 until a short page ends the result. A safety ceiling of 20,000 rows fails with HTTP 413 and a clear message rather than returning a truncated file. `database.types.ts` was regenerated.
- Verification: typecheck and lint passed; 29 unit-test files / 198 tests passed; 12 database-test files / 147 tests passed (including a 1,100-row paging test); the production build passed; the complete Playwright suite passed 99/99.

## Required quality gates

Run checks proportionate to each phase and run the complete relevant suite before production handoff:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:db
npm run build
npm run test:e2e
```

On this Windows machine, Playwright can use the installed browser without downloading another copy:

```powershell
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:e2e
```

Never claim a check passed unless it was run successfully in the current worktree. Record infrastructure-caused skips or failures explicitly.

## Handoff discipline

- Implement in small, reviewable phases matching the implementation plan.
- Add or update tests in the same phase as behavior changes.
- Update `README.md` and `docs/ARCHITECTURE.md` when setup, schema, security boundaries, routes, or operator workflows change.
- Mark completed plan tasks and record the exact next task, unresolved decisions, migration names, and latest verification results in the plan's checkpoint section.
- Do not place credentials, token hashes, private URLs, or `.env.local` values in tracked files, commits, logs, screenshots, or handoff notes.
- Do not deploy, mutate production data, or push schema changes merely to test an idea. Validate locally first, then provide the user with an explicit production rollout and rollback checklist.
