import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/access";
import { getSiteSettings } from "@/lib/site-settings.server";
import { BrandMark, BrandName } from "../brand";
import { CreditPill } from "./CreditPill";
import { SideNav } from "./SideNav";

// Private, signed-in surface. robots.txt disallows the path, but a page-level
// noindex is what actually keeps it out of the index if the URL is ever shared.
export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

// The header renders the live credit balance, so this layout must never be served
// from a cached render. A stale balance here is the difference between a customer
// believing they have credits and discovering they do not.
export const dynamic = "force-dynamic";

// The real gate for the app. Middleware does a coarse auth redirect; this re-checks
// the user server-side.
//
// Nobody is bounced out of the dashboard for being out of credits or unsubscribed.
// The only redirect here is for not being signed in; the search itself enforces the
// two requirements (platform access AND a credit balance) and answers with which one
// is missing, so the prompt appears in context instead of as a wall in front of the
// whole app.
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/dashboard");

  const [settings, access] = await Promise.all([getSiteSettings(), getAccess(user.id)]);

  return (
    <div>
      {/* Header carries identity and balance only. Everything navigable moved to the
          left rail below, so the header stays readable however many sections exist. */}
      <header className="topbar">
        <div className="topinner">
          <div className="topleft">
            <Link href="/dashboard" className="topbrand">
              <span className="logo sm">
                <BrandMark settings={settings} size={16} />
              </span>
              <BrandName settings={settings} />
            </Link>
          </div>
          <div className="topright">
            {/* The balance is always visible: it is the thing users spend and the
                thing they need to top up. Client component so an unlock can tick it
                down without a page reload. */}
            <CreditPill
              initialCredits={access.credits}
              subscribed={access.subscribed}
              canBuyCredits={access.canBuyCredits}
            />
            <span className="topuser" title={user.email ?? ""}>
              <span className="avatar">{(user.email ?? "?")[0].toUpperCase()}</span>
            </span>
            <form action="/auth/signout" method="post">
              <button className="ghost sm" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="appshell">
        <aside className="appside">
          <SideNav canUseTools={access.canUseTools} />
        </aside>
        <main className="appmain">{children}</main>
      </div>
    </div>
  );
}
