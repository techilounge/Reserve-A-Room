export type EmailOutboxNamespace = "reservation" | "system";

/**
 * Resend retains idempotency keys for 24 hours. Keep the key tied to the
 * immutable outbox row so a lease recovery or worker retry reuses it.
 */
export function emailProviderIdempotencyKey(namespace: EmailOutboxNamespace, outboxId: string) {
  return `reserve-a-room/${namespace}-email/v1/${outboxId}`;
}
