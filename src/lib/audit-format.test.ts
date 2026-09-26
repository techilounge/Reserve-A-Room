import { describe, expect, it } from "vitest";

import { actionLabel, auditChanges, auditSubject } from "./audit-format";

describe("audit formatting", () => {
  it("labels actions", () => {
    expect(actionLabel("reservation.approved")).toBe("Reservation approved");
    expect(actionLabel("user.logged_in")).toBe("Administrator signed in");
    expect(actionLabel("user.invitation_accepted")).toBe("Administrator invitation accepted");
    expect(actionLabel("something.new")).toBe("something new");
  });

  it("renders changes readably and never reveals private note contents", () => {
    expect(
      auditChanges({
        changes: {
          approval_required: { from: true, to: false },
          role: { from: "admin", to: "super_admin" },
          admin_notes: { changed: true },
          updated_by: { from: null, to: "x" },
        },
      }),
    ).toEqual([
      { field: "Approval required", from: "Yes", to: "No" },
      { field: "Role", from: "Admin", to: "Super Admin" },
      { field: "Private notes", from: "", to: "changed" },
    ]);
  });

  it("finds a subject", () => {
    expect(auditSubject({ reference_code: "RAR-20261001-A7F4" })).toBe("RAR-20261001-A7F4");
    expect(auditSubject({ full_name: "Ada Lovelace", email: "ada@example.org" })).toBe("Ada Lovelace");
    expect(auditSubject({ changes: { name: { from: "Hall", to: "Fellowship Hall" } } })).toBe("Fellowship Hall");
    expect(auditSubject(null)).toBeNull();
  });
});
