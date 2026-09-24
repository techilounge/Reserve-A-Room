# Reserve-A-Room

Room reservations for **Stonehill Seventh-day Adventist Church**
([stonehillchurch.org](https://stonehillchurch.org)).

Production: https://reservearoom.stonehillchurch.org

> **Status:** Phases 1–2 complete: foundation, database schema, security rules and tests.
> Reservations, rooms and staff sign-in are built in later phases. Pages for them
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

Requirements: Node.js 22 or newer (developed on 24) and npm. Docker is optional: the
database tests run on an in-process Postgres, so no local Supabase stack is needed.

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
| `npm run test:db` | Database tests: real migrations on in-process Postgres (PGlite), covering conflicts, booking rules, RLS and grants |
| `npm run check` | Typecheck + lint + unit tests + database tests |
| `npm run db:types` | Regenerate database TypeScript types from the migrations |
| `npm run bootstrap:super-admin` | One-time creation of the first Super Admin (see below) |
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

## Supabase setup

Project: `atnwrwrehexnwgqqnyek` (region us-west-2).

1. **API keys:** in Supabase → Settings → API Keys, copy:
   - the Project URL and the publishable/anon key into `NEXT_PUBLIC_SUPABASE_URL` and
     `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - the **service_role / secret** key into `SUPABASE_SERVICE_ROLE_KEY`, server only and
     never shared

   Set them in `.env.local` and in Vercel → Settings → Environment Variables.
2. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up".
   Staff accounts are created only by invitation.
3. **Authentication → URL Configuration:**
   - Site URL: `https://reservearoom.stonehillchurch.org`
   - Redirect URLs: add `https://reservearoom.stonehillchurch.org/**`, your Vercel URLs
     (e.g. `https://reserve-a-room.vercel.app/**`) and `http://localhost:3000/**`
4. **Authentication → Emails → SMTP:** configure custom SMTP with Resend, so invitations
   and password resets are delivered reliably. Supabase's built-in email is heavily
   rate-limited.

## Database migrations

All schema changes live in `supabase/migrations/`. To apply them to the hosted project:

```bash
npx supabase login
```

```bash
npx supabase link --project-ref atnwrwrehexnwgqqnyek
```

```bash
npx supabase db push
```

`link` asks for the database password (Supabase → Settings → Database). `db push`
applies only migrations that haven't run yet. `supabase/seed.sql` is never applied to
the hosted project.

The migrations create the initial reference data: the **Conference Room** (capacity 15,
confirmed instantly, bookable up to 4 weeks ahead, no food or drinks), 11 ministries, a
starter amenity list, and the default settings.

After changing a migration, regenerate the TypeScript types:

```bash
npm run db:types
```

## First Super Admin bootstrap

There is no public sign-up and no "make me admin" page. The first Super Admin is created
once, from your computer:

1. In `.env.local`, set:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL`, e.g. `https://reservearoom.stonehillchurch.org`
   - `INITIAL_SUPER_ADMIN_EMAIL`, and optionally `INITIAL_SUPER_ADMIN_NAME`
2. Run the script:

   ```bash
   npm run bootstrap:super-admin
   ```

3. Open the printed link to choose a password.

The script refuses to create a second Super Admin. Add further administrators from
**Users & Roles** inside the app. Re-running it for the same email prints a fresh link if
the first one expired.

## Resend setup _(pending — Phase 8)_
## Room policy configuration _(pending — Phase 6)_
## PWA behavior _(pending — Phase 9)_
## Testing _(pending — Phase 11)_
## Production deployment & domain _(pending — Phase 12)_
## Troubleshooting _(pending — Phase 12)_
