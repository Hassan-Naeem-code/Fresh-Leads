import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { PALETTE_KEYS } from "@/lib/site-settings";

export const runtime = "nodejs";

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const hex = z.string().regex(HEX, "Must be a hex color like #4f8cff");

// Palette fields + brand text. Logo arrives as a file (or a remove flag) in the
// same multipart request, handled separately below.
const Fields = z.object({
  brand_name: z.string().trim().min(1, "Brand name is required").max(60),
  tagline: z.string().trim().max(160),
  bg: hex, panel: hex, panel2: hex, border: hex, text: hex, muted: hex,
  accent: hex, accent2: hex, hot: hex, warm: hex, cool: hex,
});

export async function POST(req: NextRequest) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });

  const raw: Record<string, string> = { brand_name: "", tagline: "" };
  raw.brand_name = String(form.get("brand_name") ?? "");
  raw.tagline = String(form.get("tagline") ?? "");
  for (const k of PALETTE_KEYS) raw[k] = String(form.get(k) ?? "");

  const parsed = Fields.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: `${first?.path.join(".")}: ${first?.message}` },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Logo: upload a new file, keep the current URL, or clear it.
  let logo_url: string | null = (form.get("current_logo_url") as string) || null;
  if (form.get("remove_logo") === "1") {
    logo_url = null;
  }
  const file = form.get("logo");
  if (file instanceof File && file.size > 0) {
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Logo must be an image" }, { status: 400 });
    }
    if (file.size > 2_000_000) {
      return NextResponse.json({ error: "Logo must be under 2 MB" }, { status: 400 });
    }
    const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `logo.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: upErr } = await admin.storage
      .from("branding")
      .upload(path, buffer, { contentType: file.type, upsert: true });
    if (upErr) return NextResponse.json({ error: `Logo upload failed: ${upErr.message}` }, { status: 500 });
    const { data } = admin.storage.from("branding").getPublicUrl(path);
    // Cache-bust so a re-upload to the same path shows immediately.
    logo_url = `${data.publicUrl}?v=${Date.now()}`;
  }

  const { error } = await admin.from("site_settings").upsert({
    id: 1,
    ...parsed.data,
    logo_url,
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Push the new theme live across every page immediately.
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, logo_url });
}
