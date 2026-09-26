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

The user requested the original seven items plus six follow-up expansions below. Treat `docs/ENHANCEMENTS_IMPLEMENTATION_PLAN.md` as the detailed specification and source of implementation status.

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

## Live checkpoint — 2026-09-26

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
