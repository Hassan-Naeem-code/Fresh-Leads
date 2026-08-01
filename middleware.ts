import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/admin/constants";
import { verifyMfaToken, adminEmailFromToken } from "@/lib/mfa/edge";

// Routes that require a logged-in user. Credit and subscription checks live deeper
// (lib/access.ts, used by /api/leads and the unlock/export routes), middleware only
// does the coarse auth redirect.
// NOTE: /admin is NOT here: it uses a separate admin session (see below), not user auth.
const PROTECTED_PREFIXES = ["/dashboard"];

// Two factor is required for every account. These are the paths that must stay
// reachable without it, or there would be no way to pass it: the challenge screen,
// the enrolment screen, the routes behind them, and signing out.
const MFA_EXEMPT = [
  "/verify",
  "/security",
  "/api/mfa",
  "/api/auth",
  "/auth/signout",
  "/admin/login",
  "/admin/verify",
  "/api/admin/login",
  "/api/admin/logout",
];
const isExempt = (p: string) => MFA_EXEMPT.some((x) => p === x || p.startsWith(`${x}/`));

export async function middleware(request: NextRequest) {
  // Start from a pass-through response we can attach refreshed cookies to.
  let response = NextResponse.next({ request });

  // Until Supabase is configured (.env.local), skip auth so public pages still render.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return response;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: getUser() refreshes the session cookie. Do not remove.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));

  if (needsAuth && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Second factor. A password session alone now reaches nothing: a stolen Supabase
  // cookie without the two factor cookie lands on the challenge screen.
  //
  // Enforced for browser sessions only. A request carrying an API key and no cookie
  // has no `user` here, so machine to machine calls are untouched: their credential is
  // a secret the holder either has or does not, and a code cannot be typed by a cron.
  if (user && !isExempt(pathname)) {
    const passed = await verifyMfaToken(request.cookies.get("fl_mfa")?.value, user.id);
    if (!passed) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Two factor verification is needed for this session.", code: "mfa_required" },
          { status: 401 }
        );
      }
      if (needsAuth) {
        const url = request.nextUrl.clone();
        url.pathname = "/verify";
        url.search = "";
        url.searchParams.set("next", pathname);
        return NextResponse.redirect(url);
      }
    }
  }

  // Admin pages use their own session cookie (separate from user auth). Missing
  // cookie -> send to the admin login. The signature is fully verified server-side
  // in app/admin/* and /api/admin/*, this is just the coarse edge guard. The login
  // page itself must stay reachable.
  if (
    pathname.startsWith("/admin") &&
    pathname !== "/admin/login" &&
    !request.cookies.get(ADMIN_COOKIE)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // The admin's own second factor, bound to the admin address rather than a user id.
  // Covers the operator API as well as the pages: the panel's buttons all post to
  // /api/admin, and guarding only what is visible would leave those wide open.
  const adminArea = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  if (adminArea && !isExempt(pathname)) {
    const adminEmail = adminEmailFromToken(request.cookies.get(ADMIN_COOKIE)?.value);
    if (adminEmail) {
      const passed = await verifyMfaToken(request.cookies.get("fl_mfa_admin")?.value, adminEmail);
      if (!passed) {
        if (pathname.startsWith("/api/")) {
          return NextResponse.json(
            { error: "Two factor verification is needed for this session.", code: "mfa_required" },
            { status: 401 }
          );
        }
        const url = request.nextUrl.clone();
        url.pathname = "/admin/verify";
        url.search = "";
        return NextResponse.redirect(url);
      }
    }
  }

  return response;
}

export const config = {
  // Run on everything except static assets and the Stripe webhook (which must not be
  // redirected and needs its raw body untouched).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
