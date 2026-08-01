import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getSiteSettings } from "@/lib/site-settings.server";
import { getUserOverview } from "@/lib/admin/users";
import { AdminShell } from "../../AdminShell";
import { UserDetail } from "./UserDetail";

export const dynamic = "force-dynamic";

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ email }, settings, { id }] = await Promise.all([
    requireAdmin(),
    getSiteSettings(),
    params,
  ]);

  const overview = await getUserOverview(id);
  if (!overview) notFound();

  return (
    <AdminShell email={email} settings={settings}>
      <div className="adm-page">
        <p className="adm-sub">
          <Link href="/admin/users">Users and plans</Link>
        </p>
        <h1>{overview.email ?? "Account"}</h1>
        <UserDetail overview={overview} />
      </div>
    </AdminShell>
  );
}
