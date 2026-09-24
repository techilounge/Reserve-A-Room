# Reserve-A-Room — Architecture & Decisions

Stonehill Seventh-day Adventist Church · `https://reservearoom.stonehillchurch.org`

This document started as the Phase 0 architecture plan. It records the decisions every later
phase builds on. When a decision changes, update this file in the same commit.

---

## 1. Repository assessment (Phase 0, 2026-09-23)

| Item | Finding |
| --- | --- |
| Local repo | Empty — no commits, no files. Nothing to preserve. |
| Remote `techilounge/Reserve-A-Room` | Empty, **public** repository, no default branch yet. |
| Vercel | Connected to the repo (per owner). Production branch: `main`. The development branch deploys as a Vercel **Preview** for owner testing. |
| Package manager | **npm** (only manager installed; Node 24.19, npm 11.17). |
| Docker | Installed, but cannot start on this machine (WSL is not installed). Database tests therefore run on PGlite instead (ADR-22). |
| Supabase CLI | Not installed globally → used via the `supabase` npm dev dependency (`npx supabase`). |
| Development branch | `claude/reserve-a-room-build` |

Because the repository is **public**, nothing sensitive may ever be committed: no `.env*`
files (other than `.env.example`), no keys, no real member data in seeds or fixtures.

---

## 2. Technology stack (versions verified 2026-09-23)

| Concern | Choice | Notes |
| --- | --- | --- |
| Framework | Next.js **16.3.6** (App Router, Turbopack), React 19.2 | Stable `latest` tag only; no canary. Next 16 uses `proxy.ts` (formerly `middleware.ts`). |
| Language | TypeScript **5.x**, `strict` | Pinned by `create-next-app@16.3.6` (the combination Next 16.3 is tested with). TS 7 is not adopted yet. |
| Styling | Tailwind CSS 4 + CSS-variable design tokens | Tokens in `globals.css`; no hard-coded colors in components. |
| Components | shadcn/ui 4 (`radix-nova` style, Radix primitives), Lucide icons | Copied into `src/components/ui`, owned by the project. Button sizes raised to 40–44px for touch. |
| Forms / validation | React Hook Form + Zod 4 | Zod schemas shared by client and server. |
| Dates | date-fns 4 + `@date-fns/tz` | All wall-clock math in the church timezone. |
| Phone numbers | `libphonenumber-js` (min metadata) | Validation + E.164 normalization; small, well-maintained. |
| Theme | `next-themes` | Light / dark / system, no flash. |
| Toasts | `sonner` (shadcn default) | |
| Backend | Supabase (Postgres 17, Auth, Storage) | Migrations in `supabase/migrations`. |
| Email | Resend + React Email | Server-only. |
| PWA | Hand-written service worker (`public/sw.js`) + `app/manifest.ts` | See ADR-12. No PWA plugin. |
| Unit tests | Vitest 5 | Co-located `*.test.ts`. Component-test libraries are added when a phase needs them. |
| DB tests | Vitest + PGlite (in-process Postgres) running the real migrations | RLS, constraints, triggers, grants (ADR-22). |
| E2E | Playwright | Against local Supabase + `next start`. |
| Hosting | Vercel (Fluid compute / Node runtime) | Node 24 locally; `engines.node >= 22`. |
| Fonts | Inter (body), Plus Jakarta Sans (headings) via `next/font` | Self-hosted at build time; no runtime requests to Google. |

---

## 3. High-level architecture

```
Browser (guest / admin)
   │
   ├── Server Components ── read-only queries (rooms, availability, admin lists)
   ├── Server Actions ───── all mutations (reserve, approve, edit, settings …)
   │        │
   │        ├─ Zod validation → permission check → domain service
   │        ├─ Supabase client:
   │        │     • guest flows  → service-role client (server-only) calling
   │        │                      SECURITY DEFINER functions revoked from anon
   │        │     • admin flows  → user-session client (JWT) so RLS + auth.uid()
   │        │                      apply as a second layer of authorization
   │        └─ after(): send queued emails (outbox) once the response is sent
   │
   └── proxy.ts ─────────── refreshes the Supabase session, gates /admin/*
                            (convenience only — every action re-checks)

Postgres (Supabase) — the final authority
   • exclusion constraint prevents overlapping holds
   • triggers enforce room state + advance-booking horizon + time rules
   • state-transition functions (approve / decline / cancel / reschedule)
   • RLS + explicit GRANTs, least privilege
   • audit_logs, notifications, email_logs written in the same transaction
```

