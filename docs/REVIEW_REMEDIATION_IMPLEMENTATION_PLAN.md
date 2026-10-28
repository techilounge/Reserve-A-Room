# Review remediation implementation plan

**Created:** 2026-10-27

**Baseline:** `1f287eecb0979f40339011a49ab3b99508ec6514` (`main`, `origin/main`, Vercel production)

**Status:** Local remediation changes prepared; preview and production rollout remain outstanding

**Owner checkpoint:** Review the local changes and the migration-first rollout before any production deployment

This plan turns the 2026-10-27 application review into small, independently
deployable remediation phases. It supplements
`docs/ENHANCEMENTS_IMPLEMENTATION_PLAN.md`; it does not replace the feature history
or its production migration record.

## 1. Objectives and guardrails

The remediation must:

1. Remove known critical and high-risk production dependency vulnerabilities.
2. Make email retries idempotent across worker claims, not only within one HTTP call.
3. Prevent user-management actions from reporting success when Supabase Auth and the
   application profile disagree.
4. Make Turnstile and rate-limit failures explicit and fail safely.
5. Enforce the documented Server Action request-body limit.
6. Keep the cron safety-net within its execution budget and make partial work visible.
7. Reconcile operator and handoff documentation with the deployed state.

Guardrails:

- Do not weaken RLS, database constraints, Turnstile, rate limiting, or authentication
  to make a test pass.
- Keep the service-role key, Resend key, and all other secrets server-only.
- Prefer code-only changes. If a database change becomes necessary, add an append-only
  timestamped migration; never edit an applied migration.
- Use a `codex/` branch and a Vercel preview for each deployable phase. Do not develop
  directly against production data.
- Preserve the current user-facing flows and branded email appearance unless a phase
  explicitly changes error handling.
- Update this document and `AGENTS.md` at the end of every substantial phase.

## 2. Issue-to-phase traceability

| Review finding | Severity | Remediation phase |
| --- | --- | --- |
| Next.js 16.3.6 critical/high advisories | Critical | R1 |
| Vulnerable Zod, Sharp, shadcn/transitive production tree | High | R1 |
| Email retry idempotency changes with `attempt_count` | High | R2 |
| Re-enable action can return a false success | High | R3 |
| Partial Turnstile configuration silently disables verification | Medium | R4 |
| Rate limiter fails open for all workflows | Medium | R4 |
| Documented 16 KB Server Action limit is absent | Low/defense-in-depth | R4 |
| Cron can exceed its 60-second execution budget | Medium | R5 |
| Handoff/deployment/export documentation is stale | Low | R0 and R6 |

## 3. Required phase order

Use this sequence:

1. **R0 — Baseline and documentation reconciliation**
2. **R1 — Critical dependency remediation**
3. **R2 — Durable email idempotency**
4. **R3 — Consistent administrator enable/disable operations**
5. **R4 — Abuse-control and request-size hardening**
6. **R5 — Bounded cron processing and observability**
7. **R6 — Integrated verification, production rollout, and final documentation**

R2 must precede R5 because shortening or retrying cron batches without stable email
idempotency can increase duplicate-delivery risk. R1 is first because it addresses
known critical runtime vulnerabilities.

## 4. Phase R0 — Baseline and documentation reconciliation

### Scope

- Confirm `main`, `origin/main`, and the latest successful Vercel deployment still point
  to `1f287ee` or record the newer baseline before beginning.
- Record current production migration versions without modifying the database.
- Correct the historical Phase 24–26 status in `AGENTS.md` and
  `docs/ENHANCEMENTS_IMPLEMENTATION_PLAN.md`: those commits are on `origin/main`, and
  Vercel reported a successful deployment for `1f287ee`.
- Remove the obsolete plan statement that exports always require a bounded date range.
  Preserve the actual 20,000-row server safety ceiling and optional date bounds.
- Capture the current `npm audit --omit=dev` report in the phase notes without placing
  secrets, tokens, or private URLs in tracked files.

### Acceptance criteria

- Handoff documents agree on the deployed commit and Phase 24–26 status.
- Export documentation consistently describes optional date filters, paged retrieval,
  and the 20,000-row failure ceiling.
- The worktree contains documentation-only changes in this phase.

### Verification

```powershell
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
gh api repos/techilounge/Reserve-A-Room/commits/HEAD/status
```

No deployment is required for R0.

## 5. Phase R1 — Critical dependency remediation

### Design

1. Read the Next.js 16.4.x upgrade notes and the relevant guides under
   `node_modules/next/dist/docs/` before changing framework configuration or APIs.
