import type { Metadata } from "next";
import Link from "next/link";
import { getSiteSettings } from "@/lib/site-settings.server";
import { currentEmail } from "@/lib/current-user";
import { MarketingNav } from "../MarketingNav";
import { MarketingFooter } from "../MarketingFooter";
import { BreadcrumbSchema } from "../StructuredData";
import { Reveal } from "../Reveal";
import { qualityReport, isPublishable, PUBLISHABLE_MIN_SAMPLE } from "@/lib/quality";
import { Gauge, Check, AlertTriangle, Clock, Shield } from "../icons";

export const metadata: Metadata = {
  title: "How accurate are we",
  description:
    "The measured accuracy of our leads, with the sample size next to it. We re-check a random sample of the leads customers actually paid for, and publish what we find, including when it is bad.",
  alternates: { canonical: "/accuracy" },
};

// THE PROOF PAGE.
//
// Every lead vendor says "verified". The word is free and means nothing, which is
// exactly why a buyer who has been burned before does not believe it. What they cannot
// dismiss is a percentage with a denominator next to it and a description of how it
// was measured.
//
// THREE RULES, and they are what make this worth having rather than another marketing
// page with a big number on it:
//
//   1. The number comes from a RANDOM sample of leads customers actually bought,
//      re-checked by us on a schedule. Not from customer complaints, which are biased
//      toward the worst experiences, and not from the leads we would have chosen.
//
//   2. It is published even when it is bad. A page that only appears on good months is
//      an advert. The value of this one is that it will still be here on a bad one.
//
//   3. Below a minimum sample it refuses to state a rate at all and says so. A
//      percentage computed from nine leads is noise, and a suspiciously round 100%
//      does more damage to trust than an honest "not enough data yet".
//
// Revalidated hourly rather than per request: the numbers move daily at most, and a
// marketing page should not run four database aggregates for every visitor.
export const revalidate = 3600;

function Stat({
  value, label, note,
}: { value: string; label: string; note?: string }) {
  return (
    <div className="acc-stat">
      <b>{value}</b>
      <span>{label}</span>
      {note && <small>{note}</small>}
    </div>
  );
}