**Rule of thumb:** the browser is for UX, the server action is for authorization and
friendly errors, the database is for invariants. Every business rule that protects
data integrity (conflicts, horizon, room state, status transitions, last Super Admin)
is enforced in Postgres, and mirrored in TypeScript only to give good feedback early.

---

## 4. Directory structure

```
/
├─ docs/ARCHITECTURE.md            ← this file
├─ public/
│  ├─ branding/                    ← stonehill-logo.png (placeholder until official asset supplied)
│  ├─ icons/                       ← PWA icons (192, 512, maskable, apple-touch)
│  └─ sw.js                        ← service worker (shell cache + offline fallback only)
├─ scripts/
│  └─ bootstrap-super-admin.ts     ← one-time first Super Admin setup
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/                  ← every schema change, timestamped
│  ├─ seed.sql                     ← DEV-ONLY data (local `db reset` only; never production)
│  └─ tests/                       ← DB tests (PGlite): rules, RLS, grants
├─ src/
│  ├─ app/
│  │  ├─ (public)/                 ← public layout: header, footer, install prompt
│  │  │  ├─ page.tsx               ← home
│  │  │  ├─ rooms/  rooms/[slug]/
│  │  │  ├─ availability/
│  │  │  ├─ reserve/               ← 3-step flow (room+schedule → details → review)
│  │  │  └─ reservation/[reference]/  ← secure guest status / cancel page
│  │  ├─ admin/
│  │  │  ├─ login/  forgot-password/  reset-password/  auth/confirm/ (route)
│  │  │  └─ (portal)/              ← authenticated layout, role guard, bell, nav
│  │  │     ├─ page.tsx            ← dashboard
│  │  │     ├─ reservations/  reservations/new/  reservations/[id]/
│  │  │     ├─ calendar/  notifications/
│  │  │     └─ (super)/            ← Super Admin guard
│  │  │        ├─ rooms/  rooms/new/  rooms/[id]/
│  │  │        ├─ ministries/  users/  settings/  audit/
│  │  ├─ offline/page.tsx
│  │  ├─ manifest.ts  robots.ts  sitemap.ts  icon/apple-icon
│  │  └─ layout.tsx  error.tsx  not-found.tsx  global-error.tsx
│  ├─ components/
│  │  ├─ ui/                       ← shadcn primitives
│  │  ├─ layout/  theme/  pwa/
│  │  ├─ rooms/  reservations/  admin/
│  ├─ emails/                      ← React Email templates + shared branded layout
│  ├─ lib/
│  │  ├─ supabase/                 ← server.ts, browser.ts, service.ts (server-only)
│  │  ├─ auth/                     ← permissions.ts (matrix), guards.ts
│  │  ├─ domain/
│  │  │  ├─ reservations/          ← service, state machine, error mapping
│  │  │  ├─ rooms/                 ← policy summary, advance-booking, capacity
│  │  │  ├─ availability/
│  │  │  ├─ reference-code.ts  guest-token.ts
│  │  ├─ validation/               ← shared Zod schemas
│  │  ├─ datetime/                 ← tz-aware helpers (single source of tz)
│  │  ├─ email/  notifications/  audit/  rate-limit/  settings/
│  │  └─ env/                      ← public.ts (NEXT_PUBLIC_*) + server.ts (server-only secrets)
│  └─ proxy.ts
├─ tests/e2e/                      ← Playwright specs
│  (unit tests are co-located as *.test.ts)
├─ .env.example  CLAUDE.md  README.md
```

---

## 5. Roles & permission model

Roles: `guest` (unauthenticated, no record), `admin`, `super_admin` (Postgres enum
`app_role`, stored on `profiles`).

- `src/lib/auth/permissions.ts` encodes the Section 78 matrix as data:
  `can(role, 'room.manage')`. Server guards (`requireStaff()`, `requireSuperAdmin()`)
  load the profile **from the database** on every privileged action and check
  `active = true`. Browser-supplied roles are never trusted.
- The same checks exist in SQL: `is_staff()` / `is_super_admin()` (STABLE, SECURITY
  DEFINER, `search_path` pinned) used by RLS policies and state functions.
- An authenticated Supabase user **without** an active profile row has no access.
  Profiles are only created by the invite action or the bootstrap script. Public
  signup is disabled in Supabase Auth.

---

## 6. Database model

Extensions: `btree_gist`, `pg_trgm` (no `citext`/`pgcrypto`; see ADR-23). Enums: `app_role`,
`reservation_status (pending, approved, declined, cancelled)`,
`advance_unit (day, week, month)`, `reservation_source (guest, admin)`,
`email_status (queued, sent, failed, skipped)`.

