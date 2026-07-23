import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_SETTINGS, SETTINGS_SELECT_COLS, type SiteSettings } from "./site-settings";

// Server-only reader for the live theme/brand. Kept apart from site-settings.ts
// so client components can import the types/constants without pulling in the
// Supabase server client (which uses next/headers).
export async function getSiteSettings(): Promise<SiteSettings> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("site_settings")
      .select(SETTINGS_SELECT_COLS)
      .eq("id", 1)
      .maybeSingle();
    if (!data) return DEFAULT_SETTINGS;

    // Merge over defaults, treating null/empty as "unset" so nothing renders blank.
    const merged = { ...DEFAULT_SETTINGS } as SiteSettings;
    for (const [k, v] of Object.entries(data)) {
      if (k === "logo_url") {
        merged.logo_url = (v as string) || null;
      } else if (v !== null && v !== undefined && v !== "") {
        (merged as Record<string, unknown>)[k] = v;
      }
    }
    return merged;
  } catch {
    // Supabase not configured / table missing -> render with defaults.
    return DEFAULT_SETTINGS;
  }
}
