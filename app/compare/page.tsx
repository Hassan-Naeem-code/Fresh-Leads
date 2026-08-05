import type { Metadata } from "next";
import Link from "next/link";
import { getSiteSettings } from "@/lib/site-settings.server";
import { currentEmail } from "@/lib/current-user";
import { MarketingNav } from "../MarketingNav";
import { MarketingFooter } from "../MarketingFooter";
import { BreadcrumbSchema } from "../StructuredData";
import { Reveal } from "../Reveal";
import { Check, X, ArrowRight, AlertTriangle } from "../icons";

export const metadata: Metadata = {
  title: "How we compare",
  description:
    "An honest comparison against the big contact databases: where Fresh Leads is better for local business prospecting, and where it is genuinely not the right tool.",
  alternates: { canonical: "/compare" },
};

// The comparison page, written honestly on purpose.
//
// Every competitor has one of these and they are all the same: a table where the
// author wins every row. Nobody believes them. A comparison that names the cases
// where we are the wrong choice is the only kind that reads as trustworthy, and it
// pre-qualifies people out of a trial they were going to abandon anyway.
//
// NAMED COLUMNS, because one merged "large contact databases" column was doing the
// oldest trick in the genre: comparing against an average nobody sells. Apollo and
// OpenMart are different products that beat us at different things, and saying so is
// the only version of this page a reader can check.
//
// What goes in their columns is what they publish about themselves, described plainly.
// No prices for them and no numbers we have not seen: the moment this page overstates
// a rival it stops being evidence and becomes marketing, and the whole value of it is
// that it does not read like marketing. Ours are measured, and the ones that took a
// measurement carry it.
type Row = {
  feature: string;
  us: string;
  apollo: string;
  openmart: string;
  /** Whether we are the better answer on this row. Drives the tick and the styling. */
  usWins: boolean;
};

const ROWS: Row[] = [
  {
    feature: "Who it is built for",
    us: "Local businesses, one town at a time",
    apollo: "Companies with org charts, worldwide",
    openmart: "Local businesses, AI qualified",
    usWins: true,
  },
  {
    feature: "When the phone number was checked",
    us: "At the moment you search, 99% present",
    apollo: "Whenever the record was last built",
    openmart: "Whenever the record was last built",
    usWins: true,
  },
  {
    feature: "Their website checked while you wait",
    us: "96% of leads, 95% confirmed reachable",
    apollo: "Not checked",
    openmart: "Partly",
    usWins: true,
  },
  {
    feature: "Confirmed still trading",
    us: "Yes, before you are charged",
    apollo: "Not checked",
    openmart: "Not checked",
    usWins: true,
  },
  {
    feature: "Tells you what changed since last month",
    us: "Yes, and it is scored",
    apollo: "No",
    openmart: "No",
    usWins: true,
  },
  {
    feature: "Says when the lead was last verified",
    us: "On every lead",
    apollo: "No",
    openmart: "No",
    usWins: true,
  },
  {
    feature: "Flags a business that is hiring",
    us: "Yes, and it is scored",
    apollo: "Job postings on larger companies",
    openmart: "No",
    usWins: true,
  },
  {
    feature: "Graded against what you personally sell",
    us: "Yes, five playbooks",
    apollo: "Generic firmographics",
    openmart: "Fit score",
    usWins: true,
  },
  {
    feature: "Pay only for the leads you open",
    us: "One credit each, yours permanently",
    apollo: "Seat licence",
    openmart: "Subscription",
    usWins: true,
  },
  {
    feature: "Named decision makers with job titles",
    us: "Owner name where findable, no titles",
    apollo: "Hundreds of millions, with titles",
    openmart: "Limited",
    usWins: false,
  },
  {
    feature: "Direct dials for named individuals",
    us: "No",
    apollo: "Yes",
    openmart: "No",
    usWins: false,
  },
  {
    feature: "Employee count, revenue, funding",
    us: "Estimated from public signals",
    apollo: "Detailed",
    openmart: "Some",
    usWins: false,
  },
  {
    feature: "Volume per search",
    us: "Tens, paged",
    apollo: "Thousands",
    openmart: "Hundreds",
    usWins: false,
  },
  {
    feature: "Enterprise and mid market coverage",
    us: "Local businesses only",
    apollo: "Global",
    openmart: "Local businesses only",
    usWins: false,
  },
];

