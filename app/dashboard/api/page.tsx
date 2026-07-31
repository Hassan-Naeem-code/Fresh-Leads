import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Key } from "../../icons";
import { ApiKeys } from "./ApiKeys";

export const metadata: Metadata = { title: "API keys", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ApiPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/api");

  return (
    <div className="wrap">
      <div className="app-head">
        <span className="app-eyebrow"><Key size={13} /> API</span>
        <h1>Call it from your own system.</h1>
        <p>
          The API returns the same leads as the dashboard and spends the same credits. No extra
          plan, no separate charge.
        </p>
      </div>
      <ApiKeys />
    </div>
  );
}
