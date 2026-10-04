# Reserve-A-Room enhancements implementation plan

Last updated: 2026-09-27
Plan status: **Phases 0–21 complete and deployed**
Implementation status: **Invitation resend, recurring-request requester acknowledgement, and recurring-request form reliability are live in production; the Phase 20 migration is applied**

This is the execution and handoff document for the enhancements requested after the initial production launch. It is intentionally specific enough for a new agent to continue without reconstructing the architecture or making silent product decisions.

## 1. Pickup checklist

Before implementing any phase:

- [x] Read `AGENTS.md` completely and follow its mandatory pickup sequence.
- [x] Read `README.md` and the relevant sections of `docs/ARCHITECTURE.md`.
- [x] Run `git status --short --branch` and inspect every existing diff.
- [x] Confirm password-setup-link fix `13d9042` remains in the branch history and do not regress it.
- [x] Read the relevant Next.js 16.3.6 documentation in `node_modules/next/dist/docs/` before changing Next.js files.
- [x] Start at the first unchecked phase in Section 6 unless the user explicitly reprioritizes.

## 2. Requested outcomes

1. Admins and Super Admins can reserve a room on a recurring schedule with a finite, predictable expansion horizon:
   - daily every X days or every weekday;
   - weekly every X weeks on one or more selected weekdays;
   - monthly on day X of every Y months or one or more ordinal weeks for a weekday of every Y months;
   - yearly on a fixed month/day or an ordinal weekday of a month;
   - optional inclusive end date, with a default maximum of the earlier of one year or 50 instances.
2. Mobile users receive a premium floating bottom navigation experience.
3. The public footer displays `Developed By TechiLounge`; only `TechiLounge` links to `https://techilounge.com` and opens in a new tab.
4. Successful Admin and Super Admin logins appear in the immutable Audit Log.
5. A Super Admin cannot be directly disabled by mistake.
6. Active Super Admins receive a branded email when an invited administrator accepts the invitation and enters the portal for the first time.
7. Room choices on `/reserve` receive a polished brand-gold (`#dea621`) ring treatment.
8. The Reserve-A-Room logo always links home, including from the admin portal, while authenticated staff receive an `Admin` entry in the public top navigation.
9. Public Privacy and Terms of Service pages render the approved copy in `privacy.md` and `terms-of-service.md`.
10. The public reservation flow requires explicit acceptance of the Privacy Policy and Terms of Service before submission, with a premium, accessible presentation and server/database enforcement.
11. Admins and Super Admins can export the reservations they are authorized to view as CSV (Excel-compatible) and PDF files.
12. Reservation dates consistently include the year in previews and reservation listings.
13. The Audit Log supports live server-side search, preset/custom date filtering, and pagination across the complete result set.
14. Super Admins can upload, automatically compress, order, and remove up to four room images; only supported image types up to 2 MB each are accepted.
15. Guests can submit a focused recurring-reservation request without complicating the ordinary reservation wizard, and staff can review those requests.
16. The `/reserve` introduction links directly to the public Availability page.
17. Turnstile failures expose a useful retry/error state while verification remains mandatory; the production hostname and network prerequisites are documented for operators.
18. Opted-in Admins and Super Admins receive branded email notifications for every new reservation and every requester- or staff-initiated cancellation.
19. Admins and Super Admins have an intuitive in-app how-to guide for every supported recurring-reservation scenario, linked from the admin sidebar and mobile menu.
20. Super Admins can identify unaccepted administrator invitations and resend a fresh branded password-setup link safely.
21. Guests receive a branded acknowledgement after submitting a recurring-date request, with the reference and submitted details plus a clear notice that no reservation is confirmed yet.
22. The recurring-date request form uses the standard configured time dropdowns and retains all entered values after validation errors.

## 3. Product decisions and acceptance rules

These decisions remove ambiguity for implementation. Change them only if the user requests a different behavior.

### 3.1 Recurring reservations

- Recurrence is available only in the authenticated staff create flow at `/admin/reservations/new`; both `admin` and `super_admin` already have `reservations.createApproved` permission.
- Editing an individual occurrence continues to use the existing reservation editor and affects only that occurrence.
- Recurrence options:
  - `Does not repeat`;
  - daily every 1–365 days;
  - every weekday (Monday–Friday);
  - weekly every 1–52 weeks on one or more weekdays;
  - monthly on calendar day 1–31 every 1–12 months (skip months without that day);
  - monthly on the first/second/third/fourth/last weekday every 1–12 months;
  - yearly on a fixed month/day (skip invalid dates such as February 29 in non-leap years);
  - yearly on the first/second/third/fourth/last weekday of a selected month.
- The start date is inclusive. An end date, when supplied, is inclusive.
- When no end date is supplied, expansion stops at the earlier of one calendar year from the start date or 50 instances. An explicit end date may shorten that boundary but may not extend it. The room booking horizon can shorten the initially materialized subset further.
- The schedule definition remains available for review even when room booking rules cause fewer than 50 dates to be created.
- Preserve local wall-clock intent in `app_settings.timezone`. A 2:00 PM series remains 2:00 PM across daylight-saving transitions. Convert each occurrence independently with `localToUtc`; never add fixed UTC durations between occurrences.
- A spring-forward local time that does not exist is rejected with a specific date-level error. Ambiguous fall-back times use the same policy as the existing `localToUtc` implementation and must be covered by tests.
- Multi-day weekly schedules share one interval anchor: “every 2 weeks on Monday and Wednesday” emits both weekdays during every second anchored week.
- Monthly ordinal rules support any unique combination of first through fourth and last for one weekday (for example second and fourth Saturday); yearly ordinal rules use one ordinal. Monthly day-of-month schedules, fifth weekdays from legacy data, February 29, and other impossible calendar dates are skipped rather than shifted. If two selections resolve to the same date, that occurrence is created once.
- Apply the existing room state, bookable hours, increment, minimum notice, and overlap rules to every generated occurrence. Do not bypass the database exclusion constraint.
- Safety limits: no expansion later than one calendar year from the start date and no more than 50 instances. Enforce in the pure expander, Zod, Server Actions, and SQL/RPC validation.
- Initial create is atomic for all occurrences currently inside the materialization window. If any occurrence conflicts, create neither the series nor its initial occurrences and show all conflict dates found during preflight. A race still falls back to the database’s `23P01` protection and a clear retry message.
- Future materialization never overwrites an existing reservation. It records a series exception for the conflicting date and continues with later dates. Room deactivation/unavailability pauses the series and creates an actionable exception instead of silently discarding dates.
- Provide a series detail/management view linked from each occurrence. Initial management actions are:
  - view recurrence rule and occurrence list;
  - view skipped/failed dates and reasons;
  - end/cancel future generation;
  - cancel an individual occurrence through the existing reservation action.
