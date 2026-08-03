import type { Metadata } from "next";
import "./globals.css";
import { themeCss } from "@/lib/site-settings";
import { getSiteSettings } from "@/lib/site-settings.server";
import { OrganizationSchema, ProductSchema } from "./StructuredData";
import { siteUrl } from "@/lib/site-url";

// Title/description follow the live brand so a rename in /admin/branding shows in
// the browser tab and share cards too.
const SITE_URL = siteUrl();

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSiteSettings();
  const title = `${s.brand_name}, ${s.tagline}`;
  const description =
    "Tell us your ideal customer. We surface real local businesses, verify every email and phone, confirm they're open, and deliver only leads worth paying for.";
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: title, template: `%s · ${s.brand_name}` },
    description,
    applicationName: s.brand_name,
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      url: SITE_URL,
      siteName: s.brand_name,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: true, follow: true },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const settings = await getSiteSettings();
  return (
    <html lang="en">
      <head>
        {/* Inter (Primer uses Inter Display), loaded at runtime, no build-time fetch. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400;14..32,500;14..32,600;14..32,700;14..32,800&display=swap"
          rel="stylesheet"
        />
        {/* DB-driven palette overrides globals.css (html:root outspecifies :root). */}
        <style id="theme-overrides" dangerouslySetInnerHTML={{ __html: themeCss(settings) }} />
      </head>
      <body>
        <OrganizationSchema brand={settings.brand_name} />
        <ProductSchema brand={settings.brand_name} />
        {children}
      </body>
    </html>
  );
}
