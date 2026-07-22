import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminApi } from "@/lib/admin/guard";
import { changeAdminPassword } from "@/lib/admin/accounts";

export const runtime = "nodejs";

const Schema = z.object({
  current: z.string().min(1, "Enter your current password"),
  next: z.string().min(8, "New password must be at least 8 characters"),
});

export async function POST(req: NextRequest) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = await req.json().catch(() => null);
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const result = await changeAdminPassword(gate.email, parsed.data.current, parsed.data.next);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