- Bulk edit/reschedule of an existing series is not part of this request. The operator ends the old series and creates a new one.
- If “Email the requester” is enabled, send one branded series-summary email, not one email per occurrence. Future materialization does not generate repetitive confirmation mail.

### 3.8 Public/admin navigation

- The brand/logo link in every header and admin shell points to `/`.
- Logged-in active Admins and Super Admins see an `Admin` link in the public desktop and mobile navigation; guests do not.
- Authorization continues to be enforced on `/admin`; the conditional link is a convenience, not a security boundary.

### 3.9 Legal pages and reservation consent

- `/privacy` renders the repository-controlled `privacy.md` copy and `/terms` renders `terms-of-service.md`; links use the canonical public routes.
- Legal Markdown is trusted repository content rendered on the server. It is not fetched from or editable by untrusted users.
- The public reservation form contains one unchecked required checkbox with separate links to both documents, opening in a new tab without losing entered data.
- The client prevents progression/submission without acceptance and displays an inline accessible error. The Server Action independently requires acceptance.
- Persist `terms_accepted_at`, `privacy_accepted_at`, and document-version identifiers on the reservation so consent is auditable. Do not store IP addresses or user-agent strings for this purpose.
- Staff-created reservations on someone else’s behalf are not treated as the requester’s acceptance; the new fields remain null and the reservation source identifies staff creation.

### 3.10 Reservation exports

- Both staff roles may export the same reservation result set they can view in the portal; Super Admin-only access is not required.
- Export respects validated list filters (status, room, date range, and search where supported) and applies a bounded date range/row cap to prevent expensive unbounded reports.
- CSV is UTF-8 with a BOM for Excel compatibility and protects formula-like cell values from spreadsheet injection.
- PDF uses a readable branded tabular layout, repeats headers across pages, shows active filters/generated time, and avoids exposing private tokens or internal-only secrets.
- Export generation occurs server-side after fresh staff authorization. Use route handlers for downloadable responses and never trust client-supplied rows.

### 3.11 Date clarity and Audit Log discovery

- Reservation preview, occurrence, and reservation-list dates include a four-digit year. Compact calendar range labels may remain yearless only when the surrounding view already establishes the year unambiguously.
- Audit search and filters execute in PostgreSQL before pagination so they cover the entire immutable log, not merely the visible page.
- Search updates after a short debounce; entity/date changes update immediately. Any filter change resets to page 1.
- Date presets include all time, today, last 7 days, last 30 days, this month, and a custom inclusive local-date range interpreted in the configured application timezone.

### 3.12 Room image galleries

- A room may have zero to four ordered images. The first image is the primary card image and existing single-image data is preserved during migration.
- Accepted source formats are JPEG, PNG, and WebP. Each selected source file must be no larger than 2 MB, and the Storage bucket independently enforces the same limit.
- Browser-side compression resizes oversized dimensions and encodes an efficient WebP when that produces a smaller file. Validation and the four-image cap are enforced again at the database boundary.
- Creating a room and managing an existing room both support the gallery. Public room details display all available images while selection cards retain a single primary image.

### 3.13 Guest recurring-reservation requests

- The ordinary `/reserve` wizard remains unchanged except for a compact link to a separate recurring-request page.
- The request captures contact details, preferred room/date/time, recurrence description, purpose, and attendance. It does not create or promise a reservation.
- Submission is protected with server validation, a honeypot/minimum-fill-time check, and database-backed rate limiting. Guests receive a reference code and staff receive an in-app notification.
- Start/end controls use the configured public booking interval and shared native-select presentation. End choices are later than the selected start, and the Server Action rejects off-grid values.
- Server validation errors preserve the complete guest draft—including room/date/time, description, contact details, notes, and legal acceptance—so the guest corrects only the invalid field.
- Authenticated staff can view submitted requests; only staff authorization policies/RPCs expose request details.

### 3.14 Turnstile recovery

- CAPTCHA verification remains fail-closed whenever Turnstile is configured.
- The client captures Cloudflare error codes, explains likely configuration/network failures without exposing secrets, and provides a retry control.
- Production configuration must authorize the exact public hostname and allow Cloudflare challenge hosts through network/content filters.

### 3.2 Mobile bottom navigation

Implement context-aware navigation rather than one overloaded menu.

Public mobile navigation (visible below `md`):

- Home (`/`)
- Rooms (`/rooms`)
- Reserve (`/reserve`) as the visually prominent central action
- Availability (`/availability`)

Admin mobile navigation (visible below `lg`):

- Dashboard (`/admin`)
- Reservations (`/admin/reservations`)
- New (`/admin/reservations/new`) as the prominent central action
- Calendar (`/admin/calendar`)
- More (opens the existing permission-filtered sheet for Notifications and Super Admin tools)

Requirements:

- Floating inset surface with rounded corners, subtle border/ring, backdrop blur, elevated shadow, brand-aware active state, and safe-area padding.
- Minimum 44×44 CSS-pixel targets, text labels, icons, visible keyboard focus, `aria-current`, and reduced-motion support.
- Keep the desktop public header and admin sidebar unchanged.
- The notification bell remains in the admin header.
- Avoid overlap with page content, the PWA install prompt, dialogs, toasts, and iOS safe areas. Add layout bottom padding only at breakpoints where the bar is visible and offset the install prompt above the public bar.
- The existing sheet remains the complete navigation fallback; permissions continue to come from `navigationFor`/`allowedHrefs`.

### 3.3 Footer credit

- Add a separate footer line: `Developed By TechiLounge`.
- Only `TechiLounge` is an anchor.
- Anchor attributes: `href="https://techilounge.com"`, `target="_blank"`, and `rel="noopener noreferrer"`.
- Use existing typography/color tokens and provide a visible hover/focus treatment.
- Apply to `SiteFooter` (public pages and not-found page). Do not add the marketing credit inside transactional email footers unless separately requested.

### 3.4 Login audit and account lifecycle

- `auth.users.last_sign_in_at` remains the display source for “Last sign-in” on Users & Roles; do not create a competing display timestamp.
- Write immutable `user.logged_in` audit entries for successful application password sign-ins and the first authenticated portal entry after invitation setup.
- Do not log failed password attempts in the permanent audit trail. Rate limiting already addresses abuse; logging failures risks email enumeration and noise.
- Audit metadata may include authentication method (`password` or `invitation_setup`) and role, but must not contain passwords, token hashes, raw IP addresses, cookies, or user-agent strings.
- Add human-readable labels and an `Authentication`/`Users` filter path in the Audit Log UI.

### 3.5 Super Admin disable protection

