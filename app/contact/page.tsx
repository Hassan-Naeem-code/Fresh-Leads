import type { Metadata } from "next";
import { getSiteSettings } from "@/lib/site-settings.server";
import { currentEmail } from "@/lib/current-user";
import { MarketingNav } from "../MarketingNav";
import { MarketingFooter } from "../MarketingFooter";
import { ContactForm } from "./ContactForm";
import { Mail, Clock, Gauge } from "../icons";

export const metadata: Metadata = {
  title: "Contact",
  description: "Questions about verified leads, pricing, or a custom plan? Get in touch.",
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "Contact",
    description: "Questions about verified leads, pricing, or a custom plan? Get in touch.",
    url: "/contact",
  },
};

export default async function ContactPage() {
  const [settings, email] = await Promise.all([getSiteSettings(), currentEmail()]);
  const brand = settings.brand_name;
  return (
    <div>
      <MarketingNav settings={settings} email={email} />

      <header className="pr pr-hero" style={{ paddingBottom: 20 }}>
        <div className="pr-eyebrow"><span className="pill"><Mail size={13} /> Get in touch</span></div>
        <h1 className="pr-h1" style={{ fontSize: "clamp(32px,4.6vw,54px)" }}>
          Let&rsquo;s talk <span className="accent">leads.</span>
        </h1>
        <p className="pr-lead">
          Questions about a plan, a custom volume, or how our verification works? Send a note and a real
          person on the {brand} team will reply within one business day.
        </p>
      </header>

      <section className="pr" style={{ paddingBottom: 60 }}>
        <div className="contact-grid">
          <div className="contact-side">
            <div className="contact-point">
              <div className="pr-cardicon"><Mail size={20} /></div>
              <div>
                <b>Email us</b>
                <p>Prefer email? Reach us at <a href="mailto:info@fresh-leads.io">info@fresh-leads.io</a> and we&rsquo;ll route it to the right person.</p>
              </div>
            </div>
            <div className="contact-point">
              <div className="pr-cardicon"><Clock size={20} /></div>
              <div>
                <b>Response time</b>
                <p>We answer every message within one business day, usually much sooner.</p>
              </div>
            </div>
            <div className="contact-point">
              <div className="pr-cardicon"><Gauge size={20} /></div>
              <div>
                <b>Want a quote instead?</b>
                <p>Skip the back-and-forth, <a href="/signup">build a custom quote</a> in a couple of minutes.</p>
              </div>
            </div>
          </div>

          <ContactForm />
        </div>
      </section>

      <MarketingFooter settings={settings} />
    </div>
  );
}