export default async function AccuracyPage() {
  const [settings, email, q] = await Promise.all([
    getSiteSettings(),
    currentEmail(),
    qualityReport(30),
  ]);
  const publishable = isPublishable(q);
  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : "--");

  return (
    <div>
      <MarketingNav settings={settings} email={email} />
      <BreadcrumbSchema trail={[{ name: "Home", path: "/" }, { name: "Accuracy", path: "/accuracy" }]} />

      <header className="pr pr-hero" style={{ paddingBottom: 18 }}>
        <div className="pr-eyebrow"><span className="pill"><Gauge size={13} /> Measured, not claimed</span></div>
        <h1 className="pr-h1" style={{ fontSize: "clamp(30px,4.4vw,50px)" }}>
          How accurate <span className="accent">are we?</span>
        </h1>
        <p className="pr-lead">
          Every lead vendor says &ldquo;verified&rdquo;. Here is ours with the sample size next
          to it, measured the same way whether the answer flatters us or not.
        </p>
      </header>

      <section className="pr" style={{ paddingBottom: 30 }}>
        <Reveal>
          <div className="acc-headline">
            {publishable ? (
              <>
                <div className="acc-big">
                  <b>{q.sampleAccuracy}%</b>
                  <span>
                    of the leads we re-checked still passed the same verification that
                    let us sell them
                  </span>
                </div>
                <p className="acc-sub">
                  Across <b>{q.sampled.toLocaleString()}</b> randomly sampled leads that
                  customers actually paid for, re-checked in the last {q.days} days.
                </p>
              </>
            ) : (
              // The honest state, and the one this page will spend its first weeks in.
              <>
                <div className="acc-big pending">
                  <b>Not yet</b>
                  <span>We do not have enough re-checked leads to publish a rate</span>
                </div>
                <p className="acc-sub">
                  We have sampled <b>{q.sampled.toLocaleString()}</b> so far and will
                  publish a figure at {PUBLISHABLE_MIN_SAMPLE}. A percentage computed
                  from a handful of leads is noise, and we would rather show you nothing
                  than show you a number we cannot stand behind.
                </p>
              </>
            )}
          </div>
        </Reveal>

        {publishable && (
          <Reveal>
            <div className="acc-stats">
              <Stat
                value={pct(q.phoneOk, q.phoneChecked)}
                label="of phone numbers still valid"
                note={`${q.phoneChecked.toLocaleString()} numbers re-checked`}
              />
              <Stat
                value={pct(q.emailOk, q.emailChecked)}
                label="of email addresses still accepting mail"
                note={`${q.emailChecked.toLocaleString()} mailboxes re-checked`}
              />
              <Stat
                value={q.reportRate === null ? "--" : `${q.reportRate}%`}
                label="of leads sold were reported as wrong"
                note={`${q.reports.toLocaleString()} reports across ${q.unlocked.toLocaleString()} leads`}
              />
              <Stat
                value={q.creditsRefunded.toLocaleString()}
                label="credits refunded, no questions asked"
                note="Every reported lead, automatically"
              />
            </div>
          </Reveal>
        )}
      </section>

      <section className="pr" style={{ paddingBottom: 70 }}>
        <Reveal>
          <h2 className="pr-h2" style={{ fontSize: "clamp(22px,2.6vw,30px)" }}>
            How the number is produced
          </h2>
          <div className="acc-how">
            <div className="acc-step">
              <span className="pr-cardicon"><Shield size={20} /></span>
              <div>
                <b>We sample what we sold, at random</b>
                <p>
                  Every day a random sample is drawn from the leads customers actually
                  opened in the last 30 days, one entry per business. Not the newest, and
                  not the ones we would have picked: taking the freshest leads would
                  flatter every figure on this page.
                </p>
              </div>
            </div>
            <div className="acc-step">
              <span className="pr-cardicon"><Check size={20} /></span>
              <div>
                <b>We run the same check again</b>
                <p>
                  The same paid carrier and mailbox lookups that let us sell the lead in
                  the first place. The question is not whether the business exists, it is
                  whether the promise we made about it still holds.
                </p>
              </div>
            </div>
            <div className="acc-step">
              <span className="pr-cardicon"><AlertTriangle size={20} /></span>
              <div>
                <b>Customers can contradict us</b>
                <p>
                  A number can ring perfectly and still reach the wrong business, and no
                  automated check will ever catch that. So every customer can report a
                  lead in one click and the credit goes straight back. Those reports are
                  counted here too, separately, because they are biased toward bad
                  experiences and mixing them into the headline would be dishonest in
                  our favour.
                </p>
              </div>
            </div>
            <div className="acc-step">
              <span className="pr-cardicon"><Clock size={20} /></span>
              <div>
                <b>It updates whether or not we like it</b>
                <p>
                  This page reads the same table the sampling writes to. There is no step
                  where somebody approves the figure before you see it, which is the only
                  reason it is worth reading.
                </p>
              </div>
            </div>
          </div>
        </Reveal>

        {q.byReason.length > 0 && (
          <Reveal>
            <h2 className="pr-h2" style={{ fontSize: "clamp(20px,2.2vw,26px)", marginTop: 44 }}>
              What customers told us we got wrong
            </h2>
            <p className="pr-lead" style={{ marginBottom: 18 }}>
              The last {q.days} days, by reason. Published because a list of our own
              faults is worth more to you than another adjective.
            </p>
            <div className="acc-reasons">
              {q.byReason.map((r) => (
                <div className="acc-reason" key={r.id}>
                  <b>{r.count}</b>
                  <span>{r.label}</span>
                </div>
              ))}
            </div>
          </Reveal>
        )}

        <Reveal>
          <div className="acc-cta">
            <b>You are never charged for a lead we cannot verify.</b>
            <p>
              That is enforced twice: before the charge, when we re-check the phone and
              mailbox live and hand the lead back free if both are dead, and afterwards,
              with a one-click report that refunds the credit without an argument.
            </p>
            <Link href="/signup" className="pr-btn primary">Start with 3 free credits</Link>
          </div>
        </Reveal>
      </section>

      <MarketingFooter settings={settings} />
    </div>
  );
}
