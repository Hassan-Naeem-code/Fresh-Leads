# Security

## Reporting a vulnerability

Write to **security@fresh-leads.io** before telling anyone else. We do not threaten
researchers acting in good faith, and we will credit you if you want the credit.

Please do not run automated scanners or load tests against the live service without
asking first. They are indistinguishable from an attack at our end and we will block
them. Ask and we will arrange a window.

## What has already been tested, and how

This is here so an external tester does not spend their first day on ground we have
covered, and so they can see the standard of evidence we work to. Everything below was
verified by running it, not by reading the code.

| Area | Test | Result |
|---|---|---|
| Profile privilege escalation | Customer PATCHes own `credits` and `suspended_at` with the anon key | **Was exploitable.** Fixed in migration 021, re-tested: 403 |
| Stripe webhook replay | Same event delivered five times | Granted once, never again |
| Stripe webhook forgery | Valid signature over a fabricated session | **Was accepted.** Now verified against Stripe's own copy |
| Webhook signature | Missing, wrong secret, 20 minute old timestamp | All refused |
| Cross account lead access | One customer unlocks, exports, reveals owner and CRM pushes another's lead | All refused, owner's own access unaffected |
| Two factor | Bypass by cookie forgery, replay, cross account token | Token is bound to the account it was issued for |
| Passkeys | Phishing origin, replayed challenge, another key's signature, rolled back counter, iframe driven ceremony | All refused |
| Rate limiting | Endpoints that cost money per call | Counted in Postgres, shared across instances |

## Known gaps we would want a tester to start on

Being explicit is more useful than being reassuring:

1. **No independent review has ever been done.** Every test above was written by the
   same person who wrote the code being tested. Two of the most serious findings were
   only spotted days later, on a deliberate second pass. Assume there are more.
2. **The Supabase Row Level Security policies have not been reviewed by fresh eyes.**
   The one critical hole found so far lived there, and it was invisible for weeks
   because the policy was correct when written and the schema changed underneath it.
3. **Email sending and the CRM integrations have been exercised by us, not attacked.**
4. **The admin surface is guarded by a single credential.** There is no second operator
   account, no roles, and no way to scope what an operator can reach.

## What we do

- Two factor is required on every account, ours included. A password reaches nothing.
- Passwords are hashed with scrypt. API keys are stored as hashes. CRM tokens are
  encrypted with AES-256-GCM using a key held outside the database.
- Card details never touch our servers. Stripe handles them end to end.
- Customer data is isolated at the database row level, not only in the interface.
- Every operator action on a customer account is written to an append only audit log.
- Deleting an account deletes the data. What survives is a dated row with nothing in it
  that identifies a person.
