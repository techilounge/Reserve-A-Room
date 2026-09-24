/** Fixed, test-only identities served by e2e/support/mock-supabase.ts. */

export const TEST_JWT_SECRET = "e2e-mock-jwt-secret";
export const TEST_PASSWORD = "e2e-Password-123";
export const TEST_ANON_KEY = "e2e-mock-anon-key";
export const TEST_SERVICE_KEY = "e2e-mock-service-key";

export const TEST_ACCOUNTS = {
  superAdmin: { id: "00000000-0000-4000-9000-000000000001", email: "super@example.org", role: "super_admin", name: "Sam Super" },
  admin: { id: "00000000-0000-4000-9000-000000000002", email: "admin@example.org", role: "admin", name: "Ada Admin" },
} as const;

export const ROOMS = {
  conference: { id: "00000000-0000-4000-8000-000000000001", slug: "conference-room", name: "Conference Room" },
  hall: { id: "00000000-0000-4000-8000-000000000002", slug: "fellowship-hall", name: "Fellowship Hall" },
  classroom: { id: "00000000-0000-4000-8000-000000000003", slug: "classroom-a", name: "Classroom A" },
} as const;
