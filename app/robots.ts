import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

const BASE = siteUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Keep private/app/auth surfaces out of the index.
        disallow: ["/admin", "/dashboard", "/api", "/auth"],
      },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
