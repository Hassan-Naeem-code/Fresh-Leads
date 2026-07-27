import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const Body = z.object({
  id: z.string().uuid(),
  action: z.enum(["toggle", "delete"]),
});

// Admin actions on a contact message: flip its handled flag, or delete it.
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi();
  if ("error" in auth) return auth.error;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { id, action } = parsed.data;

  const admin = createAdminClient();

  if (action === "delete") {
    const { error } = await admin.from("contact_messages").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // toggle: read current handled, flip it
  const { data: row } = await admin
    .from("contact_messages")
    .select("handled")
    .eq("id", id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { error } = await admin
    .from("contact_messages")
    .update({ handled: !row.handled })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, handled: !row.handled });
}