export default async function ComparePage() {
  const [settings, email] = await Promise.all([getSiteSettings(), currentEmail()]);

  return (
    <div>
      <BreadcrumbSchema trail={[{ name: "Home", path: "/" }, { name: "Compare", path: "/compare" }]} />
      <MarketingNav settings={settings} email={email} />

      <div className="pr-herowrap">
        <header className="pr pr-hero compact">
          <Reveal immediate className="pr-eyebrow"><span className="pill">Comparison</span></Reveal>
          <Reveal immediate delay={80}>
            <h1 className="pr-h1">Where we win, and<br /><span className="accent">where we do not.</span></h1>
          </Reveal>
          <Reveal immediate delay={160}>
            <p className="pr-lead">
              The big contact databases are good products. They are built for selling to
              companies with org charts. We are built for selling to the plumber, the dentist
              and the restaurant on the high street, and the difference shows up in both
              directions.
            </p>
          </Reveal>
        </header>
      </div>

      <section className="pr pr-section">
        <Reveal>
          <div className="cmpwrap">
            <table className="cmp">
              <thead>
                <tr>
                  <th scope="col">What matters</th>
                  <th scope="col">Fresh Leads</th>
                  <th scope="col">Apollo</th>
                  <th scope="col">OpenMart</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.feature} className={r.usWins ? "" : "loses"}>
                    <th scope="row">{r.feature}</th>
                    <td>
                      {r.usWins ? <Check size={14} className="i-cool" /> : <X size={14} className="i-hot" />}
                      <span>{r.us}</span>
                    </td>
                    <td><span>{r.apollo}</span></td>
                    <td><span>{r.openmart}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
        <Reveal delay={80}>
          <p className="muted sm cmpnote">
            Our figures are measured on our own results and dated in the open. Theirs
            describe what each product publishes about itself and will drift as they
            ship; if we have a column wrong, tell us and we will correct it here.
          </p>
        </Reveal>
      </section>

      <Reveal as="section" className="pr pr-section">
        <div className="pr-dark">
          <div className="pr-eyebrow"><span className="pill"><AlertTriangle size={13} /> Do not buy this if</span></div>
          <h2 className="pr-h2">We are the wrong tool<br />for some jobs.</h2>
          <ul className="seclist">
            <li>
              <X size={16} /> You sell to companies with hundreds of staff and need a named VP
              with a direct dial. Buy a contact database instead; we will not pretend.
            </li>
            <li>
              <X size={16} /> You need tens of thousands of records a year. Above roughly a
              thousand leads a year, a seat licence is cheaper than a dollar each.
            </li>
            <li>
              <X size={16} /> You want intent data on enterprise accounts. Ours is about small
              businesses changing their own websites, which is a different thing entirely.
            </li>
          </ul>
        </div>
      </Reveal>

      <section className="pr pr-section pr-cta">
        <Reveal><h2 className="pr-h2">Still the right fit?</h2></Reveal>
        <Reveal>
          <p className="pr-sectionlead">
            Three free credits, no card. Open three leads and call them. That is a faster
            answer than any comparison table, including this one.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <div className="pr-herobtns" style={{ marginTop: 26 }}>
            <Link className="pr-btn accent" href="/signup">Try it free <ArrowRight size={16} /></Link>
            <Link className="pr-btn ghost" href="/pricing">See pricing</Link>
          </div>
        </Reveal>
      </section>

      <MarketingFooter settings={settings} />
    </div>
  );
}
