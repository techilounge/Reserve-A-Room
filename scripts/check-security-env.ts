const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim();

if (Boolean(siteKey) !== Boolean(secretKey)) {
  console.error("Turnstile configuration is incomplete: set both keys or remove both keys.");
  process.exitCode = 1;
} else if (process.env.VERCEL_ENV === "production" && !siteKey) {
  console.error("Turnstile must be configured for the production Vercel environment.");
  process.exitCode = 1;
}
