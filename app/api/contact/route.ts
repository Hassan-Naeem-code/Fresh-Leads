import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1, "Name is required").max(120),
  email: z.string().email("Enter a valid email").max(200),
  company: z.string().max(160).optional().default(""),
  message: z.string().min(10, "Tell us a little more").max(4000),
  // Honeypot, a hidden field real users never fill. Bots do.
  website: z.string().max(0).optional().default(""),
});

// Public contact form. Stores the message via the service-role client (the table
// has no anon RLS policies) so the browser never touches it directly.
export async function POST(req: NextRequest) {
  const limited = await guard("contact", clientIp(req), "messages");
  if (limited) return limited;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid form data" },
      { status: 400 }
    );
  }
  const { name, email, company, message, website } = parsed.data;

  // Honeypot tripped, pretend success so bots don't learn anything.
  if (website) return NextResponse.json({ ok: true });

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("contact_messages")
      .insert({ name, email, company: company || null, message });
    if (error) throw error;
  } catch (e) {
    console.error("[contact] insert failed:", e);
    return NextResponse.json(
      { error: "Could not send your message. Please try again or email us directly." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
