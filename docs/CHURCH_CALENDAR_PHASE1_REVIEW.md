# Church Calendar Phase 1 — review and rollout notes

Phase 1 is implemented on `codex/church-calendar-phase1`, based on `main` at
`1f287eecb0979f40339011a49ab3b99508ec6514`. It is for owner review. No hosted database
migration, deployment, merge, or WordPress integration is authorized by this phase.

The complete changed-file list is available with
`git diff --name-status main...codex/church-calendar-phase1` after the implementation
commit. The main implementation is in the migration and regenerated database types;
`src/app/admin/(portal)/(super)/church-calendar/` and
`src/components/admin/calendar-confirm-button.tsx`; `src/app/calendar-plan/`;
`src/lib/calendar-planning/`; the system email template/outbox and environment files;
the navigation, audit, HTTP-header and service-worker integrations; and the calendar,
security, email, permission and browser tests. The README, architecture, plan and agent
checkpoint document setup and handoff.

## What can be reviewed

- `/admin/church-calendar` is a Super Admin screen for creating and editing cycles,
  moving them through draft/open/review/finalized/archived, reopening review/finalized
  cycles with an audited reason, adding ministries, managing each planner independently,
  and configuring the minimum resource catalog. Archived cycles cannot be reopened in
  Phase 1. Active resources can be read by staff and by a validated planner session;
  private notes are not included in those catalog reads.
- `/calendar-plan/[reference]` displays a non-consuming invitation confirmation and,
  after a user-initiated exchange, the planner's permitted cycle and ministry details.
  This is not the Phase 2 event-planning form. No event creation, submission, occurrence,
  resource allocation, conflict checking, or website publishing is implemented.
- Calendar actions appear in the existing Audit Log. Failed invitation deliveries use
  the existing staff email-failure notification. The admin screen shows the latest
  invitation delivery status; reload it after background delivery completes.

## Database and authorization

New append-only migration: `20261029100000_church_calendar_phase1.sql`, applied only to
local PGlite during development. It adds public RLS-enabled tables `calendar_cycles`,
`ministry_calendar_plans`, `calendar_plan_access`, `calendar_plan_sessions`, and
`calendar_resources`, plus private RLS-enabled `calendar_invitation_deliveries`.

Authenticated Super Admins have RLS-filtered reads of cycle, plan, resource and safe
planner-contact columns. Neither anonymous users nor authenticated browser users can
read token hashes, seeds or session hashes, or directly write these tables. The active
staff resource RPC omits inactive resources and private notes. The planner resource RPC
requires the same validated session and plan reference as the access page. The service
role has no direct grants on the new tables and uses the dedicated service-only RPCs.

Authenticated management RPCs are `save_calendar_cycle`, `transition_calendar_cycle`,
`add_calendar_ministry`, `save_calendar_resource`, `invite_calendar_planner`,
`rotate_calendar_invitation`, `revoke_calendar_planner`,
`calendar_invitation_delivery_status`, and `calendar_active_resources`. Each explicitly
rechecks the relevant staff role. Service-only RPCs are `calendar_invitation_context`,
`exchange_calendar_planner_session`, `calendar_planner_session_context`, and
`calendar_planner_resources`; they additionally check the service JWT role. Every
privileged function fixes `search_path`. The cycle row is locked before its state is
checked; invitation creation also locks the plan before enforcing the five-active limit.

The audit actions are `calendar_cycle.created`, `.updated`, `.transitioned`,
`calendar_plan.created`, `calendar_access.invited`, `.expired`, `.rotated`, `.revoked`,
`.opened`, and `calendar_resource.created` / `.updated`. Reopening includes the reason.
Audit metadata contains no invitation token, seed, session bearer, or private link.

## Invitation security and delivery

