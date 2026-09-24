import type { Enums } from "@/lib/supabase/database.types";

type Row = {
  status: Enums<"reservation_status">;
  source: Enums<"reservation_source">;
  approval_required_at_submission: boolean;
  approved_by?: string | null;
  approved_by_name?: string | null;
};

/**
 * Distinguishes how a reservation reached its state (brief §27): pending approval,
 * automatically approved (instant room), approved by staff, created by staff, declined,
 * cancelled.
 */
export function approvalLabel(row: Row): string {
  switch (row.status) {
    case "pending":
      return "Pending approval";
    case "declined":
      return "Declined";
    case "cancelled":
      return "Cancelled";
    case "approved": {
      if (row.source === "admin") return "Created by staff";
      const approvedByStaff = Boolean(row.approved_by ?? row.approved_by_name);
      return approvedByStaff ? "Approved by staff" : "Automatically approved";
    }
  }
}

export const EMAIL_EVENT_LABELS: Record<string, string> = {
  request_submitted: "Request received (requester)",
  admin_new_request: "New request (staff)",
  reservation_confirmed: "Reservation confirmed (requester)",
  reservation_approved: "Approved (requester)",
  reservation_declined: "Declined (requester)",
  reservation_modified: "Changed (requester)",
  reservation_cancelled: "Cancelled (requester)",
  admin_reservation_cancelled: "Cancelled by requester (staff)",
};
