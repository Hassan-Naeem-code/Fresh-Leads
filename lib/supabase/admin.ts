import { createClient } from "@supabase/supabase-js";

// Service-role Supabase client, BYPASSES Row Level Security.
// SERVER-ONLY. Never import this into a Client Component or anything that ships to the
// browser: it would leak the service-role key. Used exclusively by trusted server code
// (Stripe webhook, quote/order writers, enrichment worker) to write money/entitlement rows.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
