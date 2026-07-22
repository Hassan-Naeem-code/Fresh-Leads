import { requireAdmin } from "@/lib/admin/guard";
import { getSiteSettings } from "@/lib/site-settings.server";
import { AdminShell } from "../AdminShell";
import { PasswordForm } from "./PasswordForm";

export default async function AdminAccountPage() {
  const { email } = await requireAdmin();
  const settings = await getSiteSettings();

  return (
    <AdminShell email={email} settings={settings}>
      <div className="adm-page">
        <h1>Account</h1>
        <p className="adm-sub">
          Signed in as <b>{email}</b>. Change the admin password below, it takes effect
          immediately and replaces the initial password.
        </p>
        <PasswordForm />
      </div>
    </AdminShell>
  );
}
