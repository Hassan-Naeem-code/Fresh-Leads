import Link from "next/link";
import type { Metadata } from "next";
import { getSiteSettings } from "@/lib/site-settings.server";
import { BrandMark, BrandName } from "../brand";
import { MarketingFooter } from "../MarketingFooter";
import { ArrowRight } from "../icons";

export const metadata: Metadata = {
  title: "Privacy Policy",
  alternates: { canonical: "/privacy" },
};

export default async function PrivacyPage() {
  const s = await getSiteSettings();
  const brand = s.brand_name;
  return (
    <div>
      <nav className="pr-nav">
        <div className="pr-navinner">
          <Link href="/" className="pr-navbrand">
            <span className="logo"><BrandMark settings={s} size={28} /></span>
            <BrandName settings={s} />
          </Link>
          <Link href="/" className="pr-btn ghost sm">Back to home <ArrowRight size={14} /></Link>
        </div>
      </nav>

      <article className="legal">
        <h1>Privacy Policy</h1>
        <p className="updated">Last updated: 21 July 2026</p>

        <p>
          This Privacy Policy explains how <strong>Fresh N Fresh, Inc</strong> (&ldquo;{brand}&rdquo;,
          &ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, and protects your information when you use
          our website and lead-generation service (the &ldquo;Service&rdquo;). By using the Service you
          agree to this policy.
        </p>

        <h2>1. Information we collect</h2>
        <ul>
          <li><strong>Account data</strong>, your name, email, company name, and password (stored hashed), used to create and secure your account.</li>
          <li><strong>Business profile</strong>, the niche, location and what you sell, which you provide so we can run and grade your searches.</li>
          <li><strong>Payment data</strong>, processed by our payment provider, <strong>Stripe</strong>. We never see or store your full card details; we store only an order record and a Stripe customer/subscription reference.</li>
          <li><strong>Lead data</strong>, business contact information we compile from publicly available sources (e.g. OpenStreetMap) and verification checks, on your behalf.</li>
          <li><strong>Usage &amp; device data</strong>, basic technical logs (IP, browser) used to operate and secure the Service.</li>
        </ul>

        <h2>2. How we use your information</h2>
        <ul>
          <li>To provide the Service, authenticate you, run searches, verify and deliver leads.</li>
          <li>To process payments and manage your subscription and credit balance.</li>
          <li>To secure the Service, prevent abuse, and comply with legal obligations.</li>
          <li>To respond to your requests and send essential service notices.</li>
        </ul>

        <h2>3. Legal bases (EEA/UK users)</h2>
        <p>
          We process your data to perform our contract with you, for our legitimate interests in
          operating and securing the Service, to comply with legal obligations, and, where required, 
          with your consent.
        </p>

        <h2>4. Sharing &amp; sub-processors</h2>
        <p>We do not sell your personal data. We share data only with providers that help us run the Service:</p>
        <ul>
          <li><strong>Supabase</strong>, database, authentication, and file storage.</li>
          <li><strong>Stripe</strong>, payment processing.</li>
          <li><strong>Hosting/CDN</strong>, to serve the website.</li>
        </ul>

        <h2>5. Cookies</h2>
        <p>
          We use only <strong>strictly necessary cookies</strong> to keep you signed in and secure your
          session. We do not use advertising or cross-site tracking cookies, so no cookie-consent banner
          is required for the current Service.
        </p>

        <h2>6. Data retention</h2>
        <p>
          We keep account and order records for as long as your account is active and as required by law
          (e.g. tax/accounting). You can request deletion at any time (see below).
        </p>

        <h2>7. Your rights</h2>
        <p>
          Depending on where you live (e.g. GDPR/UK GDPR, or CCPA/CPRA in California), you may have the
          right to access, correct, delete, export, or object to the processing of your personal data,
          and to opt out of any &ldquo;sale&rdquo; or &ldquo;sharing&rdquo; (we do neither). To exercise
          these rights, contact us at <a href="mailto:info@fresh-leads.io">info@fresh-leads.io</a>.
        </p>

        <h2>8. Security</h2>
        <p>
          We protect data with row-level access controls, encrypted transport (HTTPS), hashed passwords,
          and least-privilege server access. No system is perfectly secure, but we work to safeguard your
          information.
        </p>

        <h2>9. International transfers</h2>
        <p>
          Your data may be processed in countries other than your own. Where required, we rely on
          appropriate safeguards such as Standard Contractual Clauses.
        </p>

        <h2>10. Children</h2>
        <p>The Service is for business use and is not directed to anyone under 18.</p>

        <h2>11. Changes</h2>
        <p>We may update this policy; we&rsquo;ll revise the date above and, for material changes, notify you.</p>

        <h2>12. Contact</h2>
        <p>
          <strong>Fresh N Fresh, Inc</strong> (d/b/a Fresh Leads), 16220 McAloon Way,
          Austin, TX 78728, <a href="mailto:info@fresh-leads.io">info@fresh-leads.io</a>.
        </p>

        <p className="legal-links"><Link href="/terms">Terms of Service →</Link></p>
      </article>
      <MarketingFooter settings={s} />
    </div>
  );
}