Each invitation has a random seed, a derived 256-bit HMAC token, a stored token hash,
and a unique random public plan reference separate from the internal plan ID. A fresh
replacement rotates only its grant and invalidates only its sessions. The link's GET is
non-consuming; the confirmation action is rate-limited and exchanges the token for a
separate random bearer. Only the session hash is stored. Session reads check the exact
plan, grant and version, expiry, revocation, cycle state, opening time and deadline.
The cookie is HttpOnly, SameSite=Lax, scoped to that public plan reference, and Secure
in production. The route sets no-store/no-referrer headers and the service worker
bypasses it. Verify redaction of query strings in hosting logs and analytics before
deployment, since the initial email URL necessarily contains the invitation token.

Each invite/replacement is queued transactionally through the existing system outbox,
with a distinct delivery ID and a stable Resend idempotency key for that delivery.
The email uses the existing branded sender and describes opening and deadline times.
Calendar email bodies and links are never printed by the worker. Retries after 23 hours
are stopped because provider idempotency is time-limited; an administrator can replace
and resend. If settings change between attempts, the provider can reject the changed
payload under the same key; the UI shows the failed delivery. This avoids depending on
the separate, unapproved security-remediation branch.

## Configuration and later rollout

1. Complete owner review of this branch. For a code review from the repository folder,
   run `git diff main...codex/church-calendar-phase1` after the Phase 1 commit is made.
2. If a live preview is approved later, use a **separate test Supabase project** and a
   separate preview configuration. Do not reuse production Supabase credentials or real
   member data. Apply the existing migrations in order, then the Phase 1 migration, to
   that isolated project. This work has not been done here.
3. In that environment set a new independent `CALENDAR_PLAN_LINK_SECRET` with at least
   32 characters. Generate a random value with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`;
   enter it directly into the server-side environment configuration, keep it out of
   source control and messages, and use different values for production and preview.
   Also configure the existing Supabase service credential, `RATE_LIMIT_SECRET`,
   Resend API key and verified sender, and `CRON_SECRET` for that environment.
4. Verify request-log and analytics query-string redaction, then test two synthetic
   planners: invite both, open their links, replace the first and confirm only that
   person's original link/session fails, revoke the second, and verify delivery and
   the audit entries. Test expired grants, the five-active cap, deadline changes,
   review/reopen with a reason, resource visibility and mobile navigation. Use only
   test addresses and data.
5. Before any production rollout, obtain explicit approval, review the exact branch and
   migration, verify a usable backup, and apply the additive migration before deploying
   code that expects it. Confirm the schema and configuration before enabling use. For
   rollback, revert application code to the previously approved deployment and preserve
   the new tables and audit records; coordinate the handling of pending calendar outbox
   messages with an operator because older code does not recognize this email event.
   Do not drop tables or disable the shared email cron as an improvised rollback.

## Limits and follow-up

- Participating ministries can be added; removing a previously added ministry is not
  available in this phase. Existing invitations can be revoked individually. Deadline
  reminders and event submissions are later work; Phase 1 sends invitations and reports
  delivery failures.
- PGlite covers the actual migrations and grant rules, but its single connection does
  not demonstrate real multi-connection PostgreSQL lock contention; verify that against
  an isolated real Postgres/Supabase instance before release.
- Real provider delivery, actual hosting-log redaction, production migration and live
  smoke testing were not performed. Unit and browser email tests use a local mock.
- The 1,200 occurrence default, exclusivity rules, overnight exceptions, allocation,
  WordPress synchronization, and public cancellations are later-phase decisions.
  Revised planner Privacy/Terms language must receive owner/legal approval before the
  Phase 2 planning portal is released.

## Verification completed locally

`npm run typecheck` and `npm run lint` passed. `npm test` passed 34 files / 231 tests;
`npm run test:db` passed 13 files / 155 tests. `npm run build` passed with Supabase and
Resend credentials disabled. The complete Playwright suite passed 107/107; the focused
calendar file passed 2/2 again after the final migration restrictions. No tests were
skipped. The first full browser run found two existing fixture timing/date collisions,
which were corrected before the successful rerun. No real emails were sent.