- Disable the `Disable` button for every active user whose current role is `super_admin`.
- Show an accessible explanation: “Demote to Admin before disabling this account.”
- Enforce the same rule in `public.set_user_active`; a crafted request must not bypass the UI.
- Keep the existing last-active-Super-Admin trigger as defense in depth.
- Re-enabling a previously disabled Admin remains supported.
- A Super Admin may be deliberately demoted only if the existing last-Super-Admin invariant allows it; after demotion, disabling is a distinct second action.

### 3.6 First-login email to Super Admins

- An invitation is accepted when an invited profile successfully sets its password and enters the portal through the verified invite/recovery session.
- Send exactly one email per active Super Admin recipient for that invited profile’s first accepted portal entry.
- Do not notify for password resets, ordinary later logins, the initial bootstrap Super Admin, or inactive Super Admins.
- Use Resend, the configured branded sender, a React Email template, and provider idempotency keys.
- Email includes invited person’s name, email, assigned role, acceptance time in the church timezone, and a button to `/admin/users`.
- Delivery must not delay or prevent sign-in. Queue it transactionally and process it through the outbox/background mechanism; failures remain retryable by the cron.
- Record `user.invitation_accepted` and `user.logged_in` in the Audit Log without logging the one-time token.

### 3.7 Gold room-card ring

- Change only the room radio cards in `src/components/reserve/schedule-step.tsx`; do not globally restyle every generic Card.
- Use the existing semantic brand token (`brand-gold`/`--brand-gold`), not a new hard-coded component color.
- Base: subtle gold ring and small elevation.
- Hover: stronger gold ring/elevation without layout shift.
- Selected: clearly stronger gold ring plus the existing selected icon/state; selection must not rely on color alone.
- Keyboard focus: visible high-contrast focus ring distinct from the decorative ring.
- Support light/dark mode and reduced motion.

## 4. Architecture and data contracts

### 4.1 New migration: recurring reservations

Create an append-only migration named approximately:

`supabase/migrations/20260925100000_recurring_reservations.sql`

Do not modify migrations that have already been pushed.

Add `public.reservation_series` with typed columns rather than an opaque recurrence JSON blob:

- `id uuid primary key default gen_random_uuid()`
- `status text` constrained to `active`, `paused`, `ended`, `cancelled`
- `room_id uuid` → `rooms`, restrict delete
- `created_by_user_id uuid` → `profiles`
- `frequency text` constrained to `daily`, `weekdays`, `weekly`, `monthly_day`, `monthly_nth_weekday`, `yearly_date`, `yearly_nth_weekday`
- `interval_count smallint` for every-X-day/week/month rules; yearly rules use `1`
- `weekdays smallint[]` for weekly rules, constrained to unique values from 0–6
- `day_of_month smallint null` constrained to 1–31 for monthly-day/yearly-date rules
- `month_of_year smallint null` constrained to 1–12 for yearly rules
- `weekday smallint null` constrained to 0–6 for ordinal rules
- `month_ordinals smallint[]` containing one or more unique values from 1–4 or `-1` for monthly ordinal-weekday rules
- `month_ordinal smallint null` constrained to 1–4 or `-1` for yearly ordinal-weekday rules
- `start_date date`
- `end_date date null`, with SQL validation that the effective boundary cannot exceed one calendar year from `start_date`
- `local_start_time time`
- `local_end_time time`
- `timezone text` validated with `private.is_valid_timezone`
- requester/template fields matching staff reservation creation: name, email, phone, ministry/other ministry, purpose, attendance, setup requirements, requester notes, private admin notes
- `notify_requester boolean`
- `materialized_through date null`
- `instance_limit smallint not null default 50`, constrained to 1–50
- `paused_reason text null`
- `ended_at`, `created_at`, `updated_at`

Add to `public.reservations`:

- `series_id uuid null references public.reservation_series(id) on delete set null`
- `occurrence_date date null`
- unique partial index on `(series_id, occurrence_date)` where `series_id is not null`
- check that `series_id` and `occurrence_date` are either both null or both non-null

Add `public.reservation_series_exceptions`:

- `id uuid primary key`
- `series_id uuid not null`
- `occurrence_date date not null`
- `reason text` constrained to known values such as `conflict`, `room_unavailable`, `outside_rules`, `invalid_local_time`
- `message text`
- `resolved_at`, `created_at`
- unique `(series_id, occurrence_date)`

Security:

- Enable RLS on both new tables.
- Active staff may read series and exceptions.
- All mutations go through SECURITY DEFINER RPCs that call `private.require_staff()` or are restricted to `service_role` for cron materialization.
- Add the new public RPC signatures to the explicit function-grant/allowlist tests.
- Audit create/end/pause/materialization actions using `private.write_audit` with `entity_type = 'reservation_series'`.

Required RPC contracts (exact names may change only if the plan is updated):

- `create_recurring_reservation_series(...)` — creates the series and initial occurrence rows in one transaction; accepts occurrence timestamps plus token hash/seed pairs produced server-side.
- `admin_get_reservation_series(p_id uuid)` — returns rule, template, occurrences, and exceptions after staff authorization.
- `admin_end_reservation_series(p_id uuid)` — prevents future materialization without cancelling already-created occurrences.
- `claim_series_to_materialize(p_limit integer)` — service-role-only, concurrency-safe claim using row locks/skip locked.
- `materialize_series_occurrences(...)` — service-role-only, idempotent via `(series_id, occurrence_date)` uniqueness; records exceptions and advances `materialized_through`.

Do not generate guest link hashes entirely in SQL. `newGuestToken()` depends on the server secret, so the application/cron must generate token hash/seed pairs and pass them to the RPC.

### 4.2 Recurrence domain module

Create `src/lib/recurrence/` with small pure modules and tests:

- `types.ts` — discriminated recurrence types.
- `dates.ts` — daily, weekday, interval weekly/multi-weekday, monthly, and yearly expansion using local date strings.
- `preview.ts` — occurrence expansion, caps, labels, and conflict grouping.
- `dates.test.ts` — every-X intervals, multi-weekday anchoring, month/year boundaries, skipped impossible dates, inclusive end date, one-year and 50-instance caps.
- `preview.test.ts` — rolling horizon, caps, DST conversion failures.

Core API shape:

```ts
type RecurrenceRule =
  | { frequency: "daily"; interval: number }
  | { frequency: "weekdays" }
  | { frequency: "weekly"; interval: number; weekdays: number[] }
  | { frequency: "monthly_day"; interval: number; dayOfMonth: number }
  | { frequency: "monthly_nth_weekday"; interval: number; weekday: number; ordinals: (1 | 2 | 3 | 4 | -1)[] }
  | { frequency: "yearly_date"; month: number; dayOfMonth: number }
  | { frequency: "yearly_nth_weekday"; month: number; weekday: number; ordinal: 1 | 2 | 3 | 4 | -1 };

type RecurrenceInput = {
  startDate: LocalDate;
  endDate?: LocalDate;
  start: LocalTime;
  end: LocalTime;
  rule: RecurrenceRule;
};
```

