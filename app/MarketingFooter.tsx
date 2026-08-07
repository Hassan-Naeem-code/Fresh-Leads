import Link from "next/link";
import { NewsletterForm } from "./NewsletterForm";
import type { SiteSettings } from "@/lib/site-settings";
import { BrandMark, BrandName } from "./brand";
import { SocialLinks } from "./SocialLinks";

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
          {/* Double opt in: nothing is sent until the address is confirmed. A list built
              from unconfirmed addresses generates complaints against the same domain
              that carries every two factor code in the product. */}
          <NewsletterForm source="footer" />
          <SocialLinks />
        </div>
        <div className="mkt-footcols">
          <div className="mkt-footcol">
            <span className="mkt-foothead">Product</span>
            <Link href="/pricing">Pricing</Link>
            <Link href="/integrations">Integrations</Link>
            <Link href="/docs">API reference</Link>
            <Link href="/#how">How it works</Link>
            <Link href="/#quality">Quality standards</Link>
            <Link href="/signup">Get started</Link>
          </div>
          <div className="mkt-footcol">
            <span className="mkt-foothead">Who it is for</span>
            <Link href="/for/web-designers">Web designers</Link>
            <Link href="/for/pos-and-payments">Payments and POS</Link>
            <Link href="/for/marketing-agencies">Marketing agencies</Link>
            <Link href="/for/booking-software">Booking software</Link>
            <Link href="/for/local-sales-teams">Local sales teams</Link>
          </div>
          <div className="mkt-footcol">
            <span className="mkt-foothead">Company</span>
            <Link href="/about">About us</Link>
            <Link href="/compare">How we compare</Link>
            <Link href="/faq">Questions</Link>
            <Link href="/contact">Contact</Link>
            <Link href="/login">Sign in</Link>
          </div>
          <div className="mkt-footcol">
            <span className="mkt-foothead">Legal</span>
            <Link href="/security">Security</Link>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
          </div>
        </div>
      </div>
      <div className="mkt-footbar">
        <span>© {year} <BrandName settings={settings} />. All rights reserved.</span>
        <span className="mkt-footmade">You are never charged for a lead we cannot verify.</span>
      </div>
    </footer>
  );
}
