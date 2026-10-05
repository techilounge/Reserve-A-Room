/**
 * Cloudflare Turnstile "action" labels, shared by the browser widgets and the server verifier.
 * A token is only accepted for the form whose widget minted it.
 */
export const TURNSTILE_ACTIONS = { reserve: "reserve", recurringRequest: "recurring-request" } as const;
