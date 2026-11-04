// Resend's idempotency window is finite. Never repeat an uncertain older
// delivery: staff must investigate or issue a new notice instead.
export function calendarNoticeRetrySafe(createdAt: string, attempt: number, now = Date.now()): boolean {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) && (attempt <= 1 || now - created < 23 * 60 * 60 * 1000);
}

export function calendarNoticeIdempotencyKey(emailId: string): string {
  return `calendar-notice-${emailId}`;
}
