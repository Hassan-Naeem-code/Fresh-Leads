import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPreferences } from "@/lib/preferences";
import { getBuyerProfile } from "@/lib/buyer-profile";
import { PLAYBOOKS } from "@/lib/playbooks";
import { Sliders } from "../../icons";
import { PreferencesPanel } from "./PreferencesPanel";

export const metadata: Metadata = {
  title: "Personalisation",
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/preferences");

  const [preferences, profile] = await Promise.all([
    getPreferences(user.id),
    getBuyerProfile(user.id),
  ]);

  return (
    <div className="wrap">
      <div className="app-head">
        <span className="app-eyebrow">
          <Sliders size={13} /> Personalisation
        </span>
        <h1>Make it fit how you work.</h1>
        <p>
          What we call you, what a search starts with, and what you sell. The last one matters
          most: it decides which signals a business is scored on, so two people looking at the
          same restaurant correctly see different grades.
        </p>
      </div>

      <PreferencesPanel
        initialPreferences={preferences}
        initialProfile={profile}
        playbooks={PLAYBOOKS.map((p) => ({ id: p.id, label: p.label, blurb: p.blurb }))}
      />
    </div>
  );
}
