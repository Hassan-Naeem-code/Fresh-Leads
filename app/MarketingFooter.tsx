import Link from "next/link";
import type { SiteSettings } from "@/lib/site-settings";
import { BrandMark, BrandName } from "./brand";

// Shared site footer with grouped links. Used across landing, pricing, about,
// contact, and legal pages so navigation is consistent everywhere.
export function MarketingFooter({ settings }: { settings: SiteSettings }) {
  const year = new Date().getFullYear();
  return (
    <footer className="mkt-footer">
      <div className="mkt-footinner">
        <div className="mkt-footbrand">
          <Link href="/" className="pr-navbrand">
            <span className="logo"><BrandMark settings={settings} size={26} /></span>
            <BrandName settings={settings} />
          </Link>
          <p className="mkt-foottag">{settings.tagline || "Verified local business leads, on demand."}</p>
        </div>
        <div className="mkt-footcols">
          <div className="mkt-footcol">
            <span className="mkt-foothead">Product</span>
            <Link href="/pricing">Pricing</Link>
            <Link href="/#how">How it works</Link>
            <Link href="/#quality">Quality standards</Link>
            <Link href="/signup">Get started</Link>
          </div>
          <div className="mkt-footcol">
            <span className="mkt-foothead">Company</span>
            <Link href="/about">About us</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/login">Sign in</Link>
          </div>
          <div className="mkt-footcol">
            <span className="mkt-foothead">Legal</span>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
          </div>
        </div>
      </div>
      <div className="mkt-footbar">
        <span>© {year} <BrandName settings={settings} />. All rights reserved.</span>
        <span className="mkt-footmade">Only verified, deliverable leads count against your quota.</span>
      </div>
    </footer>
  );
}
