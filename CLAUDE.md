@AGENTS.md

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

## Commands
- `npm run dev` / `npm run build` / `npm run lint` / `npm run typecheck`
- `npm test` (unit) · `npm run test:db` (migrations on PGlite: rules, RLS, grants)
- `npm run check` (typecheck + lint + unit + DB tests)
- `npm run db:types` — regenerate `src/lib/supabase/database.types.ts` after any migration
- `npm run brand:generate` — regenerate logos/icons from `assets/branding/`
- Docker/WSL is unavailable on the dev machine: no `supabase start`. Never run
  `supabase db push` against the hosted project without the owner's approval.

## Database conventions
- New migration per change (`supabase/migrations/<timestamp>_<name>.sql`); never edit one
  that has been applied to the hosted project.
- Every new function: `set search_path = ''`, fully qualified names, and explicit
  `grant execute` to exactly the roles that need it. Update the allowlist test in
  `supabase/tests/security.test.ts` when a role legitimately gains a function.
- Business-rule errors use custom SQLSTATEs (`RAR01`–`RAR09`) mapped in
  `src/lib/domain/errors.ts`.
- Never write shell commands with backticks inside double quotes (bash runs them). Use
  file-edit tools for prose/SQL.

## UI conventions
- Pages for unbuilt phases use `<UpcomingFeature>`. Remove it when the phase lands.
- Use `page-container` for public page width; admin pages render inside `AdminShell`.
- Buttons/controls must stay ≥ 40px tall (touch targets). Test at 320px width: no
  horizontal scroll.

## Commits
Format: `phase-NN: short description`. Run typecheck, lint, unit tests and build before
committing a phase.
