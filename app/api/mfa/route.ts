import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import QRCode from "qrcode";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentIdentity } from "@/lib/mfa/owner";
import type { Owner } from "@/lib/mfa/store";
import {
  listFactors, beginTotp, beginSms, beginEmail, confirmFactor, removeFactor,
  answerTotp, answerChallenge, createChallenge, generateCode,
  issueRecoveryCodes, countRecoveryCodes, useRecoveryCode,
  savePasskey, getPasskey, bumpSignCount, passkeyCredentialIds,
  createPasskeyChallenge, consumePasskeyChallenge,
} from "@/lib/mfa/store";
import {
  newChallenge, hashChallenge, relyingPartyId, verifyRegistration, verifyAssertion,
} from "@/lib/mfa/passkey";
import { generateSecret, otpauthUri } from "@/lib/mfa/totp";
import {
  sendEmailCode, sendSmsCode, emailCodesAvailable, smsCodesAvailable, maskEmail, maskPhone,
} from "@/lib/mfa/deliver";
import { MFA_COOKIE, MFA_ADMIN_COOKIE, mint, cookieOptions, SESSION_TTL_MS, TRUSTED_TTL_MS } from "@/lib/mfa/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Setting up and using a second factor.
//
// Enrolment and verification share this route because they share a rule: the person
// has to already be signed in with a password. Two factor is a second check on an
// identity, never a way to establish one, so nothing here will hand out a session.

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start_totp"), label: z.string().max(60).optional() }),
  z.object({ action: z.literal("start_sms"), phone: z.string().min(6).max(20) }),
  z.object({ action: z.literal("start_email") }),
  z.object({ action: z.literal("send_code"), factorId: z.string().uuid() }),
  z.object({ action: z.literal("confirm"), factorId: z.string().uuid(), code: z.string().min(4).max(10), challengeId: z.string().uuid().optional() }),
  z.object({ action: z.literal("verify"), factorId: z.string().uuid(), code: z.string().min(4).max(10), challengeId: z.string().uuid().optional(), trust: z.boolean().optional() }),
  z.object({ action: z.literal("recovery"), code: z.string().min(4).max(20) }),
  z.object({ action: z.literal("new_recovery_codes") }),
  z.object({ action: z.literal("remove"), factorId: z.string().uuid() }),
  z.object({ action: z.literal("passkey_register_start"), label: z.string().max(60).optional() }),
  z.object({
    action: z.literal("passkey_register_finish"),
    challengeId: z.string().uuid(),
    challenge: z.string().min(10).max(200),
    credentialId: z.string().min(1).max(1000),
    publicKey: z.string().min(1).max(4000),
    algorithm: z.number().int(),
    authenticatorData: z.string().min(1).max(4000),
    clientDataJSON: z.string().min(1).max(4000),
    label: z.string().max(60).optional(),
  }),
  z.object({ action: z.literal("passkey_auth_start") }),
  z.object({
    action: z.literal("passkey_auth_finish"),
    challengeId: z.string().uuid(),
    challenge: z.string().min(10).max(200),
    credentialId: z.string().min(1).max(1000),
    authenticatorData: z.string().min(1).max(4000),
    clientDataJSON: z.string().min(1).max(4000),
    signature: z.string().min(1).max(4000),
    trust: z.boolean().optional(),
  }),
]);

