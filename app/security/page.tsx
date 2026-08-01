import type { Metadata } from "next";
import Link from "next/link";
import { getSiteSettings } from "@/lib/site-settings.server";
import { currentEmail } from "@/lib/current-user";
import { MarketingNav } from "../MarketingNav";
import { MarketingFooter } from "../MarketingFooter";
import { BreadcrumbSchema } from "../StructuredData";
import { Reveal } from "../Reveal";
import { Shield, Lock, Key, Check, Building, Mail, AlertTriangle, Clock } from "../icons";

export const metadata: Metadata = {
  title: "Security",
  description:
    "How Fresh Leads protects your account and your data: two factor on every account, encryption at rest, row level database isolation, and what we will never do with your searches.",
  alternates: { canonical: "/security" },
};

// The trust page. Every serious B2B tool has one, and buyers with a security review
// look for it before they look at pricing.
//
// Written as commitments rather than adjectives. "Enterprise grade security" says
// nothing; "two factor is required, not offered" is a fact somebody can check.
const MEASURES = [
  {
    icon: <Shield size={22} />,
    title: "Two factor is required, not offered",
    body: "Every account, including ours. A password on its own reaches nothing. Choose an authenticator app, an emailed code, a text, or a passkey using Face ID or a fingerprint.",
  },
  {
    icon: <Lock size={22} />,
    title: "Your leads are yours alone",
    body: "Searches, leads and unlocks are isolated per account by the database itself, at the row level, not just by the interface. Another customer cannot read your work even if a bug in a page tried to show it to them.",
  },
  {
    icon: <Key size={22} />,
    title: "Credentials are never stored in the clear",
    body: "Passwords are hashed with scrypt. API keys are stored as hashes, so a leaked table cannot be used to call anything. CRM tokens are encrypted with AES-256-GCM using a key that is not in the database.",
  },
  {
    icon: <Building size={22} />,
    title: "Payments never touch our servers",
    body: "Card details go directly to Stripe. We never see, transmit or store a card number, which is also why we cannot leak one.",
  },
  {
    icon: <Check size={22} />,
    title: "Every operator action is logged",
    body: "If our support team adjusts a balance, suspends an account, or looks something up, it is written to an append only audit record that the panel cannot edit or delete.",
  },
  {
    icon: <Clock size={22} />,
    title: "Deleting means deleting",
    body: "Close your account and your searches, leads, credits, keys, integrations and sequences are removed. What survives is a dated row saying an account closed, carrying nothing that identifies you.",
  },
];

const PROMISES = [
  "We do not sell your search history, and we do not tell anyone which businesses you are working.",
  "We do not train anything on your lead data.",
  "We do not email your leads on your behalf without you writing the message and pressing start.",
  "We do not share data between customer accounts, ever, in any aggregated form that could identify who searched for what.",
];

export default async function SecurityPage() {
  const [settings, email] = await Promise.all([getSiteSettings(), currentEmail()]);

  return (
    <div>
      <BreadcrumbSchema trail={[{ name: "Home", path: "/" }, { name: "Security", path: "/security" }]} />
      <MarketingNav settings={settings} email={email} />

      <div className="pr-herowrap">
        <header className="pr pr-hero compact">
          <Reveal immediate className="pr-eyebrow">
            <span className="pill"><Shield size={13} /> Security</span>
          </Reveal>
          <Reveal immediate delay={80}>
            <h1 className="pr-h1">Built so a stolen password<br /><span className="accent">is not enough.</span></h1>
          </Reveal>
          <Reveal immediate delay={160}>
            <p className="pr-lead">
              You are trusting us with the list of businesses you are about to call, which is
              commercially sensitive whether or not it feels like it. Here is exactly what we do
              about that, in terms you can check rather than adjectives you cannot.
            </p>
          </Reveal>
        </header>
      </div>

      <section className="pr pr-section">
        <Reveal className="pr-grid4">
          {MEASURES.map((m) => (
            <div className="pr-card" key={m.title}>
              <span className="pr-cardicon">{m.icon}</span>
              <b>{m.title}</b>
              <p>{m.body}</p>
            </div>
          ))}
        </Reveal>
      </section>

      <Reveal as="section" className="pr pr-section">
        <div className="pr-dark">
          <div className="pr-eyebrow"><span className="pill">What we will not do</span></div>
          <h2 className="pr-h2">Four promises,<br />plainly stated.</h2>
          <ul className="seclist">
            {PROMISES.map((p) => (
              <li key={p}><Check size={16} /> {p}</li>
            ))}
          </ul>
        </div>
      </Reveal>

      <section className="pr pr-section">
        <Reveal className="pr-eyebrow"><span className="pill">Reporting a problem</span></Reveal>
        <Reveal><h2 className="pr-h2">Found something? Tell us.</h2></Reveal>
        <Reveal>
          <p className="pr-sectionlead">
            If you believe you have found a vulnerability, write to us before telling anybody
            else and we will work with you. We do not threaten researchers who act in good
            faith, and we will credit you if you want the credit.
          </p>
        </Reveal>
        <Reveal className="pr-herobtns">
          <a className="pr-btn accent" href="mailto:security@fresh-leads.io">
            <Mail size={16} /> security@fresh-leads.io
          </a>
          <Link className="pr-btn ghost" href="/contact">Contact us <AlertTriangle size={15} /></Link>
        </Reveal>
        <Reveal>
          <p className="muted sm" style={{ marginTop: 18, maxWidth: "62ch" }}>
            Please do not run automated scanners or load tests against the live service. They
            look identical to an attack from our side, and we will block them. Ask first and we
            will arrange a window.
          </p>
        </Reveal>
      </section>

      <MarketingFooter settings={settings} />
    </div>
  );
}
