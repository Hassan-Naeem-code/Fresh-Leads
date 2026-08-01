import type { Metadata } from "next";
import Link from "next/link";
import { getSiteSettings } from "@/lib/site-settings.server";
import { currentEmail } from "@/lib/current-user";
import { FAQ, FAQ_TOPICS } from "@/lib/faq";
import { MarketingNav } from "../MarketingNav";
import { MarketingFooter } from "../MarketingFooter";
import { FaqSchema, BreadcrumbSchema } from "../StructuredData";
import { Reveal } from "../Reveal";
import { ArrowRight } from "../icons";

export const metadata: Metadata = {
  title: "Questions and answers",
  description:
    "What a credit is, where the leads come from, what the grade means, what the yearly fee buys, and what happens when someone unsubscribes.",
  alternates: { canonical: "/faq" },
};

// The same answers the signed-in help centre uses, on a public page.
//
// One source, two surfaces: a customer reading it inside the product and a stranger
// finding it from a search are asking the same questions, and two copies would drift
// apart within a month. It is also the page most likely to earn a rich result, since
// the schema below is backed by the visible text beside it.
export default async function FaqPage() {
  const [settings, email] = await Promise.all([getSiteSettings(), currentEmail()]);
  const byTopic = FAQ_TOPICS.map((t) => ({
    ...t,
    items: FAQ.filter((f) => f.topic === t.id),
  })).filter((t) => t.items.length > 0);

  return (
    <div>
      <FaqSchema items={FAQ.map((f) => ({ q: f.q, a: f.a.join(" ") }))} />
      <BreadcrumbSchema trail={[{ name: "Home", path: "/" }, { name: "FAQ", path: "/faq" }]} />
      <MarketingNav settings={settings} email={email} />

      <div className="pr-herowrap">
        <header className="pr pr-hero compact">
          <Reveal immediate className="pr-eyebrow"><span className="pill">Questions</span></Reveal>
          <Reveal immediate delay={80}>
            <h1 className="pr-h1">Everything people<br /><span className="accent">actually ask.</span></h1>
          </Reveal>
          <Reveal immediate delay={160}>
            <p className="pr-lead">
              Including the awkward ones. If yours is not here, write to us and we will answer
              it, then add it.
            </p>
          </Reveal>
        </header>
      </div>

      {byTopic.map((topic) => (
        <section className="pr pr-section faqsection" key={topic.id}>
          <Reveal className="pr-eyebrow"><span className="pill">{topic.label}</span></Reveal>
          <Reveal>
            <div className="faqpublic">
              {topic.items.map((f) => (
                <details key={f.id} id={f.id}>
                  <summary>{f.q}</summary>
                  <div>
                    {f.a.map((p, i) => <p key={i}>{p}</p>)}
                  </div>
                </details>
              ))}
            </div>
          </Reveal>
        </section>
      ))}

      <Reveal as="section" className="pr pr-section">
        <div className="pr-dark" style={{ textAlign: "center" }}>
          <h2 className="pr-h2">Still not sure?</h2>
          <p className="pr-sectionlead">
            Start with three free credits and no card. If the leads are not real, you will know
            inside ten minutes and it will have cost you nothing.
          </p>
          <div className="pr-herobtns" style={{ justifyContent: "center", marginTop: 24 }}>
            <Link className="pr-btn accent" href="/signup">Get 3 free credits <ArrowRight size={16} /></Link>
            <Link className="pr-btn ghost" href="/contact">Ask us something</Link>
          </div>
        </div>
      </Reveal>

      <MarketingFooter settings={settings} />
    </div>
  );
}
