import "server-only";
import { createClient } from "../supabase/server";
import { getAdminSession } from "../admin/session";
import type { Owner } from "./store";

// Who is asking, for the two factor routes.
//
// One helper for both audiences. The admin is checked FIRST: they are not a Supabase
// user, and a browser can hold both cookies at once when an operator is also signed in
// as a customer for testing. Preferring the admin session there means the admin's own
// factors are the ones being managed, which is the surprising case and so the one
// worth pinning down.

export type Identity =
  | { owner: Owner; kind: "admin"; label: string; email: string }
  | { owner: Owner; kind: "user"; label: string; email: string; userId: string };

export async function currentIdentity(preferAdmin = false): Promise<Identity | null> {
  if (preferAdmin) {
    const admin = await getAdminSession();
    if (admin) {
      return { owner: { adminEmail: admin.email }, kind: "admin", label: admin.email, email: admin.email };
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.email) {
    return {
      owner: { userId: user.id },
      kind: "user",
      label: user.email,
      email: user.email,
      userId: user.id,
    };
  }

  const admin = await getAdminSession();
  if (admin) {
    return { owner: { adminEmail: admin.email }, kind: "admin", label: admin.email, email: admin.email };
  }
  return null;
}