### 6.1 `rooms`

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | |
| name | text, 1–100 | |
| slug | text unique, lowercase (CHECK) | URL-safe, generated from name, editable |
| description | text ≤ 2000, null | |
| location | text ≤ 200, null | e.g. "Lower level, east wing" |
| **capacity** | int NOT NULL, > 0 | Drives the capacity warning |
| image_path | text, null | Supabase Storage path (`room-images` bucket) |
| active | bool, default true | false = archived; hidden everywhere public |
| reservable | bool, default true | false = shown as "temporarily unavailable" |
| unavailable_message | text ≤ 300, null | Optional public explanation when not reservable |
| **approval_required** | bool NOT NULL, default **true** | Pending vs. instant |
| **max_advance_value** | int, null | 1–730 days / 1–104 weeks / 1–24 months |
| **max_advance_unit** | `advance_unit`, null | Both null ⇒ use app default. CHECK: both null or both set |
| **food_drinks_allowed** | bool NOT NULL, default false | Informational policy |
| sort_order | int, default 0 | |
| created_at / updated_at | timestamptz | `updated_at` via trigger |

Amenities are data, not code: `amenities (id, name, icon, sort_order, active)` +
`room_amenities (room_id, amenity_id)`. Super Admins can add amenities from the room
editor. Rooms are never hard-deleted (FK from reservations is `ON DELETE RESTRICT`).

**Advance-booking storage (ADR-3):** value + unit is the single source of truth. No
normalized `*_days` column (it would be a second, driftable source). The horizon is
computed by one SQL function and one mirrored TS function, both covered by the same
test fixtures.

### 6.2 `ministries`
`id, name (unique on lower(name)), active, sort_order, created_at, updated_at`. The starter
list from the brief ships in a migration (real reference data, idempotent). "Other /
Not Listed" is **not** a row; it is represented by `ministry_id IS NULL` +
`other_ministry_name`.

### 6.3 `profiles` (admins only)
`id (PK → auth.users), full_name, email (lowercase text, unique), role app_role, active,
email_notifications bool default true, invited_by, created_at, updated_at`.
Last sign-in is read from `auth.users.last_sign_in_at` through a Super-Admin-only function.

### 6.4 `reservations`

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid PK | Internal only; never the public identifier |
| reference_code | text unique | `RAR-YYYYMMDD-XXXX` (see ADR-8) |
| status | `reservation_status` | |
| source | `reservation_source` | guest or admin-created |
| room_id | uuid FK rooms, RESTRICT | |
| start_at / end_at | timestamptz | CHECK `end_at > start_at` |
| reservation_range | tstzrange GENERATED `[start_at, end_at)` STORED | |
| **requester_first_name** | text 1–80 | |
| **requester_last_name** | text 1–80 | |
| **requester_email** | text ≤ 254, lowercase (CHECK) | |
| **requester_phone** | text | Normalized E.164 (`+15125550123`); formatted on display |
| **ministry_id** | uuid FK ministries, null | |
| **other_ministry_name** | text ≤ 120, null | CHECK: exactly one of ministry_id / other_ministry_name |
| **purpose** | text 1–500 | |
| **estimated_attendance** | int 1–10000 | |
| setup_requirements | text ≤ 1000, null | |
| requester_notes | text ≤ 1000, null | |
| admin_notes | text ≤ 4000, null | **Private.** Never leaves the admin UI |
| requester_message | text ≤ 1000, null | Requester-visible (decline/cancel reason) |
| approval_required_at_submission | bool | Policy snapshot |
| food_drinks_allowed_at_submission | bool | Policy snapshot |
| room_capacity_at_submission | int | Policy snapshot |
| created_by_user_id | uuid FK profiles, null | Set for admin-created reservations |
| approved_by / approved_at | | `approved_by` NULL + `approved_at` set ⇒ automatic approval |
| declined_by / declined_at | | |
| cancelled_by_user_id / cancelled_at / cancelled_by_requester | | |
| guest_token_hash | bytea | SHA-256 of the management token; never selected by app queries |
| created_at / updated_at | timestamptz | |

Constraint (the critical one):

```sql
EXCLUDE USING gist (room_id WITH =, reservation_range WITH &&)
  WHERE (status IN ('pending', 'approved'))
```

Status-consistency CHECKs (e.g. `status = 'declined' ⇒ declined_at IS NOT NULL`).
`requester_user_id` from the brief is replaced by `created_by_user_id`: guests have no user id.

