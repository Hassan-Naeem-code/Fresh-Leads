import type { MetadataRoute } from "next";
import { LANDINGS } from "@/lib/landing";
import { siteUrl } from "@/lib/site-url";

const BASE = siteUrl();

// Every page we WANT indexed, and only those: anything covered by a disallow rule
// in robots.ts must not appear here. /login is deliberately absent, it has no
// search value and pointing crawlers at it only spends crawl budget.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages: { path: string; priority: number; changeFrequency: "monthly" | "weekly" }[] = [
    { path: "", priority: 1, changeFrequency: "weekly" },
    // The money pages. These were missing entirely, so /pricing, the page built to
    // convert, was not in the sitemap at all.
    { path: "/pricing", priority: 0.9, changeFrequency: "weekly" },
    { path: "/signup", priority: 0.8, changeFrequency: "monthly" },
    // Pages that answer a question somebody typed into a search engine, which is
    // where most of the non-branded traffic will come from.
    { path: "/compare", priority: 0.8, changeFrequency: "monthly" },
    { path: "/integrations", priority: 0.7, changeFrequency: "monthly" },
    { path: "/faq", priority: 0.7, changeFrequency: "monthly" },
    { path: "/docs", priority: 0.7, changeFrequency: "monthly" },
    { path: "/security", priority: 0.6, changeFrequency: "monthly" },
    { path: "/about", priority: 0.6, changeFrequency: "monthly" },
    { path: "/contact", priority: 0.6, changeFrequency: "monthly" },
    { path: "/privacy", priority: 0.3, changeFrequency: "monthly" },
    { path: "/terms", priority: 0.3, changeFrequency: "monthly" },
  ];
  // One page per kind of seller. These are the pages that answer a job somebody
  // typed into a search engine, which is where non-branded traffic comes from.
  for (const l of LANDINGS) {
    pages.push({ path: `/for/${l.slug}`, priority: 0.7, changeFrequency: "monthly" });
  }

  return pages.map((p) => ({
    url: `${BASE}${p.path}`,
    lastModified: now,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