2. Upgrade `next` and `eslint-config-next` together to at least the audit-fixed version
   (`16.4.3` at planning time). Use the newest compatible patched 16.4.x release available
   at implementation time after reviewing its release notes.
3. Upgrade direct dependencies to at least:
   - `zod >= 4.6.6`
   - `sharp >= 0.35.5`
4. Determine whether the `shadcn` CLI is used by any package script or runtime import.
   If not required after component generation, remove it. If the team wants to retain the
   CLI, move it to `devDependencies` and upgrade it so it does not expand the production
   dependency tree.
5. Regenerate `package-lock.json` with the repository's supported Node/npm versions.
6. Review every remaining production audit finding. Do not use a broad `npm audit fix
   --force`; apply intentional version changes and document any accepted residual risk.
7. Add or enable automated dependency-update monitoring for npm if the repository owner
   wants ongoing patch PRs. Keep major framework upgrades manual.

### Files expected to change

- `package.json`
- `package-lock.json`
- possibly `.github/dependabot.yml`
- compatibility changes identified by typecheck/build/tests
- `README.md`, `docs/ARCHITECTURE.md`, and this checkpoint if runtime requirements change

### Focused regression checks

- Next Image Optimization renders all public room gallery images.
- `/reserve` and `/recurring-request` Server Actions submit successfully.
- Password setup/recovery links still require the user-initiated confirmation step.
- Admin authentication, protected redirects, and exports still behave correctly.
- CSP and security headers remain present on public and admin responses.

### Acceptance criteria

- `npm audit --omit=dev` reports no critical or high findings. If an upstream-only
  exception remains, it has a linked advisory, documented reachability analysis, owner,
  and review date.
- The production install no longer includes the shadcn CLI unless a documented runtime
  reason exists.
- All required quality gates pass on the upgraded framework.
- A Vercel preview passes public, authentication, room-image, Server Action, and export
  smoke tests before production promotion.

### Rollback

- Roll back the deployment to the previous Vercel build if framework behavior regresses.
- Keep the secure dependency commit available for a corrected follow-up; do not treat a
  permanent downgrade to a vulnerable Next.js version as the remediation.

## 6. Phase R2 — Durable email idempotency

### Root cause

`src/lib/email/outbox.ts` and `src/lib/email/system-outbox.ts` include
`attempt_count` in the Resend idempotency key. A row reclaimed after a lost response or a
failed `complete_*` RPC therefore looks like a new email to Resend.

### Design

1. Derive the provider idempotency key from immutable outbox identity and namespace only,
   for example the outbox table plus row UUID and an explicit format version. It must not
   include attempt count, status, timestamps, or mutable payload fields.
2. Use the same immutable key for immediate post-response delivery and cron recovery.
3. Retain `attempt_count` for retry limits and diagnostics only.
4. Preserve the rule that a reservation transaction succeeds independently of email
   delivery.
5. Record completion failures prominently. If an email has a provider message ID but its
   completion RPC fails, emit structured logs containing the outbox ID and provider ID,
   never recipient content or tokens.
6. Review Resend's current idempotency retention guarantee during implementation. Ensure
   the claim/retry window completes inside that guarantee, or add an explicit terminal
   `delivery_unknown`/manual-review design before retrying outside it.
7. Prefer a code-only change. If an immutable provider key must be stored, add an
   append-only migration with a unique constraint and backfill derived from row IDs.

### Tests

- Same outbox row and multiple attempt counts produce exactly the same idempotency key.
- Different outbox rows and different outbox namespaces produce different keys.
- Simulate: Resend accepts, `complete_email` fails, the stale claim is reclaimed, and the
  second send uses the original key.
- Repeat the same scenario for `system_email_logs`.
- Existing template, recipient, reply-to, and non-production skip tests continue passing.

### Acceptance criteria

- A reclaimed row cannot intentionally create a second Resend message within the
  provider's idempotency window.
- No guest token, email address, or rendered body is used in the key or structured logs.
- Unit and database tests cover the lost-completion scenario.

### Rollout and observation

- Deploy the code before changing cron throughput.
- Watch Vercel and Resend for completion-RPC failures, repeated outbox IDs, and duplicate
  provider messages for at least one normal notification cycle.
- No synthetic production reservation is required; a test email may only be sent with
  explicit owner authorization.

## 7. Phase R3 — Consistent administrator enable/disable operations

### Design

Because Supabase Auth and `public.profiles` cannot share one transaction, use a deliberate
operation order and never hide partial failure:

#### Enable