### 6.5 Supporting tables
- `notifications (id, user_id, type, title, message, reservation_id, read_at, created_at)`
- `email_logs (id, reservation_id, recipient, event_type, status, provider_message_id,
  error_message, attempt_count, last_attempt_at, sent_at, created_at)` — doubles as the
  email outbox (ADR-10).
- `audit_logs (id, actor_user_id, actor_kind [guest|admin|system], action, entity_type,
  entity_id, metadata jsonb, created_at)` — insert-only; no UPDATE/DELETE grant to anyone.
- `app_settings` — **single-row typed table** (`id boolean PK CHECK (id)`), columns:
  church_name, app_name, timezone, contact_email, contact_phone,
  booking_interval_minutes (15/30/60), default_max_advance_value/unit,
  min_lead_time_minutes, bookable_day_start / bookable_day_end (time),
  allow_guest_cancellation, extra_admin_notification_emails text[],
  email_sender_name, updated_at, updated_by.
- `rate_limit_events (key_hash, bucket, created_at)` — see ADR-14.

### 6.6 Indexes
- Exclusion constraint's GiST index on `(room_id, reservation_range)` — serves availability queries.
- `reservations`: `(status, start_at)` for dashboard/pending queue, `(start_at)`,
  `(created_at desc)`, `(ministry_id)`, `(requester_email)`, unique `(reference_code)`.
- Search: `pg_trgm` GIN index over a generated `search_text` column (names, email, phone,
  purpose, reference) so admin search stays indexed without loading everything.
- `notifications (user_id, created_at desc)` + partial `(user_id) WHERE read_at IS NULL`.
- `email_logs (reservation_id)`, partial `(status) WHERE status IN ('queued','failed')`.
- `audit_logs (created_at desc)`, `(entity_type, entity_id)`.

### 6.7 RLS & grants
- `REVOKE ALL` on every table from `anon` and `authenticated`, then grant back exactly
  what is needed. RLS enabled on every table.
- `anon`: `SELECT` on `rooms`/`amenities`/`room_amenities`/`ministries` where
  `active` (public columns only); `EXECUTE` on `get_public_busy_blocks(...)` which returns
  only `(room_id, start_at, end_at)`. **No access to `reservations` at all.**
- `authenticated` (staff): `SELECT` on reservations via `is_staff()`; all writes through
  SECURITY DEFINER functions that check `is_staff()` / `is_super_admin()` themselves.
  Column-level grants keep `guest_token_hash` unreadable by anyone but the service role.
- `audit_logs`: `SELECT` for `is_super_admin()` only.
- `profiles`: role/active changes only via `set_user_role()` / `set_user_active()`.
- Storage bucket `room-images`: public read, write restricted to Super Admins.

---

## 7. Architecture decision records

### ADR-1 · Immediate vs approval-required reservations
The status is decided **inside the database**, in `create_reservation(...)`, which
locks the room row (`FOR SHARE`) and reads `approval_required` in the same
transaction as the insert. There is no window where the UI's idea of the room's
policy and the stored status can disagree.

| Room setting | Initial status | Side effects in the same transaction |
| --- | --- | --- |
| `approval_required = true` | `pending` | Queue requester "request received" email; queue admin "new request" email(s); create in-app notification for each active staff member; audit row |
| `approval_required = false` | `approved` (`approved_at = now()`, `approved_by = NULL`) | Queue requester "confirmed" email; audit row. **No** approval task, no admin notification |

Both paths hold the room immediately (pending also blocks the slot). The UI shows
"Approval Required" or "Instant Reservation" on the room card, in step 1, and on the
review step, based on the room currently loaded. If the policy changed between page
load and submit, the confirmation page shows the status actually stored.

The admin UI separates **Pending**, **Auto-approved** (`approved_by IS NULL`),
**Admin-approved**, **Declined**, **Cancelled**.

Admin-created reservations are created as `approved` with `approved_by` = the admin
(an explicit "create as approved" action), and still pass every other rule.

### ADR-2 · Room configuration changes vs existing reservations
- Room switches approval Yes → No: existing `pending` rows **stay pending** until an
  admin acts. Nothing is auto-approved.
- Advance period changes: existing reservations untouched. The new rule applies to new
  reservations and to any change of room/date/time.
- **Approving a pending request does not re-apply a shortened horizon.** The
  reservation already satisfied the rule in force when it was submitted. Approval
  does re-check: start is still in the future, the room is still active and
  reservable, and the slot is still held (the exclusion constraint guarantees
  this for pending rows). This reconciles Sections 28 and 80 of the brief.
- Capacity / food policy changes: snapshots on the reservation preserve what the guest
  saw. Admin views show the snapshot and flag it when it differs from the current room.

