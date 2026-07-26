import Link from "next/link";
import { getSiteSettings } from "@/lib/site-settings.server";
import { MarketingNav } from "./MarketingNav";
import { MarketingFooter } from "./MarketingFooter";
import { ArrowRight } from "./icons";

export default async function NotFound() {
  const settings = await getSiteSettings();
  return (
    <div>
      <MarketingNav settings={settings} />
      <section className="pr pr-hero" style={{ textAlign: "center", padding: "80px 0 60px" }}>
        <div className="pr-eyebrow"><span className="pill">404</span></div>
        <h1 className="pr-h1" style={{ fontSize: "clamp(36px,6vw,64px)" }}>
          This page is a <span className="accent">dead end.</span>
        </h1>
        <p className="pr-lead">
          Ironic, for a company built on never sending you one. The page you&rsquo;re after doesn&rsquo;t
          exist or has moved.
        </p>
        <div className="pr-herobtns" style={{ marginTop: 28 }}>
          <Link href="/" className="pr-btn accent">Back home <ArrowRight size={16} /></Link>
          <Link href="/pricing" className="pr-btn ghost">See pricing</Link>
        </div>
      </section>
      <MarketingFooter settings={settings} />
    </div>
  );
}
