import { requireAdmin } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteSettings } from "@/lib/site-settings.server";
import { AdminShell } from "../AdminShell";
import { MessagesList, type ContactMessage } from "./MessagesList";

export default async function AdminMessagesPage() {
  const { email } = await requireAdmin();
  const settings = await getSiteSettings();
  const admin = createAdminClient();

  const { data } = await admin
    .from("contact_messages")
    .select("id, name, email, company, message, handled, created_at")
    .order("created_at", { ascending: false });

  const messages = (data ?? []) as ContactMessage[];
  const openCount = messages.filter((m) => !m.handled).length;

  return (
    <AdminShell email={email} settings={settings}>
      <div className="adm-page">
        <h1>Messages</h1>
        <p className="adm-sub">
          {messages.length === 0
            ? "No messages yet. Submissions from the public contact form will show up here."
            : `${messages.length} message${messages.length === 1 ? "" : "s"}${
                openCount ? ` · ${openCount} unhandled` : " · all handled"
              }.`}
        </p>
        <MessagesList messages={messages} />
      </div>
    </AdminShell>
  );
}