### ADR-3 · Room-specific maximum advance reservation
**Definition:** a reservation is allowed when its local start date (church timezone) is
on or before `horizon_date = local_today + N units`. Example: today Oct 1, 4 weeks →
last selectable date Oct 29 (inclusive). Months use calendar arithmetic with end-of-month
clamping (Jan 31 + 1 month = Feb 28), which is identical in Postgres `date + interval`
and date-fns `addMonths`. Rooms without a value use `app_settings.default_max_advance_*`.

Enforcement at three layers:
1. **UI** — the date picker receives `horizonDate` from the server and disables later
   dates. A notice reads: "This room may only be reserved up to 4 weeks in advance."
2. **Server action** — the same check in `lib/domain/rooms/advance-booking.ts` for a
   fast, friendly error before touching the DB.
3. **Database (final authority)** — a `BEFORE INSERT OR UPDATE OF room_id, start_at,
   end_at` trigger on `reservations` calls `booking_horizon_date(room, now())` and raises
   a custom SQLSTATE (`RAR02`) that the server maps to the friendly message. A crafted
   request that bypasses the UI and the action is still rejected.

Applies to guests **and** admins. No override in the initial build.

### ADR-4 · Capacity warning
A single pure function, `evaluateCapacity(estimatedAttendance, capacity)` →
`{ exceeds, capacity, estimated, overBy }`. It never blocks and never changes the value.
It is shown:
- live in the details step as the attendance number is typed (`role="status"` so screen
  readers announce it, amber styling + warning icon + text, never color alone);
- again on the review step, before submission — including for instant rooms;
- on the confirmation page and guest status page;
- to admins on pending cards, reservation details and the admin "new request" email,
  computed against the **current** room capacity, with the at-submission capacity
  noted when they differ.

A future "enforce capacity" room setting would slot into the same function.

