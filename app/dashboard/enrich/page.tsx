import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/access";
import { requireSubscription } from "@/lib/require-subscription";
import { Upload } from "../../icons";
import { EnrichForm } from "./EnrichForm";

export const metadata: Metadata = { title: "Enrich a list", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EnrichPage() {
  await requireSubscription("enrich");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/enrich");
  const access = await getAccess(user.id);

  return (
    <div className="wrap">
      <div className="app-head">
        <span className="app-eyebrow"><Upload size={13} /> Enrich a list</span>
        <h1>Bring your own list.</h1>
        <p>
          Upload a spreadsheet of businesses and we fill in what is missing: verified phone and
          email, the owner where we can find one, and everything we know about their website.
          One credit per row we actually enrich.
        </p>
      </div>
      <EnrichForm credits={access.credits} />
    </div>
  );
}
