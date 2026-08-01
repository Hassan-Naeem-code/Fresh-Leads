import Link from "next/link";
import type { Metadata } from "next";
import {
  Mail, Phone, Building, Clock, Search, ArrowRight, Check, Gauge, MapPin, Flame, Download, Coin,
} from "./icons";
import { SIGNUP_BONUS_CREDITS } from "@/lib/credits";
import { getSiteSettings } from "@/lib/site-settings.server";
import { currentEmail } from "@/lib/current-user";
import { MarketingNav } from "./MarketingNav";
import { Reveal } from "./Reveal";
import { HScrollCards } from "./HScrollCards";
import { HeroMock } from "./HeroMock";
import { MarketingFooter } from "./MarketingFooter";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSiteSettings();
  return {
    title: `${s.brand_name}, Verified local business leads, on demand`,
    description:
      "Tell us your ideal customer. We surface real local businesses, verify every email and phone, confirm they're open, and deliver only leads worth paying for.",
  };
}

const CHECKS = [
  { icon: <Mail size={22} />, t: "Deliverable email", d: "We find the real inbox from their site and confirm it accepts mail, no bounces.", proof: "hello@brewco.com", tag: "deliverable" },
  { icon: <Phone size={22} />, t: "Reachable phone", d: "Numbers are validated and typed, so you dial a line that actually rings.", proof: "(512) 555-0142", tag: "rings · mobile" },
  { icon: <Building size={22} />, t: "Active business", d: "We confirm the site is live and the business is still operating, not closed or stale.", proof: "Open now", tag: "verified 2h ago" },
  { icon: <Clock size={22} />, t: "Fresh data", d: "Listings are age-checked so the contact details are still current.", proof: "Last checked", tag: "today" },
];

