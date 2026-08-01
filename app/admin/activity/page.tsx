import Link from "next/link";
import { requireAdmin } from "@/lib/admin/guard";
import { getSiteSettings } from "@/lib/site-settings.server";
import { getPlatformFeed } from "@/lib/admin/users";
import { AdminShell } from "../AdminShell";

export const dynamic = "force-dynamic";

// Everything happening on the platform, newest first.
export default async function AdminActivityPage() {
  const [{ email }, settings, feed] = await Promise.all([
    requireAdmin(),
    getSiteSettings(),
    getPlatformFeed(200),
  ]);

  return (
    <AdminShell email={email} settings={settings}>
      <div className="adm-page">
        <h1>Activity</h1>
        <p className="adm-sub">
          The last {feed.events.length} things that happened, across every account. Searches,
          leads opened, money in and out, tickets, and anything an operator did.
        </p>

        {feed.events.length === 0 ? (
          <div className="adm-empty">Nothing yet.</div>
        ) : (
          <ul className="adm-feed">
            {feed.events.map((e, i) => (
              <li key={i} className={e.kind}>
                <span className="adm-feedwhen">{new Date(e.at).toLocaleString()}</span>
                <span className="adm-feedwho">
                  {e.userId ? (
                    <Link href={`/admin/users/${e.userId}`}>{e.email ?? "an account"}</Link>
                  ) : (
                    "system"
                  )}
                </span>
                <span className="adm-feedwhat">{e.summary}</span>
                {e.detail && <span className="adm-feeddetail">{e.detail}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AdminShell>
  );
}
