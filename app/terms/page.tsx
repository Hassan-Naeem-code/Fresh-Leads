import Link from "next/link";
import type { Metadata } from "next";
import { getSiteSettings } from "@/lib/site-settings.server";
import { BrandMark, BrandName } from "../brand";
import { MarketingFooter } from "../MarketingFooter";
import { ArrowRight } from "../icons";

export const metadata: Metadata = {
  title: "Terms of Service",
  alternates: { canonical: "/terms" },
};

export default async function TermsPage() {
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
        <h1>Terms of Service</h1>
        <p className="updated">Last updated: 21 July 2026</p>

        <p>
          These Terms govern your use of the {brand} website and lead-generation service (the
          &ldquo;Service&rdquo;) provided by <strong>Fresh N Fresh, Inc</strong>. By creating an account
          or using the Service, you agree to these Terms.
        </p>

        <h2>1. The Service</h2>
        <p>
          {brand} compiles business contact information from publicly available sources and applies
          verification checks (email deliverability, phone validity, active-business and freshness
          signals), then delivers scored leads based on the criteria you provide.
        </p>

        <h2>2. Accounts &amp; eligibility</h2>
        <p>
          You must be at least 18 and use the Service for legitimate business purposes. You are
          responsible for your account credentials and all activity under your account.
        </p>

        <h2>3. Acceptable use, your responsibility for outreach</h2>
        <p>
          The Service provides data; how you use it is your responsibility. You agree to comply with all
          applicable laws when contacting leads, including anti-spam and telemarketing laws
          (e.g. <strong>CAN-SPAM</strong>, <strong>GDPR/PECR</strong>, <strong>CASL</strong>, TCPA and
          Do-Not-Call rules). You must not use the Service to send unlawful spam, harass recipients, or
          for any illegal purpose. You must honor opt-out requests from anyone you contact.
        </p>

        <h2>4. Lead data, accuracy disclaimer</h2>
        <p>
          Lead information is derived from third-party and public sources and verification signals. While
          we work to deliver accurate, reachable contacts, we do <strong>not guarantee</strong> the
          accuracy, completeness, or fitness of any lead, and we are not responsible for the outcome of
          your outreach.
        </p>

        <h2>5. Payment &amp; billing</h2>
        <p>
          Pricing is quoted to your requirements. Payments are processed by Stripe. Subscriptions renew
          per the plan you select until cancelled. Only verified, deliverable leads count against your
          quota.
        </p>

        <h2>6. Cancellation &amp; refunds</h2>
        <p>
          You may cancel at any time; cancellation stops future renewals. Except where required by law,
          fees already paid are non-refundable. [Insert your refund policy here.]
        </p>

        <h2>7. Intellectual property</h2>
        <p>
          The Service, its software, and branding are owned by us. You receive a limited, non-exclusive
          right to use the Service and the leads delivered to you for your own business outreach.
        </p>

        <h2>8. Disclaimers</h2>
        <p>
          The Service is provided &ldquo;as is&rdquo; without warranties of any kind, to the fullest
          extent permitted by law.
        </p>

        <h2>9. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, we are not liable for indirect, incidental, or
          consequential damages, and our total liability is limited to the amount you paid in the
          <strong> 3 months</strong> before the claim.
        </p>

        <h2>10. Indemnification</h2>
        <p>
          You agree to indemnify us against claims arising from your use of the Service or your outreach
          to leads in violation of these Terms or applicable law.
        </p>

        <h2>11. Governing law</h2>
        <p>These Terms are governed by the laws of the <strong>State of Florida</strong>, United States, without regard to conflict-of-law rules.</p>

        <h2>12. Changes</h2>
        <p>We may update these Terms; continued use after changes means you accept them.</p>

        <h2>13. Contact</h2>
        <p>
          <strong>Fresh N Fresh, Inc</strong>, {" "}
          <a href="mailto:info@fresh-leads.io">info@fresh-leads.io</a>.
        </p>

        <p className="legal-links"><Link href="/privacy">Privacy Policy →</Link></p>
      </article>
      <MarketingFooter settings={s} />
    </div>
  );
}