1. Reassert `users.manage` permission and reload the target profile.
2. Unban the Supabase Auth user first.
3. Only after Auth succeeds, call `set_user_active(..., true)`.
4. If profile activation then fails, return an error and log the safe partial state: Auth
   is unbanned but application/RLS access remains inactive.

#### Disable

1. Reassert permission and reload the target profile.
2. Call `set_user_active(..., false)` first so application and RLS access is revoked.
3. Ban the Auth user.
4. If the Auth ban fails, return a partial-failure error stating that application access
   is revoked but the Auth ban must be retried. Do not return `ok: true`.

Keep the database's Super Admin protection (`RAR11`) and last-active-Super-Admin trigger
as the authoritative boundary. UI button disabling remains usability only.

### Additional behavior

- Make already-enabled and already-disabled requests idempotent.
- Add an audit entry or structured operational event for partial cross-system failures.
- Do not expose raw Supabase errors to the browser.
- After success, reload both profile and Auth state where practical before showing the
  final status.

### Tests

- Enable: Auth succeeds/profile succeeds.
- Enable: Auth fails; profile RPC is never called and UI receives an error.
- Enable: Auth succeeds/profile fails; UI receives a partial-state error.
- Disable: profile succeeds/Auth succeeds.
- Disable: profile fails; Auth call is not made.
- Disable: profile succeeds/Auth fails; action returns an explicit partial failure.
- Super Admin disable attempts remain rejected server-side and in the database.

### Acceptance criteria

- The action never reports success when either required system update fails.
- A failed enable never grants application access accidentally.
- A failed disable always leaves application/RLS access revoked if the profile RPC had
  succeeded, with a visible retry path for the Auth ban.

## 8. Phase R4 — Abuse-control and request-size hardening

### R4.1 Turnstile configuration

Replace the current boolean configuration check with an explicit state:

- **disabled:** neither key is present; allowed only in local/test or an explicitly
  documented environment.
- **enabled:** both keys are present.
- **invalid:** exactly one key is present; log a configuration error and fail closed.

For invalid configuration, do not silently hide the widget and accept submissions. Show a
recoverable branded message such as "Verification is temporarily unavailable" without
revealing configuration details. Add a deployment/health check that detects mismatched
keys before production promotion.

### R4.2 Rate-limit availability

Change `hitRateLimit` from a boolean to a typed result such as `allowed`, `denied`, or
`unavailable`, or make failure policy explicit per rule.

- Login and password-reset limiter failures must fail closed with a generic recoverable
  response.
- Reservation, recurring request, guest lookup, and cancellation limiter failures should
  return a temporary-unavailable response rather than silently bypassing the limiter.
- Continue avoiding account-existence disclosure in authentication responses.
- Log rule bucket and request correlation data, never raw email addresses or IP addresses.

### R4.3 Server Action body limit

- Configure `serverActions.bodySizeLimit: "16kb"` in `next.config.ts`, matching the
  architecture decision.
- Confirm all existing Server Action payloads fit comfortably below the limit.
- Room images must continue uploading directly to Supabase Storage and must not pass
  through a Server Action.
- Add an oversized-payload regression test that receives a controlled rejection without
  invoking application mutation logic.

### Tests

- Both Turnstile keys absent in test/local: explicitly disabled behavior.
- Both keys present: widget renders; correct action/hostname passes; wrong values fail.
- Site key only and secret key only: submissions fail safely and visibly.
- Cloudflare timeout/non-JSON/5xx: input is retained and the visitor can retry.
- Every rate-limited workflow handles `allowed`, `denied`, and `unavailable` separately.
- Login/password-reset responses remain enumeration-resistant.
- 16 KB boundary and oversized action payload behavior are covered.

### Acceptance criteria

- No partial environment configuration can disable Turnstile silently.
- No limiter infrastructure error is interpreted as an allowed request.
- The effective framework body cap matches the documented 16 KB value.
- Public form drafts remain intact after all recoverable verification errors.

## 9. Phase R5 — Bounded cron processing and observability

### Design

1. Separate recurrence materialization from email sweeping into independently protected
   cron handlers, or introduce an explicit time-budgeted coordinator. Separate handlers
   are preferred because they isolate failures and execution budgets.
2. Keep constant-time bearer-secret comparison and 401 rejection on every cron route.
3. Use bounded batches sized from measured preview/production latency. Do not claim 100
   emails if the worker cannot normally finish them before the function deadline.
4. Process small email groups with bounded concurrency if Resend's current rate limits
   allow it; otherwise process smaller sequential batches. Never start work that cannot
   be completed or safely reclaimed.
