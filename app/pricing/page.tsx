import Link from "next/link";
import type { Metadata } from "next";
import { getSiteSettings } from "@/lib/site-settings.server";
import { currentEmail } from "@/lib/current-user";
import { SUBSCRIPTION_PRICE_CENTS } from "@/lib/access";
import { SIGNUP_BONUS_CREDITS, CREDIT_PRICE_CENTS } from "@/lib/credits";
import {
  MIN_CREDIT_PURCHASE,
  VOLUME_BONUS_MIN_CREDITS,
  VOLUME_BONUS_CREDITS,
  PURCHASE_BONUSES,
} from "@/lib/pricing";
import { MarketingNav } from "../MarketingNav";
import { MarketingFooter } from "../MarketingFooter";
import { Check, ArrowRight, Phone, Mail, MapPin, Gauge, Coin, Lock } from "../icons";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "$30 a year keeps your account open, then credits are $1 each. 1 credit opens 1 lead, permanently. Start with 3 free credits. No credit card required.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing",
    description:
      "$30 a year for access, then $1 a credit. Start with 3 free credits. No credit card required.",
    url: "/pricing",
  },
};

const money = (cents: number) => {
  const d = cents % 100 === 0 ? 0 : 2;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};

export default async function PricingPage() {
  const [settings, email] = await Promise.all([getSiteSettings(), currentEmail()]);
  const year = money(SUBSCRIPTION_PRICE_CENTS);
  const perCredit = money(CREDIT_PRICE_CENTS);

  return (
    <div>
      <MarketingNav settings={settings} email={email} />

      <header className="pr pr-hero" style={{ paddingBottom: 24 }}>
        <div className="pr-eyebrow">
          <span className="pill">
            <Gauge size={13} /> Pay as you go
          </span>
        </div>
        <h1 className="pr-h1" style={{ fontSize: "clamp(34px,5vw,58px)" }}>
          {year} a year. <span className="accent">{perCredit} a credit.</span>
        </h1>
        <p className="pr-lead">
          No packages, no quotas, no sales call. {year} keeps your account open for a full year, and
          credits are bought separately at {perCredit} each. The two are independent: the yearly fee
          is access to the platform, credits are what you spend on it. One credit opens one lead,
          and that lead is yours permanently.
        </p>
        <div className="promo-banner">
          <span className="promo-tag">Free to start</span>
          <b>{SIGNUP_BONUS_CREDITS} free credits when you sign up. No credit card required.</b> Search and
          open {SIGNUP_BONUS_CREDITS} leads on us, then decide.
        </div>
      </header>

      <section className="pr" style={{ paddingBottom: 20 }}>
        <div className="price-grid two">
          {/* Access */}
          <div className="price-card popular">
            <span className="price-badge">Everyone pays this</span>
            <h3 className="price-name">Full access</h3>
            <p className="price-tag">
              One flat fee to keep your account open for a year. Credits are separate.
            </p>
            <div className="price-amount">
              <b>{year}</b>
              <span>/ year</span>
            </div>
            <div className="price-unit">Works out to {money(250)} a month, billed once.</div>
            <ul className="price-features">
              <li>
                <Check size={14} className="i-cool" /> Keeps your account active for 12 months
              </li>
              <li>
                <Check size={14} className="i-cool" /> Unlocks the ability to buy credits
              </li>
              <li>
                <Check size={14} className="i-cool" /> Every business verified and graded 0&ndash;100
              </li>
              <li>
                <Check size={14} className="i-cool" /> Search by the problem you fix, not just niche
              </li>
              <li>
                <Check size={14} className="i-cool" /> Cancel any time, access runs to year end
              </li>
            </ul>
            {/* Said plainly, because a yearly fee that includes nothing is exactly the
                kind of thing a customer should never discover after paying. */}
            <p className="price-note">
              <b>Includes 0 credits.</b> You need credits to search for and open leads.
            </p>
            <Link
              href="/signup"
              className="pr-btn accent"
              style={{ width: "100%", justifyContent: "center" }}
            >
              Start with {SIGNUP_BONUS_CREDITS} free credits
            </Link>
          </div>

          {/* Credits */}
          <div className="price-card">
            <h3 className="price-name">Credits</h3>
            <p className="price-tag">
              What you spend on the platform. One credit opens one lead.
            </p>
            <div className="price-amount">
              <b>{perCredit}</b>
              <span>/ credit</span>
            </div>
            <div className="price-unit">
              Top up from {MIN_CREDIT_PURCHASE} credits
              ({money(CREDIT_PRICE_CENTS * MIN_CREDIT_PURCHASE)}), they never expire.
            </div>
            <ul className="price-features">
              <li>
                <Check size={14} className="i-cool" /> Full contact details, phone and email verified
              </li>
              <li>
                <Check size={14} className="i-cool" /> Every finding we scored them on
              </li>
              <li>
                <Check size={14} className="i-cool" /> What to pitch, in plain English
              </li>
              <li>
                <Check size={14} className="i-cool" /> Yours permanently, re-open it free forever
              </li>
              <li>
                <Check size={14} className="i-cool" /> Exporting a lead you own costs nothing
              </li>
              <li>
                <Check size={14} className="i-cool" /> Buy {VOLUME_BONUS_MIN_CREDITS} credits in a
                month and we add {VOLUME_BONUS_CREDITS} free
              </li>
              <li>
                <Check size={14} className="i-cool" /> Bigger top-ups earn bonus credits:{" "}
                {PURCHASE_BONUSES.slice().reverse().map((b) => `${b.min} gets +${b.bonus}`).join(", ")}
              </li>
            </ul>
            <Link
              href="/signup"
              className="pr-btn primary"
              style={{ width: "100%", justifyContent: "center" }}
            >
              Try {SIGNUP_BONUS_CREDITS} on us <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      {/* How the credit actually works, because "1 credit" needs to be unambiguous */}
      <section className="pr pr-section">
        <div className="pr-eyebrow">
          <span className="pill">
            <Coin size={13} /> How credits work
          </span>
        </div>
        <h2 className="pr-h2">A credit buys a business lead, not a click</h2>
        <div className="pr-grid4" style={{ marginTop: 36 }}>
          <div className="pr-card">
            <div className="pr-cardicon">
              <Gauge size={22} />
            </div>
            <b>Searching costs nothing</b>
            <p>
              Searching never spends a credit, though you do need at least one in your balance to
              run one. Browse who we found and how they grade before deciding what to open.
            </p>
          </div>
          <div className="pr-card">
            <div className="pr-cardicon">
              <Lock size={22} />
            </div>
            <b>One credit to open</b>
            <p>
              Open a lead and a single credit unlocks its contact details, every finding, and the
              pitch. That is the only time you are charged.
            </p>
          </div>
          <div className="pr-card">
            <div className="pr-cardicon">
              <Check size={22} />
            </div>
            <b>Yours for good</b>
            <p>
              Once opened, it stays in your history. Re-reading it, and exporting it, are free
              forever. You never pay twice for the same business.
            </p>
          </div>
          <div className="pr-card">
            <div className="pr-cardicon">
              <Coin size={22} />
            </div>
            <b>Exports are per lead</b>
            <p>
              Exporting charges one credit per lead you have not opened yet, and nothing at all for
              the ones you already own.
            </p>
          </div>
        </div>
      </section>

      {/* What verification means, unchanged, it's the product */}
      <section className="pr pr-section" style={{ paddingTop: 0 }}>
        <div className="pr-eyebrow">
          <span className="pill">Every lead, every time</span>
        </div>
        <h2 className="pr-h2">What a dollar actually gets you</h2>
        <div className="pr-grid4" style={{ marginTop: 36 }}>
          <div className="pr-card">
            <div className="pr-cardicon">
              <Mail size={22} />
            </div>
            <b>Deliverable email</b>
            <p>
              We confirm the inbox accepts mail before a lead reaches you, no bounces wrecking your
              domain.
            </p>
          </div>
          <div className="pr-card">
            <div className="pr-cardicon">
              <Phone size={22} />
            </div>
            <b>Reachable phone</b>
            <p>Numbers are validated and typed, so you dial a line that actually rings.</p>
          </div>
          <div className="pr-card">
            <div className="pr-cardicon">
              <MapPin size={22} />
            </div>
            <b>Confirmed active</b>
            <p>Every business is checked as still operating, not closed or stale.</p>
          </div>
          <div className="pr-card">
            <div className="pr-cardicon">
              <Gauge size={22} />
            </div>
            <b>Graded 0&ndash;100</b>
            <p>
              An opportunity score with a plain-English reason, so you work the best leads first.
            </p>
          </div>
        </div>
      </section>

      <section className="pr pr-section" style={{ paddingTop: 0 }}>
        <div className="pr-dark">
          <div className="pr-eyebrow" style={{ justifyContent: "flex-start", marginBottom: 14 }}>
            <span className="pill">Our promise</span>
          </div>
          <h2 className="pr-h2" style={{ textAlign: "left" }}>
            You never pay for the same lead twice
          </h2>
          <p className="pr-sectionlead" style={{ textAlign: "left", margin: "14px 0 0" }}>
            A credit buys a business permanently. Open it again next month, export it again next
            year, it is still free. And you decide which ones are worth a dollar, after seeing how
            they grade. The {year} keeps your account open; what you spend on leads is entirely up
            to you.
          </p>
          <div style={{ marginTop: 26 }}>
            <Link href="/signup" className="pr-btn accent">
              Start with {SIGNUP_BONUS_CREDITS} free credits <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter settings={settings} />
    </div>
  );
}
