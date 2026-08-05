import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminSession } from "@/lib/admin/session";
import { ADMIN_COOKIE } from "@/lib/admin/constants";
import { bumpUserEpoch } from "@/lib/mfa/epoch";
import { MFA_COOKIE, MFA_ADMIN_COOKIE } from "@/lib/mfa/session";
import { guard } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SIGN OUT EVERYWHERE.
//
// "Trust this device for 30 days" is a promise, and a promise that cannot be taken back
// is a liability the moment a trusted laptop is lost. Until this existed the only lever
// was changing the password and hoping, which is a strange gap in a product where the
// second factor is mandatory.
//
// Two halves, and BOTH are needed. Bumping the epoch retires every second factor pass
// ever issued to this identity, including the thirty day ones. Supabase's global sign
// out retires the refresh tokens, so the password session cannot quietly renew itself
// afterwards. Doing only the first leaves a signed-in browser that merely has to pass
// the factor again; doing only the second leaves the trusted pass sitting there for
// whoever signs in next.
//
// The device asking is signed out along with the rest, deliberately. "Everywhere"
// meaning "everywhere except here" is how somebody ends up believing a stolen laptop
// was dealt with when it was not.

export async function POST(request: NextRequest) {
  // The operator first: they may hold both kinds of session at once, and the panel is
  // the one worth revoking most.
  const admin = await getAdminSession();
  if (admin) {
    const limited = await guard("account", admin.email, "sessions");
    if (limited) return limited;

    // One statement in SQL, so two revocations at once cannot both read the same
    // number and both write the next one.
    await createAdminClient().rpc("bump_admin_session_epoch", { p_email: admin.email });

    const res = NextResponse.json({ ok: true, scope: "admin" });
    res.cookies.set(ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
    res.cookies.set(MFA_ADMIN_COOKIE, "", { path: "/", maxAge: 0 });
    return res;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const limited = await guard("account", user.id, "sessions");
  if (limited) return limited;

  await bumpUserEpoch(user.id);

  // Retire the refresh tokens too. Without this the other browser keeps a valid
  // password session and only has to pass the factor again, which is most of what was
  // being revoked. Access tokens already issued live out their hour; that window is
  // inherent to stateless auth and is why the epoch above exists to close the part we
  // can close immediately.
  try {
    await createAdminClient().auth.admin.signOut(user.id, "global");
  } catch {
    // Best effort. The epoch is the half that matters and it is already committed;
    // failing the whole request here would tell somebody their sessions are still live
    // when the second factor has in fact just been revoked everywhere.
  }

  await supabase.auth.signOut();

  const res = NextResponse.json({ ok: true, scope: "user" });
  res.cookies.set(MFA_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
