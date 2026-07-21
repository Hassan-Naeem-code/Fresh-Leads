import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client for Client Components (login form, dashboard fetches).
// Uses the public anon key, every query is still constrained by RLS.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
