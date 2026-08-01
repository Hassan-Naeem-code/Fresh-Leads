import { requireAdmin } from "@/lib/admin/guard";
import { getSiteSettings } from "@/lib/site-settings.server";
import { listAllTickets } from "@/lib/support";
import { AdminShell } from "../AdminShell";
import { TicketQueue } from "./TicketQueue";

export const dynamic = "force-dynamic";

// The support queue, oldest activity first: the person who has been waiting longest is
// the one to answer next.
export default async function AdminTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [{ email }, settings, params] = await Promise.all([
    requireAdmin(),
    getSiteSettings(),
    searchParams,
  ]);
  const includeClosed = params.closed === "1";
  const tickets = await listAllTickets(includeClosed);
  const waiting = tickets.filter((t) => t.status === "open").length;

  return (
    <AdminShell email={email} settings={settings}>
      <div className="adm-page">
        <h1>Support</h1>
        <p className="adm-sub">
          Questions customers have asked from inside their account. Oldest activity first,
          so the person who has been waiting longest is the one to answer next.
          {tickets.length > 0 &&
            ` ${tickets.length} ticket${tickets.length === 1 ? "" : "s"}${
              waiting ? `, ${waiting} waiting on a reply` : ", none waiting on us"
            }.`}
        </p>
        <TicketQueue tickets={tickets} includeClosed={includeClosed} />
      </div>
    </AdminShell>
  );
}