### ADR-5 · Food & drinks policy
Boolean `food_drinks_allowed` on the room + snapshot on the reservation. One
`<FoodPolicyBadge>` component (icon + text: "Food & Drinks Allowed" / "No Food or
Drinks") is used on room cards, room details, availability, every reservation step,
confirmation, guest status page, admin details and emails. It is informational only.

### ADR-6 · Conflict prevention
Exclusion constraint (Section 6.4) with `[)` ranges, so 9–10 and 10–11 do not conflict.
`pending` and `approved` hold the room. The pre-submit availability check is for UX only;
a `23P01` from the insert or reschedule is mapped to: "That room was just reserved or
requested by someone else for this time. Please select another time or room." Race
behavior is proven by database tests (overlap, adjacency, release on cancel/decline, reschedule onto a held slot).

### ADR-7 · Time rules
- Stored as `timestamptz` (UTC). The timezone lives in `app_settings.timezone` (seeded from
  `APP_TIMEZONE`, default `America/Chicago`); all formatting goes through `lib/datetime`.
- Users pick a **date + start time + end time** in church local time; the server converts
  with `@date-fns/tz`, so DST is handled. A non-existent local time (spring-forward gap)
  is rejected, not silently moved.
- Reservations may not cross midnight. Times are on `booking_interval_minutes` steps and
  inside `bookable_day_start`–`bookable_day_end` (defaults 06:00–22:00, app-wide).
  Per-room operating hours are a listed future feature.
- Start must be in the future plus `min_lead_time_minutes` (default 0).

### ADR-8 · Reference codes
`RAR-YYYYMMDD-XXXX`: submission date in church time + 4 characters from Crockford
Base32 without ambiguous characters (no I, L, O, U), drawn from `gen_random_bytes`.
That gives about 1M codes per day, with a unique index and retry on collision. Lookup is
case-insensitive, and the internal UUID is never shown.

### ADR-9 · Guest management token
- 32 random bytes → base64url (43 chars). Only `sha256(token)` is stored. Comparison
  happens in SQL on the hash.
- Emailed link: `/reservation/RAR-…?token=…`. On first visit the server verifies it,
  sets an **HttpOnly, Secure, SameSite=Lax cookie scoped to that reservation's path**,
  and redirects to the clean URL. The token doesn't stay in the address bar or
  history, or show up in screenshots.
- `Referrer-Policy: no-referrer` on `/reservation/*`. Tokens are never logged, and query
  strings are stripped from server logs.
- The guest page shows only requester-safe fields. Cancellation is offered when
  `allow_guest_cancellation` is on, the status is pending/approved, and the start is in
  the future.

### ADR-10 · Email delivery (outbox)
Email rows are inserted into `email_logs` with `status = 'queued'` **inside the
reservation transaction**. After the response is sent, `after()` renders and sends
them via Resend and records `provider_message_id` / `sent` or `failed` + a sanitized error.
A failure therefore never rolls back a reservation. Failed or stuck rows appear on the
reservation page with a **Retry** button (staff), and an in-app notification flags
failures. Retries re-render from current reservation data.
Admin recipients = active staff with `email_notifications = true` +
`app_settings.extra_admin_notification_emails`.
Without `RESEND_API_KEY` in development, emails are logged to the console and marked
`skipped`. In production a missing key fails the environment validation.

### ADR-11 · Notifications
Created in SQL alongside the event (new pending request, requester cancellation,
reservation modified, email failure). The bell polls unread count on navigation plus
every 60 s while visible. Realtime is unnecessary at this scale.

### ADR-12 · PWA
Next.js' documented approach: `app/manifest.ts` + a small hand-written `public/sw.js`.
It pre-caches the app shell, branding, icons and `/offline` and serves the offline
page for failed navigations. It never caches `/admin/*`, `/reservation/*`, server
actions or Supabase responses. Plugins such as `next-pwa` / Serwist are skipped because
they add build coupling (Turbopack) for little benefit here. The reservation form disables
submission when `navigator.onLine` is false and shows the offline message.
Install UX: a `beforeinstallprompt` button (dismissal remembered), an iOS "Add to Home
Screen" sheet, and hidden in standalone mode.

### ADR-13 · Authentication & bootstrap
Supabase Auth email + password for staff only. Public signup is disabled in the
dashboard. Invitations use `auth.admin.inviteUserByEmail` (server, service role). Profile
creation and the role are set in the same server action. Disabling a user sets
`profiles.active = false` **and** bans the auth user so refresh tokens stop working.
The last active Super Admin is protected by a trigger that takes an advisory lock and
refuses any change that leaves zero, so two Super Admins demoting each other
concurrently cannot both succeed.
**Bootstrap:** `npm run bootstrap:super-admin` (run once by the owner with production
env vars) reads `INITIAL_SUPER_ADMIN_EMAIL`, invites or locates that user, and creates a
`super_admin` profile **only if no Super Admin exists yet**. Otherwise it refuses.
There is no web route for this.

### ADR-14 · Abuse protection
Honeypot field, a minimum fill time, Zod payload limits, a 16 KB action body cap, and a
Postgres-backed rate limit keyed by an HMAC of IP (and separately of email). This works
across stateless Vercel instances with no extra service and stores no raw IPs.
Optional Cloudflare Turnstile is enabled only when both Turnstile env vars are set.

### ADR-15 · Security headers
Set in `next.config.ts`: CSP (self + Supabase URL for connect/img, Turnstile when enabled,
`frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin` (stricter on `/reservation/*`),
`Permissions-Policy` denying unused features. `sw.js` is served with
`Cache-Control: no-cache` and a `self`-only CSP. `/admin/*` sends `X-Robots-Tag: noindex`.

### ADR-16 · Error handling
Domain errors are typed (`ReservationConflict`, `BeyondHorizon`, `RoomUnavailable`,
`InvalidTransition`, …). Custom SQLSTATEs (`RAR01…`) and `23P01` are mapped to friendly
messages in one place. Raw Postgres, Supabase and Resend errors are only logged
server-side (without tokens or PII beyond the reservation id).

### ADR-17 · State machine
One transition table in TS (`lib/domain/reservations/state.ts`) and the same rules in the
SQL transition functions:
`pending → approved | declined | cancelled`, `approved → cancelled`; declined and cancelled
are terminal. There is no restore action in the initial build.
**Editing:** changing room/date/time re-runs the conflict, horizon and room-state
checks using the *destination* room, and refreshes the capacity/food snapshots.
Status is never changed by an edit: pending stays pending and approved stays approved.
A material change to an approved reservation sends a "modified" email.

### ADR-18 · Data flow for reads
Public pages are Server Components using the anon client, with results cached briefly
(rooms) or uncached (availability). Admin pages use the session client. Client components
are limited to the reservation form, the date/time picker, the calendar interactions, the
theme toggle, the bell and the install prompt.

---

## 8. Environments

| Env | Supabase | Email | URL |
| --- | --- | --- | --- |
| Local | `supabase start` (Docker) + migrations; tests create their own fixtures | Console / Mailpit | `http://localhost:3000` |
| Preview (Vercel) | Same free-tier project as production for now (owner decision); a separate staging project can be added later | Resend | Vercel branch URL (email links point at the preview) |
| Production | Production project | Resend, verified `stonehillchurch.org` domain | `https://reservearoom.stonehillchurch.org` |

`supabase/seed.sql` only runs on local `supabase db reset`. `supabase db push` (production)
never runs it.

---

## 9. Phase 1 decisions

### ADR-19 · Branding assets and color tokens
- The official files supplied by the church live in `assets/branding/` (`logo-source.png`,
  `favicon-source.png`) and are **not** served. `npm run brand:generate` (sharp) derives every
  web asset from them:
  - trimmed logo, plus a dark-mode logo (navy wordmark recolored to white, gold kept)
  - rounded mark, favicon and app icons
  - maskable PWA icons (artwork inside the 80% safe zone)
  - Apple touch icon and the OpenGraph image

  The outputs are committed. To replace the logo, overwrite the source file and re-run
  the script.
- Brand colors: navy `#031e47` and gold `#dea621`. Every color is a token in
  `src/app/globals.css`.
  - Light mode: navy primary on a cool off-white.
  - Dark mode: deep navy background with a **gold primary** (navy text on gold, about 8:1).
  - Gold on white is only about 2:1, so gold *text* in light mode uses `--gold-text`
    (`#87600a`, about 5.6:1).
- Status and feedback colors come in soft background, foreground and border sets
  (`success`, `warning`, `danger`, `info`, `neutral`). Status badges and warnings always
  pair color with an icon and text.

### ADR-20 · Initial reference data
Per the owner, production starts with **one room, the Conference Room**. Its settings come
from the master brief: capacity 15, no approval required (instant), 4 weeks maximum
advance reservation, no food or drinks.

The **ministry list** starts with the 11 ministries named in the brief.

Both are real reference data, so they ship in a Phase 2 **migration** (idempotent, safe on
production), not in `seed.sql`. Super Admins add, edit and archive rooms and ministries
from the admin UI afterwards. Automated tests create any other rooms they need (for
example an approval-required room) as fixtures and never touch production.

### ADR-21 · Phase placeholders
Routes for later phases exist now so navigation and layout can be reviewed on the Preview.
Each shows an honest `<UpcomingFeature>` notice and never pretends to work. Each phase
removes the notices for what it implements. The launch checklist requires
`grep -r UpcomingFeature src` to return nothing.

---

## 10. Phase 2 decisions

### ADR-22 · Database tests on PGlite
Docker Desktop can't run on the development machine because WSL isn't installed, so the local
Supabase stack (and `supabase test db`) is unavailable. Database tests use **PGlite**, the real
Postgres engine compiled to WASM, running in-process:
- `supabase/tests/support/supabase-stub.sql` emulates the Supabase platform pieces our
  migrations touch:
  - the API roles `anon`, `authenticated` and `service_role`
  - `auth.users` and `auth.uid()` (reads `request.jwt.claims` like PostgREST)
  - the `extensions` schema
  - Supabase's *permissive* default grants, so the tests prove that our revokes work
- Every test DB applies the **real** migration files in order.
- `asRole()` runs queries exactly as PostgREST does (`SET LOCAL ROLE` + JWT claims), so RLS
  and column grants are exercised for real.
- `npm run db:types` generates `src/lib/supabase/database.types.ts` from the same PGlite
  catalog, in the Supabase CLI's format.

PGlite is Postgres 18 and Supabase runs 17. The migrations use nothing 17 lacks.

Limitation: PGlite is single-connection, so true two-session race tests need a real server.
The exclusion constraint's concurrency guarantee is a core Postgres property; the Phase 11
race test runs against a real Supabase database when one is configured.

### ADR-23 · No citext/pgcrypto; explicit function privileges
- Emails and slugs are stored lowercase with CHECK constraints instead of `citext`. Inside
  `search_path = ''` security-definer functions, citext operators silently fall back to
  case-sensitive text comparison.
- Randomness uses core `gen_random_uuid()`, and token hashes use core `sha256()`.
- Postgres grants EXECUTE on new functions to PUBLIC. Supabase-style *per-schema* default
  revokes can't remove that, a finding caught by our tests. So the foundation migration
  revokes it globally.
- Every function grants EXECUTE explicitly. A catalog-wide test asserts the exact
  allowlist of functions `anon` and `authenticated` can execute, so an accidental grant
  fails the test suite.

### ADR-24 · Environment and clients
- `src/lib/env/public.ts`: browser-safe `NEXT_PUBLIC_*` config.
- `src/lib/env/server.ts`: marked `server-only`; secrets are parsed with Zod.
- Supabase clients:
  - `supabase/server.ts`: user session, RLS applies.
  - `supabase/browser.ts`: staff sign-in.
  - `supabase/service.ts`: `server-only`, bypasses RLS, used only for guest/system flows.
- Missing configuration raises a clear `ConfigurationError` when used, not at import, so
  builds without secrets still succeed.

### ADR-25 · Custom error codes
Business-rule violations raise custom SQLSTATEs, which `src/lib/domain/errors.ts` maps to
friendly messages. Raw database errors are never shown.

| Code | Meaning |
| --- | --- |
| `RAR01` | Room not reservable |
| `RAR02` | Beyond the advance-booking limit |
| `RAR03` | Start is in the past or too soon |
| `RAR04` | Invalid time (hours, increments, order) |
| `RAR05` | Invalid status change |
| `RAR06` | Last active Super Admin |
| `RAR07` | Rate limited |
| `RAR08` | Not found |
| `RAR09` | Not authorized |
| `RAR10` | Invalid input (e.g. an inactive ministry) |
| `23P01` | Time slot already held (exclusion constraint) |

---

## 11. Phase 4 decisions

### ADR-26 · Guest submission pipeline
`submitReservation` (server action) → `createGuestReservation` (`src/lib/reservations/guest.ts`).
The steps run in this order:
1. **Bot traps:** a honeypot field and a minimum fill time of 3 seconds. Failures get a
   deliberately vague error.
2. **Validation:** the shared Zod schema (`src/lib/validation/reservation.ts`). The browser
   form uses the same schema, so the rules can't drift apart.
3. **Abuse limits:** optional Turnstile, then Postgres rate limits keyed by an HMAC of the
   IP (10/hour) and of the email (8/day).
4. **Friendly pre-checks:** room reservable, advance limit, DST gap, and a fresh
   availability check.
5. **Creation:** `create_guest_reservation()` via the service role. In one transaction it
   decides the status from the room, retries reference codes, queues emails, notifies
   staff and writes the audit entry.

On success the token goes into an HttpOnly cookie scoped to `/reservation/<REF>`, and the
browser is redirected to `/reservation/<REF>?submitted=1`.

- **Emailed links:** they carry `?token=`. `src/proxy.ts` moves the token into the same
  path-scoped cookie and redirects to the clean URL, before any page renders.
- **Guest page:** `/reservation/[reference]` verifies the cookie token's hash with
  `get_guest_reservation()`, which returns requester-safe fields only.
- **Cancellation:** `cancel_guest_reservation()` checks the setting, the status and that the
  start time hasn't passed.

### ADR-27 · Guest form UX
- Three steps: Room & time → Your details → Review & submit.
- Start and end options come from live occupied times; a conflict reported by the server
  clears the times and returns to step 1.
- Focus moves to each step heading, and to the first invalid field when a step fails.
- The capacity warning is a live region.
- Submission is disabled while offline and while pending ("Reserving…" / "Submitting…").
- Links can pre-fill the form: `/reserve?room=<slug>&date=YYYY-MM-DD&start=HH:mm&end=HH:mm`.

### ADR-28 · Email implementation (Phase 8)
- **Templates:** `src/emails/` holds React Email components: one branded layout and eight
  event templates. Styles are inline literals, because email clients ignore CSS variables.
  Every template also gets a plain-text version; the details table uses html-to-text's
  `dataTable` format so its columns stay readable.
- **Worker:** `src/lib/email/outbox.ts` works through the queue:
  1. `claim_emails()` claims up to N queued rows (plus rows stuck in `sending` for 10+
     minutes, at most 5 attempts) with `FOR UPDATE SKIP LOCKED`.
  2. `email_context()` loads the reservation, room, settings and link seed.
  3. The worker renders and sends the email.
  4. `complete_email()` records the result. All three functions are service-role only.
- **Triggers:** `scheduleEmailDelivery(reservationId)` wraps the worker in `after()`. Every
  action that can queue email calls it: guest submit and cancel, staff approve, decline,
  cancel, edit and create, and retry.
- **Safety net:** `/api/cron/email-outbox` runs daily. It requires `Bearer $CRON_SECRET`,
  compared in constant time.
- **Links:** the requester's link is rebuilt from the stored seed (ADR-9). Staff emails link
  to `/admin/reservations/<id>` and never contain the requester's token.
- **Idempotency:** the key is `email-log-<id>-<attempt>`, so a network retry within one
  claim can't send a second copy.
- **Failures:** a failure is stored on the row, truncated to 500 characters. Failed
  requester emails raise an `email_failed` notification to staff. `retry_email()`
  (staff, audited) re-queues failed or skipped rows.
- **No key:** development and previews mark emails `skipped`. Production records a failure.