The pure expander returns local dates. Convert each local date/time to UTC only at the server-action boundary.

### 4.3 Generic system-email outbox

The existing `email_logs`/worker is reservation-specific. Do not force account lifecycle messages through `email_context`, which assumes a reservation.

Create a second, narrowly scoped outbox in the lifecycle migration:

`public.system_email_logs`

- `id uuid primary key`
- `event_type text` initially constrained to `admin_first_login`, `recurring_reservation_created`
- `entity_type text` (`user` or `reservation_series`)
- `entity_id uuid`
- `recipient text`
- normal email status/provider/error/attempt timestamps matching `email_logs`
- `created_at`
- unique `(event_type, entity_type, entity_id, recipient)` for logical idempotency

Add claim/context/complete/retry RPCs, all service-role-only except an authenticated Super Admin retry if a UI is later added. Extend the email cron to process both outboxes and return separate totals. Use an idempotency key derived from the system-email row id and attempt count.

Application files likely involved:

- `src/lib/email/system-outbox.ts` (new)
- `src/lib/email/schedule.ts`
- `src/app/api/cron/email-outbox/route.ts`
- `src/emails/` new templates/types
- `src/lib/email/render.ts` or a parallel typed renderer
- `e2e/support/mock-supabase.ts`

### 4.4 New migration: staff account lifecycle

Create approximately:

`supabase/migrations/20260925110000_staff_account_lifecycle.sql`

Add to `profiles`:

- `invitation_accepted_at timestamptz null`
- `first_login_at timestamptz null`

Backfill `first_login_at` and `invitation_accepted_at` only for profiles whose corresponding `auth.users.last_sign_in_at` is non-null. Leave never-signed-in invited profiles pending. Bootstrap profiles have `invited_by is null` and never trigger a first-login notification.

Add RPCs:

- `complete_staff_password_setup()`:
  - require the current active staff profile;
  - if `invited_by is not null` and `invitation_accepted_at is null`, atomically set acceptance and first-login timestamps;
  - write `user.invitation_accepted` and `user.logged_in` audit rows;
  - enqueue one `admin_first_login` system email for each currently active Super Admin;
  - return whether this was a first acceptance.
- `record_staff_login(p_method text default 'password')`:
  - require current active staff;
  - update `first_login_at` only if null;
  - write `user.logged_in` for every successful explicit application login;
  - if this is a legacy invited profile whose invitation is already accepted but email rows are missing, enqueue idempotently.

Invoke `complete_staff_password_setup()` only after `supabase.auth.updateUser({ password })` succeeds. Invoke `record_staff_login()` only after `signInWithPassword` and `current_staff_profile` succeed.

### 4.5 Super Admin active-state RPC change

In the lifecycle/security migration, replace `public.set_user_active` using `create or replace function`:

- lock/load the target profile;
- if `p_active = false` and target role is `super_admin`, raise a dedicated application error (for example `RAR11`) with a friendly message;
- otherwise update normally;
- keep the existing trigger protecting the final active Super Admin.

Update `src/lib/domain/errors.ts` and database tests for the new code.

## 5. UI and application changes by feature

### 5.1 Recurring reservation creation

Files likely changed/added:

- `src/components/admin/staff-reservation-form.tsx`
- `src/components/admin/recurrence-fields.tsx` (new)
- `src/components/admin/recurrence-preview.tsx` (new)
- `src/lib/validation/staff-reservation.ts`
- `src/app/admin/(portal)/reservations/actions.ts`
- `src/app/admin/(portal)/reservations/series/[id]/page.tsx` (new)
- `src/app/admin/(portal)/reservations/series/[id]/actions.ts` (new if useful)
- reservation detail/list/calendar components for a “Recurring” badge/link
- `src/lib/supabase/database.types.ts` after `npm run db:types`

Form behavior:

1. Keep room/date/start/end as the first required choices.
2. Show a “Repeat” control only in create mode; edit mode remains single-occurrence.
3. Prefill weekday and the first ordinal from the chosen start date, allow `Add week of month` selections for monthly rules, and prevent duplicates.
4. Show Ends: `Never` or `On date`.
5. Debounced/explicit preview lists generated dates inside the current horizon and any existing conflicts.
6. Summary before submit: recurrence label, explicit series start/end dates, currently created occurrence count, later rolling behavior, skipped impossible dates, and email behavior.
7. Submit button copy becomes `Create recurring schedule` when recurrence is enabled.
8. On success redirect to the series detail page; for a single reservation retain the current redirect.

Server action behavior:

- Parse a discriminated Zod union (`single` vs `recurring`).
- Reuse requester/details validation from `reservationSchema` without duplicating field rules.
- Load catalog/timezone and generate the local occurrence list.
- Convert every occurrence independently to UTC.
- Fetch busy blocks for the full materialization window and return date-specific conflicts before RPC invocation.
- Generate one `newGuestToken()` pair per occurrence.
- Call the atomic series RPC.
- Queue one summary system email when requested and schedule background delivery.
- Revalidate dashboard, reservations, calendar, and series detail paths.

Recurring worker:

- Add a server-only worker that claims due series, expands only the newly eligible date window, creates token pairs, and calls the materialization RPC.
- Invoke it from a protected daily cron. Prefer extending the existing cron route to run both email sweep and recurrence materialization under the same `CRON_SECRET`, unless duration measurements require a second route.
- Cap work per invocation and use skip-locked/idempotent claims.

### 5.2 Mobile floating navigation

Files likely changed/added:

- `src/components/layout/floating-bottom-nav.tsx` (shared primitive)
- `src/components/layout/public-bottom-nav.tsx`
- `src/components/admin/admin-bottom-nav.tsx`
- `src/components/admin/admin-nav.tsx` (extract/reuse permission-filtered More sheet)
- `src/components/admin/admin-shell.tsx`
- `src/app/(public)/layout.tsx`
- `src/components/pwa/install-prompt.tsx`
- potentially `src/app/globals.css` for a reusable safe-area utility
- `src/lib/navigation.ts` and tests if bottom-nav metadata is added there

Do not pass Lucide component objects from a Server Component to a Client Component. Import navigation/icon definitions inside client components, following the existing `AdminMobileNav` pattern.

### 5.3 Footer credit

Change `src/components/layout/site-footer.tsx`. Add an E2E assertion that the link has the expected URL, target, and rel attributes.

### 5.4 Audit/login/first-login email

Files likely changed/added:

