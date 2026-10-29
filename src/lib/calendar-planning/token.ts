import "server-only";

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

import { requireServerSecret } from "@/lib/env/server";

/** The secret never leaves the server; the database stores a seed and a hash only. */
export function derivePlannerToken(grantId: string, version: number, seedHex: string): string {
  const secret = requireServerSecret("CALENDAR_PLAN_LINK_SECRET");
  if (secret.length < 32) throw new Error("CALENDAR_PLAN_LINK_SECRET must contain at least 32 characters.");
  return createHmac("sha256", secret)
    .update(`church-calendar-planner-v1:${grantId}:${version}:${seedHex}`)
    .digest("base64url");
}

export function hashPlannerBearer(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function newPlannerGrant() {
  const id = randomUUID();
  return { id, ...newPlannerToken(id, 1) };
}

export function newPlannerToken(id: string, version: number) {
  const seed = randomBytes(16).toString("hex");
  return { seed, hash: hashPlannerBearer(derivePlannerToken(id, version, seed)) };
}

export function newPlannerSession() {
  const bearer = randomBytes(32).toString("base64url");
  return { bearer, hash: hashPlannerBearer(bearer) };
}
