import { createHash } from "node:crypto";

import { createSupabaseServiceClient } from "@/lib/supabase/service";

/** Persist only a fingerprint; rendered email may contain a private guest link. */
export async function prepareProviderDelivery(
  service: ReturnType<typeof createSupabaseServiceClient>,
  id: string,
  system: boolean,
  payload: object,
): Promise<boolean> {
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const { data, error } = await service.rpc("prepare_email_delivery", {
    p_id: id,
    p_payload_hash: hash,
    p_system: system,
  });
  if (error) throw error;
  return data === "ready";
}