- `src/app/admin/(auth)/actions.ts`
- `src/app/admin/(auth)/auth/confirm/actions.ts` only if flow context is needed
- `src/lib/audit-format.ts` and tests
- `src/app/admin/(portal)/(super)/audit/page.tsx` entity/filter labels
- `src/emails/staff-account-templates.tsx` (new)
- system email outbox modules described above
- `src/lib/email/*test.ts`
- `e2e/admin-access.spec.ts`

The invitation acceptance email must be queued only after the password update succeeds. Login remains successful even if email delivery is unavailable.

### 5.5 Disable protection

Change:

- `src/components/admin/users-manager.tsx`
- `src/app/admin/(portal)/(super)/actions.ts` only for friendly result mapping if necessary
- SQL RPC and database tests

The button’s disabled reason must be visible to assistive technology and understandable on touch devices; do not rely only on a native `title` tooltip.

### 5.6 Gold room cards

Change `src/components/reserve/schedule-step.tsx` using token-based classes. Add E2E checks for selected semantics and keyboard focus; visual polish should be manually checked at 320 px and desktop in both themes.

## 6. Phased execution checklist

### Phase 0 — Preserve the current authentication fix

- [x] Review the password-link diff.
- [x] Run the focused checks recorded in `AGENTS.md`.
- [x] Commit it separately as `13d9042` (`Protect password setup links from email scanners`).
- [x] Push it to `origin/main` through the user’s established workflow.
- [x] Confirm Vercel reports commit `13d9042` as a healthy production deployment (GitHub Vercel status: success on 2026-09-25).
- [x] Update the live checkpoint in `AGENTS.md`.

### Phase 1 — Pure recurrence domain and specification tests

- [x] Add recurrence types, expansion helpers, labels, and validation.
- [x] Cover weekly, ordinal monthly, fifth/last weekday, inclusive end date, max limits, and DST.
- [x] No database/UI behavior yet.
- [x] Run typecheck, lint, and unit tests.

### Phase 2 — Database recurring-series foundation

- [x] Add the append-only recurring migration.
- [x] Add series/exception tables, reservation linkage, indexes, RLS, grants, RPCs, and audit entries.
- [x] Add PGlite tests for authorization, atomic conflicts, idempotency, status transitions, and existing exclusion constraints.
- [x] Regenerate `database.types.ts`.
- [x] Run `npm run test:db` plus typecheck/unit tests.

### Phase 2A — Expanded recurrence domain and database contract

- [x] Replace the original weekly/monthly-only recurrence union with the full daily/weekday/interval-weekly/monthly/yearly rule set.
- [x] Enforce the earlier of one calendar year or 50 instances in unit validation and the database contract.
- [x] Update labels, DST previews, worker payloads, migration constraints/RPCs, generated types, PGlite fixtures, and security allowlists.
- [x] Run typecheck, lint, unit tests, and database tests before returning to UI work.

### Phase 3 — Staff recurring-create UI and series management

- [x] Add recurrence controls and preview to create mode only.
- [x] Extend server validation/action with atomic series creation.
- [x] Add series detail/end-series flow and recurring badges/links.
- [x] Add system summary email event/template if the generic outbox is already available; otherwise land the outbox foundation in this phase.
- [x] Add Playwright happy-path, conflict, authorization, and mobile-form coverage.

### Phase 4 — Rolling materialization

- [x] Implement the due-series worker and protected cron integration.
- [x] Record future conflicts/exceptions without duplicate occurrences.
- [x] Pause unavailable-room series with an actionable reason.
- [x] Test repeated cron runs for idempotency and concurrency safety.

### Phase 5 — Staff lifecycle migration, login audit, and Super Admin notification

- [x] Add lifecycle columns, system email outbox, RPCs, grants, and backfill.
- [x] Call lifecycle RPCs after successful password setup and explicit password login.
- [x] Add audit labels/filter support.
- [x] Add branded `admin_first_login` template and outbox delivery.
- [x] Test exact-once recipient rows, no bootstrap/reset notification, retry behavior, and audit entries.

### Phase 6 — Super Admin disable defense

- [x] Replace the active-state RPC with Super Admin rejection.
- [x] Disable the UI control with accessible guidance.
- [x] Preserve deliberate demote-then-disable and last-Super-Admin protections.
- [x] Add DB, action, and E2E tests.

### Phase 7 — Mobile floating navigation

- [x] Build shared floating-nav primitive.
- [x] Add public and admin variants with the menu selections in Section 3.2.
- [x] Integrate More sheet and permission filtering.
- [x] Add layout safe-area/content padding and PWA prompt offset.
- [x] Add responsive, overflow, active-state, keyboard, and screen-reader-label coverage; installed-device feel remains in rollout smoke testing.

### Phase 8 — Footer and room-card visual enhancements

- [x] Add TechiLounge footer credit with secure external-link attributes.
- [x] Add premium gold ring states to `/reserve` room cards.
- [x] Add focused E2E assertions; final light/dark device review remains in rollout smoke testing.

### Phase 9 — Public/admin navigation and legal pages

- [x] Point the admin brand/logo to `/` and add an authenticated Admin link to the public top/mobile navigation.
- [x] Implement `/privacy` and `/terms` from `privacy.md` and `terms-of-service.md` with metadata, responsive typography, and footer/form links.
- [x] Add route/navigation/legal-page E2E coverage.

### Phase 10 — Required legal consent in the public reservation flow

- [x] Add the premium accessible acceptance control and client validation.
- [x] Add append-only consent columns/version fields and enforce acceptance in the guest reservation RPC and Server Action.
- [x] Update generated database types plus unit, DB, and E2E tests for missing/present consent.

### Phase 11 — Reservation exports

- [x] Add shared validated export filters and a bounded staff-only export data query/RPC.
- [x] Implement Excel-compatible CSV with formula-injection protection.
- [x] Implement branded multi-page PDF output and download controls on the reservations page.
- [x] Add authorization, filtering, content-disposition, CSV-safety, PDF smoke tests, and rendered multi-page visual QA.

### Phase 12 — Integrated QA, docs, and rollout

- [x] Update `README.md` feature list, email-event table, database setup, cron behavior, and production branch text that is now stale.
- [x] Update `docs/ARCHITECTURE.md` schema diagrams, ADRs, security boundaries, route map, and outbox/recurrence flows.
- [x] Confirm `.env.example` needs no new variable; the recurrence materializer reuses `CRON_SECRET`.
- [x] Run all quality gates in Section 8.
- [x] Verify no secret values or token hashes appear in changed files.
- [x] Produce migration/deployment/smoke-test instructions.
- [x] Update `AGENTS.md` and this checkpoint with the exact deployed state.

### Phase 13 — Multi-ordinal monthly schedules and clearer preview boundaries

