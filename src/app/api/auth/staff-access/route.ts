import { NextResponse } from "next/server";

import { getStaffSession } from "@/lib/auth/session";

export async function GET() {
  const session = await getStaffSession();
  return NextResponse.json(
    { hasAccess: session.status === "staff" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
