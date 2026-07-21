import { createClient } from "@/lib/supabase/server";

// Current signed-in user's email (or null). Used by the shared nav so every page
// reflects the session, marketing pages included.
export async function currentEmail(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}
