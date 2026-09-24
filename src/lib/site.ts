/**
 * Static brand and site identity. Values an administrator can change at runtime
 * (contact email, timezone, …) live in the app_settings table, not here.
 */
export const site = {
  appName: "Reserve-A-Room",
  churchName: "Stonehill Seventh-day Adventist Church",
  churchShortName: "Stonehill SDA Church",
  churchWebsite: "https://stonehillchurch.org",
  churchWebsiteLabel: "stonehillchurch.org",
  title: "Reserve-A-Room | Stonehill SDA Church",
  description:
    "Reserve meeting and activity rooms at Stonehill Seventh-day Adventist Church.",
  tagline:
    "Reserve a room for your Stonehill ministry meeting, activity, rehearsal, or event.",
  logo: {
    light: "/branding/stonehill-logo.png",
    dark: "/branding/stonehill-logo-dark.png",
    mark: "/branding/stonehill-mark.png",
    /** Intrinsic size of the generated logo files (see scripts/generate-brand-assets.mjs). */
    width: 1200,
    height: 335,
  },
} as const;
