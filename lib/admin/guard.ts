import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getAdminSession } from "./session";

// Admin gate, backed by the dedicated admin session cookie (NOT Supabase auth).

// Page/server-component guard: returns the admin { email } or redirects to login.
export async function requireAdmin(): Promise<{ email: string }> {
  const session = await getAdminSession();
  if (!session) redirect("/admin/login");
  return session;
}

// Route-handler guard: returns { email } on success, or { error } to return early.
export async function requireAdminApi(): Promise<
  { email: string } | { error: NextResponse }
> {
  const session = await getAdminSession();
  if (!session) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return session;
}
