# Reserve-A-Room

Room reservations for **Stonehill Seventh-day Adventist Church**
([stonehillchurch.org](https://stonehillchurch.org)).

Production: https://reservearoom.stonehillchurch.org

> **Status:** Phase 1 (application foundation) complete: branding, theming, layouts and
> routes. Reservations, rooms and staff sign-in are built in later phases. Pages for them
> currently show an "on the way" notice. Sections marked _(pending)_ are filled in by
> the phase that implements them.

## What it does

- Church members and guests reserve rooms **without creating an account**.
- Each room has its own rules:
  - capacity
  - approval required, or confirmed instantly
  - maximum advance reservation period
  - food and drinks policy
- Admins review, approve, decline, edit and cancel reservations. Super Admins also
  manage rooms, ministries, users, settings and the audit log.
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

Requirements: Node.js 22 or newer (developed on 24), npm, and Docker (for local Supabase,
from Phase 2).

```bash
npm install
cp .env.example .env.local   # fill in values as later phases require them
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
| `npm run check` | Typecheck + lint + unit tests |
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

See [.env.example](.env.example). Copy it to `.env.local` for local development.
Never commit real values. This repository is public.

## Deployments

- `main` is the Vercel **production** branch.
- The development branch `claude/reserve-a-room-build` deploys as a Vercel **Preview**
  for testing.
- Nothing is merged to `main` without the owner's approval.

## Supabase setup _(pending — Phase 2)_
## Database migrations _(pending — Phase 2)_
## First Super Admin bootstrap _(pending — Phase 2)_
## Resend setup _(pending — Phase 8)_
## Room policy configuration _(pending — Phase 6)_
## PWA behavior _(pending — Phase 9)_
## Testing _(pending — Phase 11)_
## Production deployment & domain _(pending — Phase 12)_
## Troubleshooting _(pending — Phase 12)_
