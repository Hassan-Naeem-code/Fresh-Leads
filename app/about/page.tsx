import Link from "next/link";
import type { Metadata } from "next";
import { getSiteSettings } from "@/lib/site-settings.server";
import { currentEmail } from "@/lib/current-user";
import { MarketingNav } from "../MarketingNav";
import { MarketingFooter } from "../MarketingFooter";
import { ArrowRight, Check, Gauge, Phone, Building } from "../icons";

export const metadata: Metadata = {
  title: "About us",
  description:
    "Why we built a lead service that verifies and grades every prospect, so you stop paying for dead ends.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About us",
    description:
      "Why we built a lead service that verifies and grades every prospect, so you stop paying for dead ends.",
    url: "/about",
  },
};

export default async function AboutPage() {
  const [settings, email] = await Promise.all([getSiteSettings(), currentEmail()]);
  const brand = settings.brand_name;
  return (
    <div>
      <MarketingNav settings={settings} email={email} />

      <header className="pr pr-hero" style={{ paddingBottom: 24 }}>
        <div className="pr-eyebrow"><span className="pill"><Building size={13} /> About {brand}</span></div>
        <h1 className="pr-h1" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
          We got tired of <span className="accent">bad lead lists.</span>
        </h1>
        <p className="pr-lead">
          So we built the opposite: a service that finds real local businesses, proves each one is
          reachable and still open, grades how much they need your help, and only then hands them to you.
        </p>
      </header>

      {/* Story */}
      <section className="pr pr-section">
        <div className="about-prose">
          <p>
            Anyone who has bought a lead list knows the feeling. You pay for a few thousand &ldquo;contacts,&rdquo;
            start dialing, and half the numbers are dead, a third of the emails bounce, and a good chunk of the
            businesses closed months ago. You spend your first morning cleaning the list instead of selling.
          </p>
          <p>
            {brand} exists to delete that morning. We start from real, public map data, then run every prospect
            through a verification gate, does the email accept mail, does the phone line ring, is the business
            actually still operating? Whatever fails, we drop. What&rsquo;s left, we grade from 0&ndash;100 with a
            plain-English reason, so your team always knows who to call first.
          </p>
          <p>
            The result is a shorter list you can trust, instead of a long one you have to babysit. We&rsquo;d rather
            hand you fifty leads that all pick up than five thousand you have to sift.
          </p>
        </div>
      </section>

      {/* Principles */}
      <section className="pr pr-section" style={{ paddingTop: 0 }}>
        <div className="pr-eyebrow"><span className="pill">What we believe</span></div>
        <h2 className="pr-h2">Three things we refuse to compromise on</h2>
        <div className="pr-values" style={{ marginTop: 40 }}>
          <div className="pr-value">
            <div className="pr-valuenum">01</div>
            <h4>Reachable or it doesn&rsquo;t ship</h4>
            <p>If we can&rsquo;t verify the email and phone, the lead never reaches you. Quality is the product, not a feature.</p>
          </div>
          <div className="pr-value">
            <div className="pr-valuenum">02</div>
            <h4>Honesty over volume</h4>
            <p>We&rsquo;d rather send a small list that&rsquo;s all real than a big one padded with dead ends. You pay only for verified leads.</p>
          </div>
          <div className="pr-value">
            <div className="pr-valuenum">03</div>
            <h4>Transparent by default</h4>
            <p>Clear pricing, a visible grade with its reasoning, and no lock-in. You always know what you&rsquo;re getting and why.</p>
          </div>
        </div>
      </section>

      {/* How it works, condensed */}
      <section className="pr pr-section" style={{ paddingTop: 0 }}>
        <div className="pr-eyebrow"><span className="pill">How it works</span></div>
        <h2 className="pr-h2">From a niche to a list you can call</h2>
        <div className="pr-steps" style={{ marginTop: 40 }}>
          <div className="pr-step">
            <div className="pr-stepn">1</div>
            <b>Tell us your ideal lead</b>
            <p>Your niche, location, radius, volume, and the quality bar you want. We price a plan around exactly that.</p>
          </div>
          <div className="pr-step accent">
            <div className="pr-stepn">2</div>
            <b>We discover &amp; verify</b>
            <p>We pull real businesses from public map data, then verify email, phone, and that they&rsquo;re still open.</p>
          </div>
          <div className="pr-step">
            <div className="pr-stepn">3</div>
            <b>You get graded leads</b>
            <p>Each prospect arrives with a 0&ndash;100 opportunity score and the reason behind it. Export and start calling.</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pr pr-section pr-cta" style={{ paddingTop: 0 }}>
        <h2 className="pr-h2">Ready for a list you can trust?</h2>
        <p className="pr-sectionlead">Describe your ideal customer and see a quote in minutes.</p>
        <div className="pr-herobtns" style={{ marginTop: 26 }}>
          <Link href="/signup" className="pr-btn accent"><ArrowRight size={16} /> Get started</Link>
          <Link href="/pricing" className="pr-btn ghost">See pricing</Link>
        </div>
      </section>

      <MarketingFooter settings={settings} />
    </div>
  );
}
