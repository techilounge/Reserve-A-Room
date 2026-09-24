# Reserve-A-Room

Room reservations for **Stonehill Seventh-day Adventist Church**
([stonehillchurch.org](https://stonehillchurch.org)).

Production: https://reservearoom.stonehillchurch.org

> **Status:** Phase 0 (architecture) complete. The application is not built yet.
> Sections marked _(pending)_ are filled in by the phase that implements them.

## What it does

- Church members and guests reserve rooms **without creating an account**.
- Each room has its own rules: capacity, approval required vs instant confirmation,
  maximum advance reservation period, and food/drinks policy.
- Admins review, approve, decline, edit and cancel reservations. Super Admins also
  manage rooms, ministries, users, settings and the audit log.
- Double-bookings are prevented by the database itself.
- Installable as a Progressive Web App, with light and dark mode.

The design and every major decision are documented in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · shadcn/ui ·
Supabase (Postgres, Auth, Storage) · Resend + React Email · Zod · date-fns · Vitest ·
Playwright · Vercel.

## Local setup _(pending — Phase 1/2)_

Requirements: Node.js ≥ 20.9 (developed on 24), npm, Docker (for local Supabase).

## Environment variables

See [.env.example](.env.example). Copy it to `.env.local` for local development.
Never commit real values. This repository is public.

## Supabase setup _(pending — Phase 2)_
## Database migrations _(pending — Phase 2)_
## First Super Admin bootstrap _(pending — Phase 2)_
## Resend setup _(pending — Phase 8)_
## Room policy configuration _(pending — Phase 6)_
## PWA behavior _(pending — Phase 9)_
## Testing _(pending — Phase 11)_
## Production deployment & domain _(pending — Phase 12)_
## Troubleshooting _(pending — Phase 12)_