- [x] Confirm the linked-project failure is caused by unapplied enhancement migrations without mutating production.
- [x] Support multiple unique weeks of the month in the TypeScript and PostgreSQL recurrence contracts.
- [x] Add accessible `Add week of month` and remove controls, including second-and-fourth-Saturday creation coverage.
- [x] Show the configured series start and end dates separately from the room's current materialization window.
- [x] Map a missing PostgREST RPC to a clear database-update-required message instead of the generic error.
- [x] Run all quality gates and update the live checkpoints.

### Phase 14 — Reservation clarity, audit discovery, room galleries, and guest recurring requests

- [x] Include years in recurrence previews and reservation list dates, with regression coverage.
- [x] Add live, server-side Audit Log search, preset/custom date filtering, and result-set-wide pagination.
- [x] Add a four-image room gallery schema/RPC/storage policy with 2 MB/type limits and legacy-image backfill.
- [x] Add client-side room image validation/compression and create/edit gallery management.
- [x] Add the focused guest recurring-request page, protected persistence, staff notifications, and staff review page.
- [x] Add the `/reserve` Availability and recurring-request links without expanding the wizard.
- [x] Improve Turnstile failure diagnostics/retry behavior and document the verified production prerequisites.
- [x] Run all quality gates, inspect migration/security diffs, and update the live checkpoints.

### Phase 15 — Complete staff reservation lifecycle emails

- [x] Preserve existing staff email alerts for approval-required requests and requester cancellations.
- [x] Queue a branded staff email for every newly confirmed reservation, including instant, staff-created, and recurring occurrences.
- [x] Queue the staff cancellation alert for staff-initiated cancellations without duplicating requester-cancellation alerts.
- [x] Keep recipients preference-aware, links staff-only, replies addressed to the requester, and delivery idempotent.
- [x] Add template, database, recurring-series, and focused browser regression coverage.

### Phase 16 — Confirmation, Audit Log search, and room-editor reliability

- [x] Replace the remaining native browser confirmation with the branded, keyboard-accessible confirmation dialog pattern.
- [x] Make Audit Log search normalize punctuation and match every typed term across the combined display label, action, actor, entity, id, and metadata fields before pagination, with a global pre-migration compatibility path.
- [x] Add regression coverage for the copied display title `Amenity created · Chairs` and confirmation-dialog cancellation.
- [x] Keep room details editable during a pre-migration rollout by falling back to the legacy primary image only when the gallery RPC is specifically unavailable.
- [x] Run the complete local quality gates and record the final totals.

### Phase 17 — Interactive public room gallery

- [x] Replace static secondary room images with thumbnail controls that update the large preview.
- [x] Preserve access to the primary image and expose selected state to sighted and assistive-technology users.
- [x] Cover pointer and keyboard selection in Playwright using the local Supabase image mock.
- [x] Keep private-IP image optimization limited to an explicitly configured local test origin.

### Phase 18 — Recurring reservations how-to guide

- [x] Review the implemented recurrence union and document every supported practical scenario.
- [x] Add a staff-only guide with a four-step workflow, quick scenario chooser, exact field settings, examples, edge cases, and post-creation guidance.
- [x] Add the guide to the permission-filtered desktop sidebar and mobile More menu for both Admins and Super Admins.
- [x] Link directly to the recurrence section of New reservation without adding another client-side component.
- [x] Add navigation, role, content, light/dark accessibility, and responsive browser coverage.
- [x] Run all local quality gates and record the exact results.

### Phase 19 — Resend pending administrator invitations

- [x] Identify pending invitations from the existing invited/accepted lifecycle fields and show a clear status in Users & Roles.
- [x] Add a branded confirmation-protected resend action for active, unaccepted invited accounts.
- [x] Recheck authorization and eligibility on the server before generating a fresh token or sending email.
- [x] Preserve first-acceptance auditing and notification when the replacement setup link uses an Auth recovery token.
- [x] Extend the production-style Auth mock and Playwright coverage through the resend Server Action.
- [x] Run all local quality gates and record the exact results.

### Phase 20 — Recurring-request requester acknowledgement

- [x] Queue one requester acknowledgement transactionally whenever a recurring-date request is inserted.
- [x] Extend the service-only system-email context and branded templates with the request reference, room, preferred date/time, schedule, purpose, and attendance.
- [x] State clearly in HTML and plain text that the submission is a request and no dates are confirmed yet.
- [x] Schedule a post-response delivery attempt while retaining the existing cron retry and idempotency protections.
- [x] Add template and database coverage for queueing, context resolution, escaping, links, and request-status language.
- [x] Apply `20260927100000_recurring_requester_confirmation_email.sql` to the hosted project after commit/deployment authorization.

### Phase 21 — Recurring-request time controls and draft preservation

- [x] Replace native clock inputs with the shared styled time dropdowns and configured booking interval grid.
- [x] Restrict end choices to configured boundaries after the selected start and validate the grid again server-side.
- [x] Preserve room, date, time, schedule, requester details, notes, and legal acceptance after every validation error.
- [x] Retain progressive enhancement while preventing the hydrated action form from clearing its controlled draft.
- [x] Add a browser regression that fails validation, verifies every representative value remains, corrects the missing field, and submits successfully.
- [x] Run the complete local quality gates and record the exact results.

## 7. Test matrix and acceptance criteria

### Unit tests

- Recurrence date expansion and labels.
- Local time conversion around CST/CDT transitions.
- Zod single/recurring discriminated input validation and caps.
- Navigation item selection and active-path behavior.
- Audit labels for `user.logged_in` and `user.invitation_accepted`.
- New branded email rendering, escaping, links, and plain-text fallback.

### Database tests (PGlite)

- Admin and Super Admin can create series; guest/anon cannot.
- All initial occurrences are created or none are created.
- Double booking remains impossible under concurrency.
- Duplicate materialization is idempotent.
- Exceptions are unique and immutable/history-preserving as designed.
- Ending a series prevents future creation and does not delete existing reservations.
- Login audit is append-only and actor attribution is correct.
- Invitation acceptance queues exactly one email per active Super Admin.
- Password reset and bootstrap do not queue first-login notifications.
- Directly disabling any current Super Admin fails; Admin disable/re-enable works.
- Function execute grants remain allowlisted and no SECURITY DEFINER function is exposed to `anon` accidentally.

### Playwright tests