export async function GET() {
  const me = await currentIdentity();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const [factors, recovery] = await Promise.all([
    listFactors(me.owner, false),
    countRecoveryCodes(me.owner),
  ]);

  return NextResponse.json({
    who: me.email,
    kind: me.kind,
    factors,
    recoveryCodesLeft: recovery,
    available: { totp: true, email: emailCodesAvailable(), sms: smsCodesAvailable(), passkey: true },
  });
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const input = parsed.data;

  const me = await currentIdentity();
  if (!me) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  switch (input.action) {
    case "start_totp": {
      const secret = generateSecret();
      const factorId = await beginTotp(me.owner, input.label?.trim() || "Authenticator app", secret);
      if (!factorId) return NextResponse.json({ error: "Could not start that." }, { status: 500 });

      const uri = otpauthUri(secret, me.email, "Fresh Leads");
      const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
      // The secret goes back to the browser once, to be displayed. It is already
      // stored encrypted; this copy exists so the person can type it into an app that
      // cannot scan.
      return NextResponse.json({ factorId, secret, qr });
    }

    case "start_sms": {
      if (!smsCodesAvailable()) {
        return NextResponse.json({ error: "Text message codes are not set up on this deployment." }, { status: 400 });
      }
      const phone = input.phone.replace(/[^\d+]/g, "");
      if (!phone.startsWith("+")) {
        return NextResponse.json(
          { error: "Include the country code, starting with a plus, for example +1 512 555 0142." },
          { status: 400 }
        );
      }
      const factorId = await beginSms(me.owner, phone, maskPhone(phone));
      if (!factorId) return NextResponse.json({ error: "Could not start that." }, { status: 500 });

      const code = generateCode();
      const challengeId = await createChallenge(me.owner, factorId, code, phone);
      const sent = await sendSmsCode(phone, code);
      if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 });
      return NextResponse.json({ factorId, challengeId, sentTo: maskPhone(phone) });
    }

    case "start_email": {
      if (!emailCodesAvailable()) {
        return NextResponse.json({ error: "Email codes are not set up on this deployment." }, { status: 400 });
      }
      const factorId = await beginEmail(me.owner, me.email);
      if (!factorId) return NextResponse.json({ error: "Could not start that." }, { status: 500 });

      const code = generateCode();
      const challengeId = await createChallenge(me.owner, factorId, code, me.email);
      const sent = await sendEmailCode(me.email, code);
      if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 });
      return NextResponse.json({ factorId, challengeId, sentTo: maskEmail(me.email) });
    }

    case "send_code": {
      // Signing in with an emailed or texted factor: issue a fresh code for it.
      const factors = await listFactors(me.owner, true);
      const factor = factors.find((f) => f.id === input.factorId);
      if (!factor) return NextResponse.json({ error: "No such method" }, { status: 404 });

      const code = generateCode();
      if (factor.kind === "email") {
        const challengeId = await createChallenge(me.owner, factor.id, code, me.email);
        const sent = await sendEmailCode(me.email, code);
        if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 });
        return NextResponse.json({ challengeId, sentTo: maskEmail(me.email) });
      }
      if (factor.kind === "sms") {
        // The masked number is what the client holds; the real one is read back here.
        const full = await realPhone(me.owner, factor.id);
        if (!full) return NextResponse.json({ error: "That number is missing." }, { status: 500 });
        const challengeId = await createChallenge(me.owner, factor.id, code, full);
        const sent = await sendSmsCode(full, code);
        if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: 502 });
        return NextResponse.json({ challengeId, sentTo: maskPhone(full) });
      }
      return NextResponse.json({ error: "That method does not send a code." }, { status: 400 });
    }

    case "confirm": {
      const ok = input.challengeId
        ? (await answerChallenge(me.owner, input.challengeId, input.code)) === "ok"
        : await answerTotp(me.owner, input.factorId, input.code);
      if (!ok) return NextResponse.json({ error: "That code is not right." }, { status: 400 });

      await confirmFactor(me.owner, input.factorId);
      // First factor confirmed means the account is now protected, so this is also
      // the moment it becomes possible to be locked out. Recovery codes are issued
      // here rather than left as an optional extra somebody skips.
      const confirmed = await listFactors(me.owner, true);
      const codes = confirmed.length === 1 ? await issueRecoveryCodes(me.owner) : null;

      const res = NextResponse.json({ ok: true, recoveryCodes: codes });
      applyPass(res, me.kind, me.kind === "admin" ? me.email : me.userId!, false);
      return res;
    }

    case "verify": {
      const result = input.challengeId
        ? await answerChallenge(me.owner, input.challengeId, input.code)
        : (await answerTotp(me.owner, input.factorId, input.code)) ? "ok" : "wrong";

      if (result !== "ok") {
        const message =
          result === "too_many"
            ? "Too many wrong tries on that code. Ask for a new one."
            : result === "expired"
              ? "That code has expired. Ask for a new one."
              : "That code is not right.";
        return NextResponse.json({ error: message }, { status: 400 });
      }

      const res = NextResponse.json({ ok: true });
      applyPass(res, me.kind, me.kind === "admin" ? me.email : me.userId!, input.trust === true);
      return res;
    }

    case "recovery": {
      const ok = await useRecoveryCode(me.owner, input.code);
      if (!ok) return NextResponse.json({ error: "That recovery code is not valid." }, { status: 400 });

      const left = await countRecoveryCodes(me.owner);
      const res = NextResponse.json({ ok: true, recoveryCodesLeft: left });
      applyPass(res, me.kind, me.kind === "admin" ? me.email : me.userId!, false);
      return res;
    }

    case "new_recovery_codes": {
      return NextResponse.json({ codes: await issueRecoveryCodes(me.owner) });
    }

    // ---- Passkeys -------------------------------------------------------
    //
    // Two round trips each way. The challenge is minted here and stored hashed, so a
    // browser cannot choose its own and a leaked table cannot replay one.

    case "passkey_register_start": {
      const challenge = newChallenge();
      const challengeId = await createPasskeyChallenge(me.owner, hashChallenge(challenge));
      if (!challengeId) return NextResponse.json({ error: "Could not start that." }, { status: 500 });

      return NextResponse.json({
        challengeId,
        challenge,
        rpId: relyingPartyId(),
        rpName: "Fresh Leads",
        // The account handle the authenticator stores. The user id, not the email:
        // an email can change and the key would then point at nothing.
        userId: Buffer.from(me.kind === "admin" ? me.email : me.userId!).toString("base64url"),
        userName: me.email,
        excludeCredentials: await passkeyCredentialIds(me.owner),
      });
    }

    case "passkey_register_finish": {
      const spent = await consumePasskeyChallenge(me.owner, input.challengeId, hashChallenge(input.challenge));
      if (!spent) return NextResponse.json({ error: "That attempt has expired. Try again." }, { status: 400 });

      const check = verifyRegistration(input, input.challenge);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

      const factorId = await savePasskey(me.owner, {
        credentialId: input.credentialId,
        publicKey: input.publicKey,
        algorithm: input.algorithm,
        signCount: check.signCount,
        label: input.label?.trim() || "Passkey",
      });
      if (!factorId) return NextResponse.json({ error: "Could not save that key." }, { status: 500 });

      await confirmFactor(me.owner, factorId);
      const confirmed = await listFactors(me.owner, true);
      const codes = confirmed.length === 1 ? await issueRecoveryCodes(me.owner) : null;

      const res = NextResponse.json({ ok: true, recoveryCodes: codes });
      applyPass(res, me.kind, me.kind === "admin" ? me.email : me.userId!, false);
      return res;
    }

    case "passkey_auth_start": {
      const ids = await passkeyCredentialIds(me.owner);
      if (ids.length === 0) return NextResponse.json({ error: "No passkey on this account." }, { status: 404 });

      const challenge = newChallenge();
      const challengeId = await createPasskeyChallenge(me.owner, hashChallenge(challenge));
      if (!challengeId) return NextResponse.json({ error: "Could not start that." }, { status: 500 });

      return NextResponse.json({ challengeId, challenge, rpId: relyingPartyId(), allowCredentials: ids });
    }

    case "passkey_auth_finish": {
      const spent = await consumePasskeyChallenge(me.owner, input.challengeId, hashChallenge(input.challenge));
      if (!spent) return NextResponse.json({ error: "That attempt has expired. Try again." }, { status: 400 });

      // Find the factor by the credential the browser actually signed with, rather
      // than trusting the client to say which key it used.
      const factors = await listFactors(me.owner, true);
      let matched: { id: string; stored: Awaited<ReturnType<typeof getPasskey>> } | null = null;
      for (const f of factors.filter((x) => x.kind === "passkey")) {
        const stored = await getPasskey(me.owner, f.id);
        if (stored && stored.credentialId === input.credentialId) {
          matched = { id: f.id, stored };
          break;
        }
      }
      if (!matched?.stored) return NextResponse.json({ error: "That key is not on this account." }, { status: 400 });

      const check = verifyAssertion(input, matched.stored, input.challenge);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

      await bumpSignCount(matched.id, check.signCount);
      const res = NextResponse.json({ ok: true });
      applyPass(res, me.kind, me.kind === "admin" ? me.email : me.userId!, input.trust === true);
      return res;
    }

    case "remove": {
      const result = await removeFactor(me.owner, input.factorId);
      return result.ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: result.error }, { status: 400 });
    }
  }
}

/** Attach the "second factor passed" cookie for whichever audience this is. */
function applyPass(res: NextResponse, kind: "admin" | "user", subject: string, trust: boolean) {
  const ttl = trust ? TRUSTED_TTL_MS : SESSION_TTL_MS;
  res.cookies.set(
    kind === "admin" ? MFA_ADMIN_COOKIE : MFA_COOKIE,
    mint(subject, ttl),
    cookieOptions(ttl)
  );
}

/** The stored number for an SMS factor. Server side only, never sent to a browser. */
async function realPhone(owner: Owner, factorId: string): Promise<string | null> {
  const admin = createAdminClient();
  const w = "userId" in owner ? ["user_id", owner.userId] : ["admin_email", owner.adminEmail.toLowerCase()];
  const { data } = await admin
    .from("mfa_factors")
    .select("phone")
    .eq("id", factorId)
    .eq(w[0] as string, w[1] as string)
    .maybeSingle();
  return (data?.phone as string | null) ?? null;
}
