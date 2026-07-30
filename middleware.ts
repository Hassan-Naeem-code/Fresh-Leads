import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/admin/constants";

// Routes that require a logged-in user. Credit and subscription checks live deeper
// (lib/access.ts, used by /api/leads and the unlock/export routes), middleware only
// does the coarse auth redirect.
// NOTE: /admin is NOT here: it uses a separate admin session (see below), not user auth.
const PROTECTED_PREFIXES = ["/dashboard"];

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

  return response;
}

export const config = {
  // Run on everything except static assets and the Stripe webhook (which must not be
  // redirected and needs its raw body untouched).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/webhooks|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
