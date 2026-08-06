import Link from "next/link";
import type { Metadata } from "next";
import {
  Mail, Phone, Building, Clock, Search, ArrowRight, Check, Coin,
} from "./icons";
import { SIGNUP_BONUS_CREDITS } from "@/lib/credits";
import { getSiteSettings } from "@/lib/site-settings.server";
import { currentEmail } from "@/lib/current-user";
import { MarketingNav } from "./MarketingNav";
import { Reveal } from "./Reveal";
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
          {/* The line the mock needs to earn its space. Without it the screenshot is
              just a list; with it, the reader knows what they are looking at and why
              it is different from every other lead tool they have tried. */}
          <Reveal immediate delay={380}>
            <p className="pr-mockcap">
              We score digital footprints so you can know the lead quality before you pitch.
            </p>
          </Reveal>
          <Reveal immediate delay={420}><HeroMock /></Reveal>
        </header>
      </div>

      {/* Quality, four checks */}
      <section id="quality" className="pr pr-section">
        <Reveal className="pr-eyebrow"><span className="pill">Quality</span></Reveal>
        <Reveal><h2 className="pr-h2">Every lead clears four checks<br />before you see it</h2></Reveal>
        {/* The opening sentence used to be "A lead you can't reach isn't a lead", which is
            the headline of the dark panel directly below. Saying it twice made the page
            feel padded rather than emphatic. */}
        <Reveal><p className="pr-sectionlead">We don&rsquo;t deliver a name until it passes:</p></Reveal>
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
        <Reveal><h2 className="pr-h2">Three steps.<br />That is the whole product.</h2></Reveal>
        <Reveal className="pr-steps">
          {/* One line each, and each line says something the others do not.
              Steps two and three both used to begin with "search", so the sequence read
              as two things happening twice rather than as three steps. */}
          <div className="pr-step">
            <div className="pr-stepn">1</div>
            <b>Say what you sell</b>
            <p>A trade and a town, or one sentence about your ideal customer.</p>
            <div className="pr-stepproof">
              <span className="pr-schip">Plumbers</span>
              <span className="pr-schip">Austin · 10&nbsp;miles</span>
            </div>
          </div>
          <div className="pr-step accent">
            <div className="pr-stepn">2</div>
            <b>Search for free</b>
            <p>Every business is checked while you wait, then graded.</p>
            <div className="pr-stepproof">
              <span className="pr-schip">0-100 grade</span>
            </div>
          </div>
          <div className="pr-step">
            <div className="pr-stepn">3</div>
            <b>Open the ones worth calling</b>
            <p>One credit each, yours permanently. Export any time.</p>
            <div className="pr-stepproof">
              <span className="pr-sprice"><b>$1</b> / credit = 1 lead</span>
            </div>
          </div>
        </Reveal>
      </section>

      {/* Pricing */}
      <section id="pricing" className="pr pr-section pr-cta">
        <Reveal className="pr-eyebrow"><span className="pill">Pricing</span></Reveal>
        <Reveal><h2 className="pr-h2">Pay for exactly what you need</h2></Reveal>
        <Reveal><p className="pr-sectionlead">No sales calls, no bloated subscriptions. Pay $30 a year to keep your account active, then credits are $1 each. You only pay for fully verified leads, guaranteed.</p></Reveal>
        <Reveal delay={120}>
          <div className="pr-herobtns" style={{ marginTop: 28 }}>
            <Link href="/signup" className="pr-btn accent">
              Start with {SIGNUP_BONUS_CREDITS} free credits <ArrowRight size={16} />
            </Link>
            <Link href="/pricing" className="pr-btn ghost">See pricing</Link>
          </div>
        </Reveal>
      </section>

      {/* The horizontally scrolling values section used to sit here and has been
          removed. Two of its four cards restated the Quality checks above almost word
          for word, reachable and fresh, so a visitor read the same promise twice in
          different clothes. It also hijacked vertical scrolling to move sideways, which
          is a thing to do once on a page nobody is trying to get through, not on the
          route to a signup button. */}

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

      <MarketingFooter settings={settings} />
    </div>
  );
}
