import { requireAdmin } from "@/lib/admin/guard";
import { getSiteSettings } from "@/lib/site-settings.server";
import { qualityReport, reliabilityReport, isPublishable, PUBLISHABLE_MIN_SAMPLE } from "@/lib/quality";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminShell } from "../AdminShell";
import { Empty } from "../Empty";
import { Gauge } from "../../icons";

export const dynamic = "force-dynamic";

// WHAT WE ARE GETTING WRONG, for the people who can fix it.
//
// The public page at /accuracy shows the sampled number and nothing else, because that
// is the only unbiased figure and a marketing page should not be a bug tracker. This
// one shows the reports too, with the free text attached, because the reports are
// where the ACTIONABLE failures are: an automated re-check will never discover that a
// number rings the wrong business, and a customer typing "this is a nail salon, not a
// dentist" is telling us something no sampling run can.
//
// The two are shown side by side deliberately. When the sampled rate looks healthy and
// the report rate does not, the gap IS the finding: it means our checks are passing
// leads that customers can tell are wrong.
export default async function AdminQualityPage() {
  const [{ email }, settings, month, week, rel] = await Promise.all([
    requireAdmin(),
    getSiteSettings(),
    qualityReport(30),
    qualityReport(7),
    reliabilityReport(7),
  ]);

  // The free text, which is the part worth reading rather than counting.
  const admin = createAdminClient();
  const { data: recent } = await admin
    .from("lead_reports")
    .select("lead_key, reason, detail, refunded_credits, created_at")
    .order("created_at", { ascending: false })
    .limit(40);

  const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : "--");

  return (
    <AdminShell email={email} settings={settings}>
      <div className="adm-page">
        <h1>Quality</h1>
        <p className="adm-sub">
          What we actually deliver, measured two ways: a random re-check of leads
          customers paid for, and what those customers told us was wrong. The public
          page at <code>/accuracy</code> publishes the first once{" "}
          {PUBLISHABLE_MIN_SAMPLE} leads have been sampled.
        </p>

        <div className="adm-stats">
          <div className="adm-stat">
            <b>{month.sampleAccuracy === null ? "--" : `${month.sampleAccuracy}%`}</b>
            <span>Sampled accuracy, 30 days</span>
            <small>
              {month.sampleHeld} of {month.sampled} held up
              {isPublishable(month) ? " · published" : ` · needs ${PUBLISHABLE_MIN_SAMPLE}`}
            </small>
          </div>
          <div className="adm-stat">
            <b>{week.sampleAccuracy === null ? "--" : `${week.sampleAccuracy}%`}</b>
            <span>Sampled accuracy, 7 days</span>
            <small>{week.sampled} sampled this week</small>
          </div>
          <div className="adm-stat">
            <b>{month.reportRate === null ? "--" : `${month.reportRate}%`}</b>
            <span>Reported wrong, 30 days</span>
            <small>{month.reports} reports across {month.unlocked} leads sold</small>
          </div>
          <div className="adm-stat">
            <b>{month.creditsRefunded}</b>
            <span>Credits refunded, 30 days</span>
            <small>{month.verificationReports} were verification failures</small>
          </div>
          <div className="adm-stat">
            <b>{pct(month.phoneOk, month.phoneChecked)}</b>
            <span>Phones still valid</span>
            <small>{month.phoneChecked} re-checked</small>
          </div>
          <div className="adm-stat">
            <b>{pct(month.emailOk, month.emailChecked)}</b>
            <span>Mailboxes still live</span>
            <small>{month.emailChecked} re-checked</small>
          </div>
        </div>

        <h2 className="adm-h2">Search reliability, last 7 days</h2>
        <div className="adm-stats">
          <div className="adm-stat">
            <b>{rel.p95Ms === null ? "--" : `${(rel.p95Ms / 1000).toFixed(1)}s`}</b>
            <span>p95 search time</span>
            <small>
              median {rel.medianMs === null ? "--" : `${(rel.medianMs / 1000).toFixed(1)}s`} ·{" "}
              {rel.searches} searches
            </small>
          </div>
          <div className="adm-stat">
            <b>{rel.zeroRate === null ? "--" : `${rel.zeroRate}%`}</b>
            <span>returned nothing</span>
            <small>{rel.zero} empty searches</small>
          </div>
          <div className="adm-stat">
            <b>{rel.degradedRate === null ? "--" : `${rel.degradedRate}%`}</b>
            <span>degraded to finish in time</span>
            <small>{rel.degraded} skipped some website audits</small>
          </div>
          <div className="adm-stat">
            <b>{rel.overBudget}</b>
            <span>ran past the 30s budget</span>
            <small>These are the ones users experience as broken</small>
          </div>
        </div>

        {rel.worstQueries.length > 0 && (
          <>
            <h2 className="adm-h2">Queries that came back empty</h2>
            {/* The actionable half. A niche that reliably finds nothing is either
                missing from the catalogue in lib/niche.ts or is being asked for where
                none exist, and only the list tells you which. */}
            <div className="acc-reasons">
              {rel.worstQueries.map((w) => (
                <div className="acc-reason" key={w.query}>
                  <b>{w.zero}</b>
                  <span>{w.query}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {month.byReason.length > 0 && (
          <>
            <h2 className="adm-h2">Why customers said leads were wrong</h2>
            <div className="acc-reasons">
              {month.byReason.map((r) => (
                <div className="acc-reason" key={r.id}>
                  <b>{r.count}</b>
                  <span>{r.label}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <h2 className="adm-h2">Recent reports</h2>
        {!recent?.length ? (
          <Empty
            icon={<Gauge size={20} />}
            title="No reports yet"
            hint="Nobody has told us a lead was wrong. That is either very good news or a sign the report button is not being found."
          />
        ) : (
          <div className="adm-msgs">
            {recent.map((r, i) => (
              <div className="adm-msg-card" key={i}>
                <div className="adm-msg-top">
                  <div className="adm-msg-who">
                    <b>{String(r.reason).replace(/_/g, " ")}</b>
                    <span className="adm-msg-co">{String(r.lead_key)}</span>
                  </div>
                  <div className="adm-msg-meta">
                    <span className="adm-msg-time">
                      {(r.refunded_credits as number) > 0
                        ? `${r.refunded_credits} refunded`
                        : "not charged"}
                    </span>
                    <span className="adm-msg-time">
                      {new Date(r.created_at as string).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                {/* The free text is the whole reason this list exists rather than
                    another bar chart: it is the only place a customer explains a
                    failure our own checks could never have detected. */}
                {r.detail ? <div className="adm-msg-body">{String(r.detail)}</div> : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