5. Reserve shutdown margin before `maxDuration`. Stop claiming new rows when the deadline
   approaches and return counts for claimed, sent, failed, skipped, and remaining work.
6. Add request timeouts/abort signals for Resend and relevant external calls.
7. Emit structured summaries with duration and outbox IDs on failures. Do not log message
   bodies, guest links, tokens, recipient addresses, or secrets.
8. Keep stale-claim recovery, now protected by the stable idempotency design from R2.

### Tests

- Unauthorized requests return 401 without doing database work.
- A slow/failing email does not prevent the worker from returning a bounded result.
- Deadline exhaustion leaves unclaimed rows queued and safely reclaimable.
- Concurrent workers do not claim the same rows.
- Materialization failure does not prevent the email sweep when routes are separated.
- Email failure does not prevent recurrence materialization.
- Vercel cron configuration references only existing protected routes.

### Acceptance criteria

- Each handler finishes with margin inside its configured maximum during a worst-case
  preview test using intentionally delayed provider mocks.
- Partial work is observable and safely resumes on the next run.
- No timeout scenario produces duplicate provider messages in the idempotency window.

### Rollback

- Keep the previous cron route available for one deployment only if needed for rollback,
  but ensure Vercel schedules exactly one active worker for each responsibility.
- A rollback must not reintroduce mutable email idempotency keys.

## 10. Phase R6 — Integrated verification and production rollout

### Full local gates

Run from a clean worktree:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:db
npm run build
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:e2e
npm audit --omit=dev
git diff --check
```

Also run a tracked-file secret scan without printing environment-variable values.

### Preview validation

Validate at minimum:

- `/`, `/rooms/[slug]`, `/availability`, `/reserve`, `/recurring-request`, `/privacy`,
  and `/terms`.
- One-time and recurring-request validation failures retain entered data.
- Turnstile success, rejection, timeout, and invalid-configuration behavior.
- Admin login, password reset, password setup, logout, and protected redirect behavior.
- Admin user enable/disable success and mocked partial-failure paths.
- Room gallery images through Next Image Optimization.
- Staff reservation management, recurrence creation, CSV export, and PDF export.
- Cron authorization and bounded mocked processing.
- Light/dark mode, 320 px mobile layout, keyboard navigation, and axe checks for changed
  screens.

### Production sequence

1. Confirm all required environment-variable names exist without exposing their values.
2. Confirm Turnstile site/secret keys are both configured for production.
3. Review the current combined local changes and test in a separate preview environment.
4. Before migration, inventory queued, failed and sending email rows and check Resend;
   pause/avoid email-generating activity and wait for old workers to finish. Older
   manually requeued rows may have had their attempt counts reset, so SQL state alone
   cannot identify every previously attempted email. Decide the disposition of each
   ambiguous row rather than blindly sending it.
5. Apply `20261027100000_email_delivery_retry_guard.sql` with explicit owner authority,
   then deploy the matching application code promptly. The new application requires
   `prepare_email_delivery`; deploying the code before the migration stops email delivery.
   The migration parks existing failed/sending attempts for review. Because the previous
   application uses a different idempotency-key format, do not run old workers on parked
   or previously attempted records after migration.
6. Observe both new daily cron routes, old queued rows, flagged review items, Turnstile,
   admin account changes and Resend delivery. Small cron batches can require multiple
   daily runs for a backlog on Hobby; monitor `moreMayRemain` and use an explicitly
   authorized protected invocation if needed.
7. Verify the deployed SHA and Vercel status. A code rollback must account for the new
   retry guard and cron schedules; do not redeploy old workers that can bypass it.

### Production smoke checks

- Public pages return 200 and retain security headers.
- `/admin` redirects unauthenticated users to `/admin/login`.
- Unauthorized cron requests return 401.
- Turnstile reaches a valid Cloudflare success state without submitting synthetic data.
- Confirm no spike in duplicate email provider IDs, stale `sending` rows, login failures,
  or rate-limit-unavailable events.
- Do not create a synthetic production reservation, cancellation, or staff invitation
  without explicit owner authorization.

### Final documentation

- Update `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, and this document with exact
  commits, migration versions, audit result, test counts, deployment status, and remaining
  operational follow-up.
- Record any accepted audit exception with an owner and review date.
- Mark this plan complete only after production smoke checks and observation are recorded.

## 11. Definition of done

The remediation program is complete only when:

