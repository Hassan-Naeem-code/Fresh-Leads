import { ImageResponse } from "next/og";
import { getSiteSettings } from "@/lib/site-settings.server";

// Share card for every page that doesn't define its own. The metadata already
// declared twitter.card = "summary_large_image", but with no image to point at,
// links shared to Slack, iMessage or X rendered as a bare grey box.
//
// Drawn entirely in CSS so there is no binary asset to keep in sync with the
// brand: the name and palette come from the same site_settings row the live site
// theme reads, so rebranding in /admin/branding updates the share card too.
export const alt = "Fresh Leads, verified local business leads";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const s = await getSiteSettings();
  const sand = s.bg;
  const ink = s.text;
  const accent = s.accent;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: sand,
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Wordmark: concentric radar rings, the same idea as the site logo. */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 999,
              border: `6px solid ${accent}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ width: 18, height: 18, borderRadius: 999, background: accent }} />
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, color: ink }}>{s.brand_name}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 800, color: ink, lineHeight: 1.1, maxWidth: 900 }}>
            Local business leads, verified before you get them.
          </div>
          <div style={{ fontSize: 32, color: ink, opacity: 0.7, maxWidth: 880 }}>
            Every phone and email checked, every business confirmed open, every lead graded on the
            work they actually need.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ height: 8, width: 120, borderRadius: 999, background: accent }} />
          <div style={{ fontSize: 28, color: ink, opacity: 0.65 }}>fresh-leads.io</div>
        </div>
      </div>
    ),
    size
  );
}
