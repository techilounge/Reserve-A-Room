# CLAUDE.md — Reserve-A-Room

Room reservation app for Stonehill SDA Church. Read `docs/ARCHITECTURE.md` before
changing behavior; it records the decisions (ADRs) this code must follow.

## Ground rules
- **Public repository.** Never commit `.env*` (except `.env.example`), keys, or real member data.
- Work on `claude/reserve-a-room-build`. Never push or merge to `main` without explicit
  owner approval (Vercel deploys `main` to production).
- Build in the phase order from the master brief. Don't jump ahead, and don't leave
  placeholder buttons or fake backend calls.
- Every schema change is a migration in `supabase/migrations`. Never edit an applied migration.

## Architecture invariants
- Postgres is the final authority for conflicts (exclusion constraint), advance-booking
  horizon, room state, status transitions and last-Super-Admin protection. TS mirrors
  these rules only for early, friendly feedback.
- Every privileged server action re-loads the caller's profile from the DB and checks
  `active` + role via `src/lib/auth`. Never trust client-supplied roles or UI visibility.
- The service-role client (`src/lib/supabase/service.ts`, `server-only`) is used only for
  guest flows, invitations/bans and the email outbox. Admin actions use the session client.
- `admin_notes` is private and must never reach requester-facing pages or emails.
  `requester_message` is the requester-visible text.
- Never select or log `guest_token_hash` or raw guest tokens.
- All timezone math goes through `src/lib/datetime`. Never hard-code `America/Chicago`
  elsewhere.
- Colors come from design tokens in `globals.css`, not hard-coded in components.
- Status, approval and food policy are always conveyed by icon + text, never color alone.

## Commands (available from Phase 1)
- `npm run dev` / `npm run build` / `npm run lint` / `npm run typecheck`
- `npm test` (Vitest) · `npm run test:db` (pgTAP) · `npm run test:e2e` (Playwright)
- `npx supabase start` / `npx supabase db reset` (local DB with DEV seed data)

## Commits
Format: `phase-NN: short description`. Run typecheck, lint, unit tests and build before
committing a phase.
