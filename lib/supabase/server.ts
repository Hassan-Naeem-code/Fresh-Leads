import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server-side Supabase client for Server Components, Route Handlers and Server Actions.
// Reads/writes the auth session cookie so getUser() reflects the logged-in user.
// The try/catch around setAll is required because Server Components cannot set cookies, 
// the session refresh there is a no-op and middleware handles the actual refresh.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component, safe to ignore, middleware refreshes.
          }
        },
      },
    }
  );
}
