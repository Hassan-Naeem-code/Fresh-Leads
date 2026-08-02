import type { Metadata } from "next";
import Link from "next/link";
import { getSiteSettings } from "@/lib/site-settings.server";
import { currentEmail } from "@/lib/current-user";
import { ENDPOINTS, ERRORS, BASE_URL } from "@/lib/api-docs";
import { MarketingNav } from "../MarketingNav";
import { MarketingFooter } from "../MarketingFooter";
import { BreadcrumbSchema } from "../StructuredData";
import { Reveal } from "../Reveal";
import { Key, ArrowRight, Coin } from "../icons";

export const metadata: Metadata = {
  title: "API reference",
  description:
    "Search verified local business leads from your own code. Bearer token auth, one credit per lead opened, the same data and the same prices as the dashboard.",
  alternates: { canonical: "/docs" },
};

// The API reference, readable before anyone signs up.
//
// Deliberately public: a developer evaluating whether this fits their system should
// be able to read the whole surface without an account. Hiding documentation behind
// a signup form is how you lose the person who was going to integrate.
export default async function DocsPage() {
  const [settings, email] = await Promise.all([getSiteSettings(), currentEmail()]);

  return (
    <div>
      <BreadcrumbSchema trail={[{ name: "Home", path: "/" }, { name: "API", path: "/docs" }]} />
      <MarketingNav settings={settings} email={email} />

      <div className="pr-herowrap">
        <header className="pr pr-hero compact">
          <Reveal immediate className="pr-eyebrow">
            <span className="pill"><Key size={13} /> API</span>
          </Reveal>
          <Reveal immediate delay={80}>
            <h1 className="pr-h1">The same leads,<br /><span className="accent">from your own code.</span></h1>
          </Reveal>
          <Reveal immediate delay={160}>
            <p className="pr-lead">
              No separate plan, no extra charge, no different data. The API and the dashboard
              are the same code path, so a call can never return more than the same customer
              sees on screen, and a credit costs exactly what it costs anywhere else.
            </p>
          </Reveal>
        </header>
      </div>

      <section className="pr pr-section">
        <Reveal className="pr-eyebrow"><span className="pill">Getting started</span></Reveal>
        <Reveal><h2 className="pr-h2">Two minutes</h2></Reveal>
        <Reveal>
          <ol className="docsteps">
            <li><b>Sign up</b> and take the three free credits.</li>
            <li><b>Create a key</b> under API keys in the dashboard. It is shown once, then stored as a hash we cannot reverse.</li>
            <li><b>Send it as a bearer token</b> on every request.</li>
          </ol>
        </Reveal>
        <Reveal>
          <pre className="docpre"><code>{`curl -X POST ${BASE_URL}/api/v1/leads \\
  -H "Authorization: Bearer fl_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"niche":"dentists","location":"Austin, TX","limit":20}'`}</code></pre>
        </Reveal>
      </section>

      <section className="pr pr-section">
        <Reveal className="pr-eyebrow"><span className="pill">Endpoints</span></Reveal>
        <Reveal><h2 className="pr-h2">Everything you can call</h2></Reveal>

        {ENDPOINTS.map((e) => (
          <Reveal key={e.id}>
            <div className="docep" id={e.id}>
              <div className="docephead">
                <span className={`docmethod ${e.method.toLowerCase()}`}>{e.method}</span>
                <code>{e.path}</code>
              </div>
              <h3>{e.title}</h3>
              <p>{e.summary}</p>

              <div className="doccost"><Coin size={13} /> {e.cost}</div>

              {e.body && (
                <>
                  <span className="doclabel">Body</span>
                  <dl className="docparams">
                    {Object.entries(e.body).map(([k, v]) => (
                      <div key={k}>
                        <dt><code>{k}</code></dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}

              <span className="doclabel">Returns</span>
              <pre className="docpre small"><code>{e.response}</code></pre>

              {e.notes && (
                <ul className="docnotes">
                  {e.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}
            </div>
          </Reveal>
        ))}
      </section>

      <section className="pr pr-section">
        <Reveal className="pr-eyebrow"><span className="pill">When something goes wrong</span></Reveal>
        <Reveal><h2 className="pr-h2">Errors</h2></Reveal>
        <Reveal>
          <div className="cmpwrap">
            <table className="cmp">
              <thead>
                <tr><th scope="col">Response</th><th scope="col">What it means</th></tr>
              </thead>
              <tbody>
                {ERRORS.map((e) => (
                  <tr key={e.code}>
                    <th scope="row"><code>{e.code}</code></th>
                    <td><span>{e.meaning}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
        <Reveal>
          <p className="pr-sectionlead" style={{ marginTop: 22 }}>
            Every paid action is idempotent, so retrying a call that failed halfway cannot
            charge you twice. Opening the same lead again is free whether it is the second
            attempt or the fiftieth.
          </p>
        </Reveal>
      </section>

      <section className="pr pr-section pr-cta">
        <Reveal><h2 className="pr-h2">Build against it free</h2></Reveal>
        <Reveal>
          <p className="pr-sectionlead">
            Three credits, no card. Enough to search, open a lead and see the exact shape of
            what comes back before you write a line of integration.
          </p>
        </Reveal>
        <Reveal delay={120}>
          <div className="pr-herobtns" style={{ marginTop: 26 }}>
            <Link className="pr-btn accent" href="/signup">Get a key <ArrowRight size={16} /></Link>
            <Link className="pr-btn ghost" href="/pricing">See pricing</Link>
          </div>
        </Reveal>
      </section>

      <MarketingFooter settings={settings} />
    </div>
  );
}
