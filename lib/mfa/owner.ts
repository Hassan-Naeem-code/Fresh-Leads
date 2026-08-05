import "server-only";
import { createClient } from "../supabase/server";
import { epochFromMetadata, adminEpoch } from "./epoch";
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
  // `epoch` is the generation this identity's sessions belong to. Every token minted
  // for them records it, so revoking is incrementing the number rather than hunting
  // down tokens we deliberately never wrote down. See lib/mfa/epoch.
  | { owner: Owner; kind: "admin"; label: string; email: string; epoch: number }
  | { owner: Owner; kind: "user"; label: string; email: string; userId: string; epoch: number };

export async function currentIdentity(preferAdmin = false): Promise<Identity | null> {
  if (preferAdmin) {
    const admin = await getAdminSession();
    if (admin) {
      return {
        owner: { adminEmail: admin.email },
        kind: "admin",
        label: admin.email,
        email: admin.email,
        epoch: await adminEpoch(admin.email),
      };
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
      epoch: epochFromMetadata(user.app_metadata),
    };
  }

  const admin = await getAdminSession();
  if (admin) {
    return {
      owner: { adminEmail: admin.email },
      kind: "admin",
      label: admin.email,
      email: admin.email,
      epoch: await adminEpoch(admin.email),
    };
  }
  return null;
}
