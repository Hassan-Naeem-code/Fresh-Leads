import { FreshLeadsMark } from "./icons";
import type { SiteSettings } from "@/lib/site-settings";

// Brand name, reads the live value so a rename in /admin/branding propagates
// everywhere the component is used.
export function BrandName({ settings }: { settings: SiteSettings }) {
  return <>{settings.brand_name}</>;
}

// Brand mark, renders the uploaded logo when one is set, otherwise falls back
// to the built-in inline SVG so the site always has a mark.
export function BrandMark({
  settings,
  size = 22,
}: {
  settings: SiteSettings;
  size?: number;
}) {
  if (settings.logo_url) {
    // eslint-disable-next-line @next/next/no-img-element -- remote logo, arbitrary host; avoids next/image domain config
    return (
      <img
        src={settings.logo_url}
        alt={settings.brand_name}
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: "contain", display: "block" }}
      />
    );
  }
  return <FreshLeadsMark size={size} />;
}
