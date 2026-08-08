import Link from "next/link";
import type { SiteSettings } from "@/lib/site-settings";
import { BrandMark, BrandName } from "./brand";
import { SocialLinks } from "./SocialLinks";

// Shared, session-aware top nav for every page. Presentational so each page
// fetches settings + the current email once and passes them down. When signed
// in it shows Dashboard + Sign out; signed out it shows Sign in + Get started.
// `children` slots in page-specific links (e.g. the landing "How it works").
export function MarketingNav({
  settings,
  email,
  children,
}: {
  settings: SiteSettings;
  email?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <nav className="pr-nav">
      <div className="pr-navinner">
        <Link href={email ? "/dashboard" : "/"} className="pr-navbrand">
          <span className="logo"><BrandMark settings={settings} size={28} /></span>
          <BrandName settings={settings} />
        </Link>
        <div className="pr-navlinks">
          {children}
          <Link href="/pricing" className="hideable">Pricing</Link>
          <Link href="/integrations" className="hideable">Integrations</Link>
          <Link href="/compare" className="hideable">Compare</Link>
          <Link href="/accuracy" className="hideable">Accuracy</Link>
          <Link href="/about" className="hideable">About</Link>
          <Link href="/contact" className="hideable">Contact</Link>
          {/* Hidden below 900px: the nav already drops its text links at 720px, and
              four more targets would crowd the sign-in buttons. The footer carries
              them on every page, so nothing is lost on mobile. */}
          <SocialLinks size={16} className="nav-social" />
          {email ? (
            <>
              <Link href="/dashboard">Dashboard</Link>
              <form action="/auth/signout" method="post" className="pr-signout">
                <button className="pr-btn ghost sm" type="submit">Sign out</button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login">Sign in</Link>
              <Link href="/signup" className="pr-btn primary sm">Get started</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