- Staff creates every-two-weeks Monday/Wednesday schedule and sees the anchored eligible occurrences.
- Staff creates monthly day-of-month, single- and multi-ordinal monthly, fixed-date yearly, and ordinal-yearly schedules.
- Conflict preview and atomic failure message.
- Series detail/end behavior.
- Mobile public bottom nav routes and active state.
- Mobile admin bottom nav routes, central New action, and role-filtered More sheet.
- PWA prompt does not overlap the floating bar.
- Footer external link attributes.
- Super Admin Disable button is disabled and explained; Admin button still works.
- First invitation acceptance queues/sends one notification email in the mock; later login does not duplicate it.
- Audit page shows login entry.
- `/reserve` room choice retains radio semantics, selected icon, focus visibility, and no horizontal scroll.
- Admin logo returns home, authenticated staff see the public Admin link, and guests do not.
- Privacy and Terms pages render their approved copy and links preserve an in-progress reservation form.
- Public reservation submission is blocked client- and server-side until both documents are accepted.
- Filtered CSV/PDF exports require staff authorization and return safe downloadable content.
- Axe WCAG 2.2 AA and responsive suite remain green.
- Both staff roles can open the Recurring Guide from their available navigation, review all eight scenarios, and jump directly to the recurrence form.
- Super Admins see a pending-invitation status and confirmation-protected resend action only for eligible accounts; server checks reject ineligible requests.

### Manual smoke tests

- Weekly 2:00–3:00 PM occurrence remains 2:00–3:00 PM across a DST boundary.
- Every-two-weeks Monday/Wednesday remains anchored to the intended weeks across month and year boundaries.
- Day 31 and February 29 rules skip impossible dates; last Saturday selects the actual last Saturday.
- An unspecified end date never expands past one year or 50 instances.
- A future conflict produces an exception and no double booking.
- First-login email arrives from the branded Resend sender and links to Users & Roles.
- Floating nav feels stable with browser chrome expanding/collapsing on iOS/Android and when the PWA is installed.
- Gold room-card treatment looks intentional in light and dark mode.
- Admin logo returns home and the authenticated public header exposes a working Admin entry without showing it to guests.
- Privacy/Terms content matches the approved Markdown and required consent survives validation through persistence.
- CSV opens cleanly in Excel without formula execution; PDF pagination remains legible for a large filtered export.

## 8. Required quality gates

Run after the relevant phase and all of them before rollout:

```powershell
npm run typecheck
npm run lint
npm test
npm run test:db
npm run build
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm run test:e2e
```

Also run:

```powershell
git diff --check
git status --short --branch
```

## 9. Production rollout and rollback

Rollout order:

1. Commit/review the password-link fix independently.
2. Merge feature code and new migrations only after local quality gates pass.
3. Take a Supabase database backup/checkpoint per the operator’s normal process.
4. Schedule a brief guest-reservation maintenance window: the consent migration intentionally replaces the old guest RPC signature, so migration and application deployment must happen back-to-back.
5. For the already-completed Phase 1–13 rollout, verify the five `20260925` migrations remain aligned. For Phases 14–15, run `npx supabase db push`, verify the exact four `20260926` migration names before confirming, and immediately deploy the matching application revision on Vercel.
6. Confirm the production build is serving `/privacy`, `/terms`, the consent-aware reservation form, and the staff export endpoints before reopening guest submissions.
7. Confirm cron configuration and run each worker once with authenticated tooling or wait for the scheduled run.
8. Execute the manual smoke checklist using test accounts/rooms and non-sensitive addresses.
9. Monitor Vercel function logs, Supabase logs, `system_email_logs`, series exceptions, and Resend delivery.

Rollback principles:

- Do not edit or delete an applied migration.
- Roll back application code through a Vercel deployment/revert while leaving additive schema in place.
- The consent-enforcing RPC is intentionally not backward-compatible with the old guest form. After that migration is applied, retain the consent-aware guest submission code during any partial application rollback, or use a forward corrective migration; never restore the consent-free public RPC.
- New tables/columns are additive and nullable/default-safe for existing records.
- Disable recurrence UI/worker via code rollback; existing series/occurrences remain as ordinary reservations and are not deleted.
- If the materializer misbehaves, remove/pause its cron invocation first, then inspect series claims/exceptions before corrective migration.

## 10. Live implementation checkpoint

Current phase: **Phases 0–21 are complete and deployed.**
Last completed task: **Committed and deployed Phases 19–21 after the requester-acknowledgement migration was applied, then verified Vercel and public production health.**
Next exact task: **Monitor normal staff use of invitation resend and recurring-request requester delivery; begin the next user-prioritized change when requested.**

Current worktree:

