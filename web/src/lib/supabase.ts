import { createClient } from "@supabase/supabase-js";

// These are public values by design (they ship inside the site's code anyway). The real protection
// is RLS in the database: only Google accounts listed in family_members can read or write.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://hzyqvkqkozabwhhpxngy.supabase.co";
const key =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_unIRK2B2oSBsJHkzgdDATg_FSLgZarJ";

export const supabase = createClient(url, key, {
  auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
});