- No reachable critical or high production dependency advisory remains undocumented.
- Reclaimed email rows reuse an immutable provider idempotency key.
- User-management actions never return a false success across profile/Auth updates.
- Partial Turnstile configuration and limiter outages fail safely with usable messages.
- Server Actions enforce the documented 16 KB body limit.
- Cron work completes within budget, is observable, and resumes safely.
- The full quality gate and production smoke checklist pass.
- Repository handoff documentation matches the actual deployed state.

## 12. Live checkpoint

### 2026-10-27

- Review and remediation planning are complete.
- Baseline `1f287ee` is clean on local `main` and `origin/main`; GitHub reported successful
  CI and Vercel deployment for this SHA during the review.
- Review-time `npm run check` passed: 33 unit-test files / 227 tests and 12 database-test
  files / 147 tests, in addition to typecheck and lint.
- Review-time `npm audit --omit=dev` reported 11 vulnerabilities: 1 critical, 7 high,
  and 3 moderate.
- Phase R0 reconciled README, AGENTS, and the enhancement plan with the deployed
  Phase 24–26 commits and the optional-date/20,000-row export contract.
- The local migration set ends at `20261004100000_unbounded_reservation_export.sql`,
  matching the latest migration recorded as applied in the existing production handoff.
- No application, schema, environment, or production changes were required for R0.
- Phase R1 upgraded Next.js and `eslint-config-next` to 16.4.3, Zod to 4.6.7,
  Sharp to 0.35.5, and Vitest to 5.0.5. Patched shadcn 4.22.2 remains only as a
  development/build dependency because `globals.css` consumes its Tailwind stylesheet;
  Next 16.4 requires the exported stylesheet to be referenced by its installed path.
- `source-map-js` is overridden to patched version 1.2.2. The original R1 audit reported
  zero vulnerabilities, but a later registry audit reported a new deepmerge advisory;
  see the current exception below.
- Phase R1 verification passed: typecheck, lint, 33 unit-test files / 227 tests,
  12 database-test files / 147 tests, the production build, and Playwright 103/103.
- R2 uses immutable namespaced provider keys. New append-only migration
  `20261027100000_email_delivery_retry_guard.sql` records only a payload fingerprint and
  first-attempt time; changed payloads, legacy in-flight/failed attempts, or retries after
  23 hours are parked for manual review. Worker and PGlite tests cover lost completion
  and both outboxes. A provider timeout is still an ambiguous delivery outcome; aborting
  a request cannot prove Resend did not accept it. Check the provider before intervening.
- R3 orders Auth/profile updates and exposes an explicit way to retry a failed ban on an
  already-disabled profile. The database RPC rechecks Super Admin protection. Auth and
  database operations are separate systems; concurrent role/account changes and
  provider outages still require operational monitoring.
- R4 fails closed for partial Turnstile configuration and limiter outages, adds a
  production prebuild key check and 16 KB Server Action limit. The oversized HTTP-body
  boundary, both partial configurations in a real browser, and each limiter caller's
  outage path still need dedicated integration tests.
- R5 separates cron routes and caps each email sweep to six rows per outbox with two
  workers and a 12-second provider timeout that aborts fetch. This does not bound every
  database request or guarantee the 60-second deadline. Worst-case preview testing,
  operational backlog monitoring and concurrent provider behavior remain outstanding.
- Latest local `npm run check` passed: typecheck, lint, 40 unit files / 250 tests and
  13 database files / 152 tests; the production build passed. A full Playwright run
  passed 103/103 before the final small limiter/account-error/logging changes; a focused
  final browser run passed 21/21 afterward. No remediation migration has been applied to
  the hosted project and none of these changes has been deployed.
- Church Calendar Phase 0 was subsequently requested. Its owner-mandated review gate
  pauses calendar work before Phase 1; see `docs/CHURCH_CALENDAR_IMPLEMENTATION_PLAN.md`.
  Review the remaining remediation risks before treating them as a production-ready
  calendar baseline. Do not deploy or mark this plan complete yet.

### Dependency exception — reassess before production

`npm audit --omit=dev` currently reports **four low-severity dependency findings** through
`@react-email/render → html-to-text → deepmerge` and no available npm fix. Advisory
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) describes
prototype poisoning in `deepmerge`; the GitHub advisory is unreviewed and labels severity
high, while this npm audit reports the transitive findings as low. Application email
rendering calls the renderer with fixed, application-owned conversion options; user data
is rendered as email content, not passed as the merge options object. This reduces the
known exposure but is not a proof that every dependency path is safe. Owner: project
maintainer; review again before production promotion and when patched packages become
available, no later than 2026-11-27. Do not claim the production audit is clean.