- Release commit `a0d92f3` (`Add recurring reservations and admin enhancements`) is on local and remote `main`.
- New append-only migrations: `20260925100000_recurring_reservations.sql`, `20260925110000_staff_account_lifecycle.sql`, `20260925120000_super_admin_disable_protection.sql`, `20260925130000_reservation_legal_consent.sql`, and `20260925140000_reservation_exports.sql`.
- `npx supabase db push --linked --skip-vault --yes` applied those five migrations successfully on 2026-09-26, and a follow-up linked migration listing confirmed local/remote alignment through `20260925140000`.
- Supabase reported WAL-G enabled but no available physical backups and no PITR. Docker-based logical dumping could not run because WSL is not installed. After explicit user authorization, a temporary service-role snapshot of all 11 REST-exposed public relations (89 rows) was written outside the repository before migration; its SHA-256 was `2e9537dc2c4c994b98f818fc7e3d20c3cbf3bde714f879e511b7170810a7b9ef`. The temporary PII snapshot was securely removed from the local temp directory after deployment and smoke checks passed.
- GitHub/Vercel reported a successful production deployment for `a0d92f3`.
- Production smoke checks passed: `/`, `/reserve`, `/privacy`, and `/terms` returned 200; unauthenticated admin and CSV/PDF export requests redirected to login; the cron endpoint rejected an unauthenticated request with 401; and production PostgREST metadata exposed the new series tables and consent, recurrence, export, and login RPCs.
- A headless, non-submitting production browser flow reached `Review & submit`, displayed the required Privacy & Terms checkbox, and verified that both legal links open in a new tab. No test reservation or email was created.
- Latest verification: `npm run check` passed (typecheck, lint, 26 unit-test files / 176 tests, and 11 database-test files / 137 tests); `npm run build` passed; `npm run test:e2e` passed 85/85; `git diff --check` passed; and a changed-file secret-pattern scan passed after excluding the documented public E2E mock key.
- Rendered PDF QA covered a three-page landscape export with repeated headers, pagination, and edge-clipping inspection; temporary QA artifacts were removed afterward.
- Phase 14 adds `20260926100000_audit_log_date_filters.sql`, `20260926110000_room_image_gallery.sql`, and `20260926120000_recurring_reservation_requests.sql`; Phase 15 adds `20260926130000_staff_reservation_email_notifications.sql`. All four append-only migrations are applied to the hosted project and recorded in `supabase_migrations.schema_migrations`.
- Phase 14 adds year-inclusive reservation dates; result-set-wide Audit Log discovery; ordered four-image room galleries with browser compression and storage/database enforcement; a focused, legally consented guest recurring-request workflow with staff notifications/review; `/reserve` discovery links; and actionable Turnstile failure/retry states.
- The Turnstile script and iframe load under the production CSP, and the production site key matches the Cloudflare widget. A later `110200` regression was traced to Hostname Management authorizing `reservearoom.stonehillchurch.com` instead of the live `.org` domain. The widget was corrected to `reservearoom.stonehillchurch.org`, and a live review-step smoke test reached Cloudflare's `Success!` state without submitting a reservation. The application continues to expose actionable callback codes and retry behavior for future Cloudflare failures.
- A narrow public-catalog compatibility fallback retries the room query without `image_paths` only for PostgreSQL missing-column error `42703`. This restored the local homepage against the intentionally pre-migration database while preserving all other failures.
- Latest Phase 14 verification: `npm run check` passed (typecheck, lint, 28 unit-test files / 182 tests, and 11 database-test files / 140 tests); `npm run build` passed; `npm run test:e2e` passed 92/92, including the expanded 27-route-state accessibility/responsive matrix; `git diff --check` passed; and the secret-pattern scan found no matches. The build logged the expected linked-database warning that `rooms.image_paths` does not exist because the Phase 14 migration intentionally remains unapplied.
- After the compatibility fix, `npm run typecheck` and `npm run lint` passed, and a live request to `http://localhost:3000` returned HTTP 200 with the room catalog rendered.
- Final Phase 15 verification: typecheck and lint passed; 28 unit-test files / 184 tests passed; 11 database-test files / 140 tests passed; `npm run db:types` regenerated 15 tables / 55 functions / 6 enums; the production build passed; 14 focused Playwright reservation/approval/recurrence tests passed; the complete Playwright suite passed 92/92; and `git diff --check` passed.
- Phase 16 adds a shared branded `ConfirmationDialog`, tokenized Audit Log search across display-title source fields, and a narrow `admin_room_image_paths` missing-RPC fallback to the room's legacy `image_path` during rolling/pre-migration operation.
- Phase 16 focused verification: typecheck and lint passed; the focused Super Admin database file passed 21/21; confirmation and exact copied-title Playwright checks passed 2/2; and the room-detail light/dark accessibility checks passed 2/2.
- Final Phase 16 verification: typecheck and lint passed; 28 unit-test files / 185 tests passed; 11 database-test files / 141 tests passed; the production build passed; the complete Playwright suite passed 92/92; and `git diff --check` passed (with pre-existing line-ending notices only).
- Rollout commit `43dccd1` (`Add reservation operations and admin reliability`) is on local and remote `main`; Vercel reported a successful production deployment.
- Direct Supabase CLI migration transport was unavailable because outbound PostgreSQL ports 5432/6543 were blocked. The four reviewed migration files were therefore applied in separate transactions through the authenticated Supabase SQL editor, recorded in the migration ledger, and verified with read-only schema checks.
- Production smoke checks returned HTTP 200 for `/`, `/reserve`, `/recurring-request`, `/privacy`, `/terms`, and `/availability`. No synthetic production reservation, cancellation, email, image upload, or recurring request was created during rollout.
- Authenticated production recurrence-create/export, room-image upload, recurring-request handling, and staff lifecycle email delivery remain operational checks to observe during normal staff use.
- Phase 17 adds a narrow client-side room gallery: every uploaded image is a selectable native button, the large image updates without navigation, the active thumbnail has visible and `aria-pressed` state, and keyboard selection is covered by Playwright. No schema change or migration is required.
- Phase 17 verification: typecheck and lint passed; 28 unit-test files / 185 tests passed; 11 database-test files / 141 tests passed; the production build passed; the focused room-gallery Playwright test passed 1/1; and the complete Playwright suite passed 93/93.
- Phase 17 was committed as `f1a35d2` (`Make room galleries interactive`), pushed to `origin/main`, and deployed successfully by Vercel. A production HTTP smoke check returned 200 with the gallery markup, and a live headless-browser check selected the second of two Main Sanctuary thumbnails and observed the large preview update to image 2 of 2.
- Phase 18 adds `/admin/recurring-guide`, eight exact-control recurrence scenarios, start/end/conflict/materialization guidance, a sidebar/mobile-menu entry for both staff roles, and a direct `#recurrence` form handoff. No migration or database change is required.
- Phase 18 verification: typecheck and lint passed; 28 unit-test files / 185 tests passed; 11 database-test files / 141 tests passed; the production build passed; focused guide navigation tests passed 2/2; focused light/dark accessibility and responsive checks passed 2/2; and the complete Playwright suite passed 97/97.
- Phase 18 was committed as `0687c40` (`Add recurring reservations guide`), pushed to `origin/main`, and deployed successfully by Vercel on 2026-09-27.
- Phase 19 adds an `Invitation pending` state and confirmation-protected `Resend invite` action to Users & Roles. Eligibility is rechecked server-side; replacement links use the existing branded invitation template and preserve idempotent first-acceptance tracking. No migration or database change is required.
- Phase 19 verification: typecheck and lint passed; 28 unit-test files / 185 tests passed; 11 database-test files / 141 tests passed; the production build passed; the focused invitation-resend browser test passed 1/1; the focused Admin access file passed 10/10; and the complete Playwright suite passed 98/98.
- Phase 20 adds append-only migration `20260927100000_recurring_requester_confirmation_email.sql`, which transactionally queues one idempotent requester acknowledgement through `system_email_logs`; the request action schedules immediate background delivery and the existing cron retains retry coverage. The user confirmed the migration was applied to the hosted project on 2026-09-27.
- Phase 20 verification: typecheck and lint passed; 28 unit-test files / 186 tests passed; 11 database-test files / 141 tests passed; the focused template file passed 3/3; the focused Super Admin database file passed 21/21; the production build passed; the focused recurring-request browser test passed 1/1; and the complete Playwright suite passed 98/98.
- Phase 21 replaces recurring-request clock inputs with configured native-select time grids, enforces those boundaries server-side, and keeps every field in a controlled draft dispatched without the action form's automatic reset. No migration is required.
- Phase 21 verification: typecheck and lint passed; 28 unit-test files / 186 tests passed; 11 database-test files / 141 tests passed; the production build passed; the focused recurring-request dropdown/preservation flow passed 1/1; and the complete Playwright suite passed 98/98.
- Phases 19–21 were committed as `1c2e55d` (`Improve invitations and recurring requests`) and pushed to `origin/main`. Vercel reported a successful production deployment, and public HTTP smoke checks returned 200 for `/`, `/reserve`, `/recurring-request`, and `/admin/login`.

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

When handing off, replace this checkpoint with:

- phase and checklist item completed;
- files/migrations changed;
- commands run and exact pass/fail totals;
- unresolved decisions or blockers;
- next exact command or file to edit;
- whether changes are uncommitted, committed, pushed, migrated, or deployed.
