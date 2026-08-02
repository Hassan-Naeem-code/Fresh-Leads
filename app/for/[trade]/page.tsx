import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSiteSettings } from "@/lib/site-settings.server";
import { currentEmail } from "@/lib/current-user";
import { LANDINGS, landingBySlug } from "@/lib/landing";
import { SIGNUP_BONUS_CREDITS } from "@/lib/pricing";
import { MarketingNav } from "../../MarketingNav";
import { MarketingFooter } from "../../MarketingFooter";
import { BreadcrumbSchema } from "../../StructuredData";
import { Reveal } from "../../Reveal";
import { Check, ArrowRight, Search, Coin, Flame } from "../../icons";

// Static at build time: these pages never change per request, and a search engine
// crawling them should get a file rather than a render.
export const dynamicParams = false;
export function generateStaticParams() {
  return LANDINGS.map((l) => ({ trade: l.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ trade: string }>;
}): Promise<Metadata> {
  const { trade } = await params;
  const landing = landingBySlug(trade);
  if (!landing) return {};
  return {
    title: landing.metaTitle,
    description: landing.metaDescription,
    alternates: { canonical: `/for/${landing.slug}` },
    openGraph: { title: landing.metaTitle, description: landing.metaDescription },
  };
}

export default async function TradeLanding({ params }: { params: Promise<{ trade: string }> }) {
  const { trade } = await params;
  const landing = landingBySlug(trade);
  if (!landing) notFound();

  const [settings, email] = await Promise.all([getSiteSettings(), currentEmail()]);

  return (
    <div>
      <BreadcrumbSchema
        trail={[
          { name: "Home", path: "/" },
          { name: landing.audience, path: `/for/${landing.slug}` },
        ]}
      />
      <MarketingNav settings={settings} email={email} />

      <div className="pr-herowrap">
        <header className="pr pr-hero compact">
          <Reveal immediate className="pr-eyebrow">
            <span className="pill">For {landing.audience}</span>
          </Reveal>
          <Reveal immediate delay={80}>
            <h1 className="pr-h1">
              {landing.headline}
              <br />
              <span className="accent">{landing.accent}</span>
            </h1>
          </Reveal>
          <Reveal immediate delay={160}>
            <p className="pr-lead">{landing.intro}</p>
          </Reveal>
          <Reveal immediate delay={240} className="pr-herobtns">
            <Link href="/signup" className="pr-btn accent">
              <Search size={16} /> Get {SIGNUP_BONUS_CREDITS} free credits
            </Link>
            <Link href="/pricing" className="pr-btn ghost">
              See pricing <ArrowRight size={15} />
            </Link>
          </Reveal>
        </header>
      </div>

      <section className="pr pr-section">
        <Reveal className="pr-eyebrow"><span className="pill">What we find</span></Reveal>
        <Reveal><h2 className="pr-h2">The signals that matter<br />to your pitch.</h2></Reveal>
        <Reveal>
          <p className="pr-sectionlead">
            The grade on every lead is calculated against what you sell, so a business that is
            perfect for you and useless for somebody else scores accordingly.
          </p>
        </Reveal>
        <Reveal>
          <ul className="landsignals">
            {landing.signals.map((s) => (
              <li key={s}><Check size={16} /> {s}</li>
            ))}
          </ul>
        </Reveal>
      </section>

      <Reveal as="section" className="pr pr-section">
        <div className="pr-dark">
          <div className="pr-eyebrow"><span className="pill"><Flame size={13} /> And what changed</span></div>
          <h2 className="pr-h2">A business that just<br />changed something is a call.</h2>
          <p className="pr-sectionlead">
            We photograph these businesses over time, so we can tell you when a site goes down,
            a booking system appears, or a vendor gets swapped. Nobody selling from a standing
            database can do that, because they only know what a business is, not what it just did.
          </p>
        </div>
      </Reveal>

      <section className="pr pr-section">
        <Reveal className="pr-eyebrow"><span className="pill">Who buys from you</span></Reveal>
        <Reveal><h2 className="pr-h2">Common starting points</h2></Reveal>
        <Reveal>
          <div className="landniches">
            {landing.niches.map((n) => (
              <span className="pr-schip" key={n}>{n}</span>
            ))}
          </div>
        </Reveal>
        <Reveal>
          <p className="pr-sectionlead" style={{ marginTop: 18 }}>
            Not a fixed list. Describe your ideal customer in a sentence and we work out the
            search, or pick the business type and the area yourself.
          </p>
        </Reveal>
      </section>

      <section className="pr pr-section pr-cta">
        <Reveal className="pr-eyebrow"><span className="pill"><Coin size={13} /> Pricing</span></Reveal>
        <Reveal><h2 className="pr-h2">One credit, one lead,<br />yours for good.</h2></Reveal>
        <Reveal>
          <p className="pr-sectionlead">
            Searching is free. Credits are a dollar each and you spend one only on a lead you
            decide to open. Start with {SIGNUP_BONUS_CREDITS} free and no card.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <div className="pr-herobtns" style={{ marginTop: 26 }}>
            <Link href="/signup" className="pr-btn accent">
              Start free <ArrowRight size={16} />
            </Link>
            <Link href="/compare" className="pr-btn ghost">How we compare</Link>
          </div>
        </Reveal>
      </section>

      <MarketingFooter settings={settings} />
    </div>
  );
}
