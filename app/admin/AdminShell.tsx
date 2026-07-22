import Link from "next/link";
import type { SiteSettings } from "@/lib/site-settings";
import { BrandMark } from "../brand";
import { AdminNav } from "./AdminNav";

// Sidebar + main shell for the guarded admin pages. Rendered per-page (not in the
// admin layout) so the /admin/login page can sit outside it, unshelled and unguarded.
export function AdminShell({
  email,
  settings,
  children,
}: {
  email: string;
  settings: SiteSettings;
  children: React.ReactNode;
}) {
  return (
    <div className="adm">
      <aside className="adm-side">
        <Link href="/admin" className="adm-brand">
          <span className="logo sm">
            <BrandMark settings={settings} size={22} />
          </span>
          <b>Admin</b>
        </Link>
        <AdminNav />
        <div className="adm-foot">
          <span className="adm-email">{email}</span>
          <Link href="/dashboard" className="toplink">View app →</Link>
          <form action="/api/admin/logout" method="post">
            <button className="ghost sm" type="submit">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="adm-main">{children}</main>
    </div>
  );
}
