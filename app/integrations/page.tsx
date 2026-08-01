import type { Metadata } from "next";
import Link from "next/link";
import { getSiteSettings } from "@/lib/site-settings.server";
import { currentEmail } from "@/lib/current-user";
import { MarketingNav } from "../MarketingNav";
import { MarketingFooter } from "../MarketingFooter";
import { BreadcrumbSchema } from "../StructuredData";
import { Reveal } from "../Reveal";
import { Building, Mail, Upload, Key, Download, ArrowRight, Check } from "../icons";

export const metadata: Metadata = {
  title: "Integrations",
  description:
    "Push leads straight into HubSpot or Salesforce, send them through email sequences, enrich a spreadsheet you already have, or call the API from your own system.",
  alternates: { canonical: "/integrations" },
};

// Where the leads go afterwards. Competitors put this page front and centre because
// "does it work with my CRM" is the second question every buyer asks, right after
// "is the data any good".
const INTEGRATIONS = [
  {
    icon: <Building size={22} />,
    name: "HubSpot",
    status: "Live",
    body: "Push opened leads in as companies. Matched on their website domain, so pushing the same business twice updates one record instead of creating a duplicate.",
    detail: "Connect with a service key in about two minutes. Nothing to install.",
  },
  {
    icon: <Building size={22} />,
    name: "Salesforce",
    status: "Live",
    body: "Leads arrive as Leads, which is what an unworked prospect is in Salesforce, and convert to an Account and Contact when you win one.",
    detail: "Standard OAuth. Works with Sales Cloud and Developer Edition.",
  },
  {
    icon: <Mail size={22} />,
    name: "Email sequences",
    status: "Built in",
    body: "Write a short sequence, put opened leads into it, and it sends on its own. Every message carries an unsubscribe link and your postal address, because the law requires both.",
    detail: "Anyone who opts out or bounces is never contacted again from your account.",
  },
  {
    icon: <Upload size={22} />,
    name: "Your own spreadsheet",
    status: "Built in",
    body: "Upload a list you already have and we fill in what is missing: verified phone and email, the owner where we can find one, and everything about their website.",
    detail: "One credit per row we actually enrich. A row we cannot identify costs nothing.",
  },
  {
    icon: <Key size={22} />,
    name: "API",
    status: "Live",
    body: "The same leads as the dashboard, from your own code, spending the same credits. No separate plan and no extra charge.",
    detail: "Bearer token auth. Search, unlock, and reveal an owner.",
  },
  {
    icon: <Download size={22} />,
    name: "CSV export",
    status: "Always free",
    body: "Every search exports to CSV. Exporting a lead you have already opened costs nothing and always will.",
    detail: "Your data leaves whenever you want it to.",
  },
];

export default async function IntegrationsPage() {
  const [settings, email] = await Promise.all([getSiteSettings(), currentEmail()]);

  return (
    <div>
      <BreadcrumbSchema trail={[{ name: "Home", path: "/" }, { name: "Integrations", path: "/integrations" }]} />
      <MarketingNav settings={settings} email={email} />

      <div className="pr-herowrap">
        <header className="pr pr-hero compact">
          <Reveal immediate className="pr-eyebrow">
            <span className="pill">Integrations</span>
          </Reveal>
          <Reveal immediate delay={80}>
            <h1 className="pr-h1">Leads land where<br /><span className="accent">you already work.</span></h1>
          </Reveal>
          <Reveal immediate delay={160}>
            <p className="pr-lead">
              A lead in a tool nobody opens is a lead nobody calls. Push to your CRM, run a
              sequence, enrich the list you already have, or call it from your own code. All of
              it is included; none of it costs an extra credit.
            </p>
          </Reveal>
        </header>
      </div>

      <section className="pr pr-section">
        <Reveal className="pr-grid4">
          {INTEGRATIONS.map((i) => (
            <div className="pr-card" key={i.name}>
              <span className="pr-cardicon">{i.icon}</span>
              <b>{i.name}</b>
              <p>{i.body}</p>
              <div className="pr-cardproof">
                <span className="pr-proofval">{i.detail}</span>
                <span className="pr-prooftag"><Check size={11} /> {i.status}</span>
              </div>
            </div>
          ))}
        </Reveal>
      </section>

      <Reveal as="section" className="pr pr-section">
        <div className="pr-dark" style={{ textAlign: "center" }}>
          <div className="pr-eyebrow"><span className="pill">Pushing costs nothing</span></div>
          <h2 className="pr-h2">You already paid<br />to open the lead.</h2>
          <p className="pr-sectionlead">
            Sending a lead to your CRM, putting it in a sequence, exporting it again next month:
            none of it spends a credit. The credit bought the lead, permanently.
          </p>
          <div className="pr-herobtns" style={{ justifyContent: "center", marginTop: 24 }}>
            <Link className="pr-btn accent" href="/signup">Start free <ArrowRight size={16} /></Link>
            <Link className="pr-btn ghost" href="/pricing">See pricing</Link>
          </div>
        </div>
      </Reveal>

      <MarketingFooter settings={settings} />
    </div>
  );
}
