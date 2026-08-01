import { requireAdmin } from "@/lib/admin/guard";
import { getSiteSettings } from "@/lib/site-settings.server";
import { getPlatformFeed } from "@/lib/admin/users";
import { AdminShell } from "../AdminShell";
import { Empty } from "../Empty";
import { FeedList } from "../FeedList";
import { Clock } from "../../icons";

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
          {feed.events.length === 1
            ? "One thing has happened so far."
            : `The last ${feed.events.length} things that happened, across every account.`}{" "}
          Searches, leads opened, money in and out, tickets, and anything an operator did.
        </p>

        {feed.events.length === 0 ? (
          <Empty
            icon={<Clock size={22} />}
            title="Nothing has happened yet"
            hint="Signups, searches, leads opened and payments all appear here as they occur."
          />
        ) : (
          <div className="adm-panel feedpanel">
            <FeedList items={feed.events} showWho />
          </div>
        )}
      </div>
    </AdminShell>
  );
}