export default async function Landing() {
  const [settings, email] = await Promise.all([getSiteSettings(), currentEmail()]);
  return (
    <div>
      {/* Nav */}
      <MarketingNav settings={settings} email={email}>
        <a href="#how" className="hideable">How it works</a>
      </MarketingNav>

      {/* Hero */}
      <div className="pr-herowrap">
        <header className="pr pr-hero">
          <Reveal immediate className="pr-eyebrow">
            <span className="pill">
              <Coin size={13} /> {SIGNUP_BONUS_CREDITS} free credits when you sign up. No credit card required.
            </span>
          </Reveal>
          <Reveal immediate delay={80}>
            <h1 className="pr-h1">Real local leads that<br /><span className="accent">actually convert.</span></h1>
          </Reveal>
          <Reveal immediate delay={160}>
            <p className="pr-lead">
              Target your ideal businesses and get verified, pre vetted local leads.{" "}
              {settings.brand_name} confirms active contact details and grades what each prospect
              actually needs. Credits are $1 each, one credit opens one lead, and it is yours for
              good.
            </p>
          </Reveal>
          <Reveal immediate delay={240} className="pr-herobtns">
            <Link href="/signup" className="pr-btn accent">
              <Search size={16} /> Get {SIGNUP_BONUS_CREDITS} free credits, no credit card
            </Link>
            <a href="#how" className="pr-btn ghost">See how it works <ArrowRight size={15} /></a>
          </Reveal>
          <Reveal immediate delay={320} className="pr-trust">
            <span><Building size={14} /> Real businesses</span>
            <span><Mail size={14} /> Verified email</span>
            <span><Phone size={14} /> Verified phone</span>
            <span><Clock size={14} /> Confirmed active</span>
            <span><Coin size={14} /> $1 a credit, yours forever</span>
          </Reveal>
          <Reveal immediate delay={420}><HeroMock /></Reveal>
        </header>
      </div>

      {/* Quality, four checks */}
      <section id="quality" className="pr pr-section">
        <Reveal className="pr-eyebrow"><span className="pill">Quality</span></Reveal>
        <Reveal><h2 className="pr-h2">Every lead clears four checks<br />before you see it</h2></Reveal>
        <Reveal><p className="pr-sectionlead">A lead you can&rsquo;t reach isn&rsquo;t a lead. We don&rsquo;t deliver a name until it passes:</p></Reveal>
        <Reveal className="pr-grid4">
          {CHECKS.map((c) => (
            <div className="pr-card" key={c.t}>
              <span className="pr-cardicon">{c.icon}</span>
              <b>{c.t}</b>
              <p>{c.d}</p>
              <div className="pr-cardproof">
                <span className="pr-proofval">{c.proof}</span>
                <span className="pr-prooftag"><Check size={11} /> {c.tag}</span>
              </div>
            </div>
          ))}
        </Reveal>
      </section>

      {/* Problem, dark panel */}
      <Reveal as="section" className="pr pr-section">
        <div className="pr-dark" style={{ textAlign: "center" }}>
          <div className="pr-eyebrow"><span className="pill">The problem</span></div>
          <h2 className="pr-h2">A lead you can&rsquo;t reach<br />isn&rsquo;t a lead.</h2>
          <p className="pr-sectionlead">Scraped lists are full of dead addresses, closed businesses, and bounced emails, every one a wasted pitch. We remove them before you ever see them.</p>
        </div>
      </Reveal>

      {/* How it works */}
      <section id="how" className="pr pr-section">
        <Reveal className="pr-eyebrow"><span className="pill">How it works</span></Reveal>
        <Reveal><h2 className="pr-h2">From your ideal customer to<br />genuine leads in three steps</h2></Reveal>
        <Reveal className="pr-steps">
          <div className="pr-step">
            <div className="pr-stepn">1</div>
            <b>Tell us what you sell</b>
            <p>Describe your ideal customer in a sentence, or pick the business type and the area you cover.</p>
            <div className="pr-stepproof">
              <span className="pr-schip">Plumbers</span>
              <span className="pr-schip">Austin · 15&nbsp;km</span>
              <span className="pr-schip">Independent</span>
            </div>
          </div>
          <div className="pr-step accent">
            <div className="pr-stepn">2</div>
            <b>Search free, pay per lead</b>
            <p>Searching costs nothing. Spend a credit only on a lead you want to open, and it is yours permanently.</p>
            <div className="pr-stepproof">
              <span className="pr-sprice"><b>$1</b> / credit = 1 lead</span>
            </div>
          </div>
          <div className="pr-step">
            <div className="pr-stepn">3</div>
            <b>Search &amp; export verified leads</b>
            <p>Run searches in a filterable dashboard, grade every prospect, and export only the genuine ones.</p>
            <div className="pr-stepproof">
              <span className="pr-schip"><Download size={12} /> Export CSV</span>
              <span className="pr-schip">0-100 grade</span>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Our values, pinned title, cards scroll horizontally (Primer effect) */}
      <HScrollCards
        eyebrow="What we stand for"
        title="Built on a simple promise"
        desc="Our standards are the whole product. Every lead you get has cleared them, nothing else reaches you."
        cards={[
          { icon: <Phone size={22} />, num: "01", title: "Reachable or it doesn't count", body: "If we can't verify the email and phone, the lead never reaches you. No filler, no dead ends, just contacts you can actually work." },
          { icon: <Clock size={22} />, num: "02", title: "Fresh, never stale", body: "Every listing is age-checked and re-confirmed active, so you're never chasing a business that closed months ago." },
          { icon: <Gauge size={22} />, num: "03", title: "Graded, so you know who to call", body: "A 0-100 opportunity score on every prospect with a plain-English reason, so your team always works the best leads first." },
          { icon: <Check size={22} />, num: "04", title: "You only pay for real", body: "We check the phone and the mailbox before a credit is spent. If a lead turns out to be unreachable, you keep the credit." },
        ]}
      />

      {/* Sample lead, dark panel */}
      <Reveal as="section" className="pr pr-section">
        <div className="pr-dark">
          <div className="pr-preview">
            <div className="pr-previewbadge">92<small>HOT</small></div>
            <div>
              <div className="pr-eyebrow" style={{ justifyContent: "flex-start", marginBottom: 12 }}><span className="pill">Sample lead</span></div>
              <h2 className="pr-h2" style={{ textAlign: "left", fontSize: "clamp(24px,3vw,34px)" }}>A graded, verified prospect</h2>
              <div className="pr-metarow">
                <span><Phone size={14} /> verified</span>
                <span><Mail size={14} /> deliverable</span>
                <span><MapPin size={14} /> active</span>
                <span><Flame size={14} /> no website, high need</span>
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      {/* Testimonials, hover flips each card to dark */}
      <section className="pr pr-section">
        <Reveal className="pr-eyebrow"><span className="pill">From teams like yours</span></Reveal>
        <Reveal><h2 className="pr-h2">Spend time closing, not chasing</h2></Reveal>
        <Reveal className="pr-quotes">
          {[
            { q: "We stopped burning a whole morning verifying a list before we could even start calling. Now every number just rings.", n: "Maya R.", r: "Founder, home-services agency", a: "M" },
            { q: "The grade on each lead tells us who to call first. Our connect rate roughly doubled in the first month.", n: "Daniel K.", r: "Head of Sales, B2B SaaS", a: "D" },
            { q: "No more bounced emails wrecking our domain reputation. If Fresh Leads shows it, it's deliverable.", n: "Priya S.", r: "Growth lead, marketing studio", a: "P" },
          ].map((t) => (
            <div className="pr-quote" key={t.n}>
              <div className="pr-quotemark">&ldquo;</div>
              <p>{t.q}</p>
              <div className="pr-quotewho">
                <span className="pr-quoteav">{t.a}</span>
                <div>
                  <div className="pr-quotename">{t.n}</div>
                  <div className="pr-quoterole">{t.r}</div>
                </div>
              </div>
            </div>
          ))}
        </Reveal>
      </section>

      {/* Pricing */}
      <section id="pricing" className="pr pr-section pr-cta">
        <Reveal className="pr-eyebrow"><span className="pill">Pricing</span></Reveal>
        <Reveal><h2 className="pr-h2">Pay for exactly what you need</h2></Reveal>
        <Reveal><p className="pr-sectionlead">No sales calls, no bloated subscriptions. Pay $30 a year to keep your account active, then $1 a lead. You only pay for fully verified leads, guaranteed.</p></Reveal>
        <Reveal delay={120}>
          <div className="pr-herobtns" style={{ marginTop: 28 }}>
            <Link href="/signup" className="pr-btn accent">
              Start with {SIGNUP_BONUS_CREDITS} free credits <ArrowRight size={16} />
            </Link>
            <Link href="/pricing" className="pr-btn ghost">See pricing</Link>
          </div>
        </Reveal>
      </section>

      <MarketingFooter settings={settings} />
    </div>
  );
}
