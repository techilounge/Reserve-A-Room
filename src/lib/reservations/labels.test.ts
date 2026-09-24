import { describe, expect, it } from "vitest";

import { approvalLabel } from "./labels";

describe("approvalLabel", () => {
  it("distinguishes how an approved reservation was approved", () => {
    expect(approvalLabel({ status: "approved", source: "guest", approval_required_at_submission: false, approved_by: null })).toBe(
      "Automatically approved",
    );
    expect(approvalLabel({ status: "approved", source: "guest", approval_required_at_submission: true, approved_by: "u1" })).toBe(
      "Approved by staff",
    );
    expect(approvalLabel({ status: "approved", source: "admin", approval_required_at_submission: true, approved_by: "u1" })).toBe(
      "Created by staff",
    );
  });

  it("labels the other states", () => {
    const base = { source: "guest" as const, approval_required_at_submission: true };
    expect(approvalLabel({ ...base, status: "pending" })).toBe("Pending approval");
    expect(approvalLabel({ ...base, status: "declined" })).toBe("Declined");
    expect(approvalLabel({ ...base, status: "cancelled" })).toBe("Cancelled");
  });
});
