"use client";

import { useEffect, useState } from "react";

let cachedAccess: boolean | undefined;
let accessRequest: Promise<boolean> | undefined;

async function loadStaffAccess(): Promise<boolean> {
  if (cachedAccess !== undefined) return cachedAccess;
  accessRequest ??= (async () => {
    try {
      const response = await fetch("/api/auth/staff-access", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) return false;
      const body = (await response.json()) as { hasAccess?: boolean };
      return body.hasAccess === true;
    } catch {
      return false;
    }
  })();
  cachedAccess = await accessRequest;
  return cachedAccess;
}

/** Client-side so checking for a staff session does not make every public page dynamic. */
export function useStaffPortalAccess(): boolean {
  const [hasAccess, setHasAccess] = useState(cachedAccess ?? false);

  useEffect(() => {
    let current = true;
    void loadStaffAccess().then((allowed) => {
      if (current) setHasAccess(allowed);
    });
    return () => {
      current = false;
    };
  }, []);

  return hasAccess;
}
