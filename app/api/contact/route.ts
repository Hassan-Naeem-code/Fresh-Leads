import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { guard, clientIp } from "@/lib/rate-limit";
import { notifyOperatorOfMessage } from "@/lib/email/notify";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1, "Name is required").max(120),
  email: z.string().email("Enter a valid email").max(200),
  company: z.string().max(160).optional().default(""),
  message: z.string().min(10, "Tell us a little more").max(4000),
  // Honeypot, a hidden field real users never fill. Bots do.
  //
  // NOT max(0). That rejected the trap at validation with "Enter a valid email", so the
  // pretend-success below was unreachable and a bot learned which field caught it. It
  // would also have shown a nonsense error to any real person whose password manager
  // decided to fill a field called "website".
  website: z.string().max(200).optional().default(""),
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

  // Told, not just stored. The page promises a real person replies within one business
  // day, and until now that promise was kept only by remembering to check a table.
  // Awaited rather than fired and forgotten, because work left running after the
  // response returns is killed on serverless. Its failure is swallowed: the message is
  // already saved, and refusing a form somebody filled in because our mail server is
  // having a bad minute would lose the enquiry entirely.
  await notifyOperatorOfMessage({ name, email, company: company || "", message });

  return NextResponse.json({ ok: true });
}
