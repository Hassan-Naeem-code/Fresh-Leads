import type { MetadataRoute } from "next";

const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://fresh-leads.io";

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
    { path: "/about", priority: 0.6, changeFrequency: "monthly" },
    { path: "/contact", priority: 0.6, changeFrequency: "monthly" },
    { path: "/privacy", priority: 0.3, changeFrequency: "monthly" },
    { path: "/terms", priority: 0.3, changeFrequency: "monthly" },
  ];
  return pages.map((p) => ({
    url: `${BASE}${p.path}`,
    lastModified: now,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
