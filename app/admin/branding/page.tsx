import { requireAdmin } from "@/lib/admin/guard";
import { getSiteSettings } from "@/lib/site-settings.server";
import { AdminShell } from "../AdminShell";
import { BrandingForm } from "./BrandingForm";

export default async function AdminBrandingPage() {
  const { email } = await requireAdmin();
  const settings = await getSiteSettings();

  return (
    <AdminShell email={email} settings={settings}>
      <div className="adm-page">
        <h1>Branding</h1>
        <p className="adm-sub">
          Change the look of the whole site, colors, logo, and name. Publishing applies it live
          everywhere immediately.
        </p>
        <BrandingForm initial={settings} />
      </div>
    </AdminShell>
  );
}
