# Fresh Leads

Local business lead generation for people who sell to small businesses.

Fresh Leads finds real companies in a given area, verifies that their phone numbers and
email addresses actually work, confirms they are still trading, grades each one on how well
it fits what you sell, and tells you what changed at that business since the last time
anyone looked. Live at [fresh-leads.io](https://www.fresh-leads.io).

Most lead tools hand you a list and leave you to work out who is worth calling. This one
scores every business against a buyer playbook, so a card terminal reseller and a web
designer looking at the same street get two completely different lists.

## Contents

- [What it does](#what-it-does)
- [How a search works](#how-a-search-works)
- [Playbooks](#playbooks)
- [Credits and access](#credits-and-access)
- [What is in the product](#what-is-in-the-product)
- [Measured coverage](#measured-coverage)
- [Security](#security)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Database setup](#database-setup)
- [Scheduled jobs](#scheduled-jobs)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Admin panel](#admin-panel)
- [Public API](#public-api)
- [Deployment](#deployment)

## What it does

- **Finds real businesses.** Discovery runs against OpenStreetMap (free, wide coverage) and
  Google Places (paid, better data quality), then merges and deduplicates the two.
- **Verifies contact details.** Phone numbers go through Twilio Lookup, email addresses
  through ZeroBounce. A lead is only marked reachable once something actually answered.
- **Checks whether they are still open.** Permanently closed businesses are filtered out
  before they reach you.
- **Audits their web presence.** Fetches the homepage and detects missing or broken sites,
  social only presence, slow load times, thin content, missing analytics, missing schema
  markup, and which POS, booking or ordering vendor they already use.
- **Finds the owner.** At unlock, crawls the contact, about and team pages for the person
  who runs the business, their role, social profiles and hiring signals.
- **Grades the opportunity 0 to 100** with a plain English reason for the score, so a rep
  knows what to say before dialling.
- **Watches for change.** Every business is photographed over time, so a site that goes
  down, a booking system that appears or a vendor that gets swapped becomes a reason to
  call this week.

## How a search works

1. **Discover.** Overpass and Google Places are queried for the trade and area, then merged
   on a stable business key so the same shop from two sources is one lead.
2. **Audit.** Up to 24 websites are fetched in parallel, with a quieter second pass for
   anything that came back unreachable, because a false "their site is down" is the most
   damaging wrong output this product can make.
3. **Verify, free tier.** Offline format and MX checks, plus trading status.
4. **Score.** Each lead is graded against the buyer's playbook, so the same business scores
   differently for different customers.
5. **Filter.** Anything with no way to reach it at all is dropped rather than sold.
6. **Snapshot and diff.** Today's observation is stored and compared against the last one,
   and anything that changed is recorded against the business.

Searching is free. Paid verification and the owner crawl only run when a credit is spent,
because a search finds around forty businesses and gets paid for the few that are opened.

## Playbooks

What the customer sells decides which signals are scored and shown.

| Playbook | Cares about |
| --- | --- |
| Websites and design | No site, site down, no SSL, not mobile friendly, outdated, slow, thin |
| Payments, POS and terminals | Switchable vendor, volume, no online ordering |
| Marketing, SEO and ads | No analytics, no schema, thin content, few or poor reviews |
| Booking and software | No online booking, replaceable platform, phone only |
| Anything to local businesses | Real, active, reachable, sized by review volume |

## Credits and access

Two independent things, and both are needed:

- **Access** costs $30 a year and keeps the account open. It includes no credits.
- **Credits** cost $1 each. One credit opens one lead, permanently, and re-opening or
  re-exporting a lead you already own is free.

New accounts get 3 free credits without a card. Larger baskets carry bonus credits, and a
subscriber buying 300 credits inside a calendar month gets 50 more.

The free trial is deliberately narrow: three credits cover searching and opening a lead.
Search history, bulk enrichment, email sequences, CRM push and the API all require the plan.

Balances live on `profiles.credits` for cheap reads, and every movement is also written to
an append only `credit_ledger`. The rules that protect revenue (never charge twice for the
same business, never let a balance go negative, never double grant a redelivered webhook)
are enforced by unique indexes and conditional updates in Postgres, not in application code,
because they have to hold under concurrent requests.

## What is in the product

**For the customer**

| Area | What it does |
| --- | --- |
| Search | Trade and area, or a plain sentence describing the ideal customer, with filters for rating, review count and web presence |
| Results | Locked leads showing who, where, the grade and whether we verified a way to reach them |
| Unlock | One credit reveals verified phone and email, the address, the grade breakdown, what to pitch, socials and hiring |
| Owner reveal | One further credit for the person who runs it, where the business names them |
| History | Every search saved, re-openable and re-exportable, free forever |
| Enrich a list | Upload your own CSV and get it back filled in, one credit per row actually enriched |
| Email sequences | Multi step outreach with merge tags, an enforced unsubscribe link and postal address, and a one way suppression list |
| CRM | Push opened leads to HubSpot as companies or Salesforce as leads, matched on domain so nothing duplicates |
| API keys | Same leads, same prices, from your own code |
| Help | Searchable answers plus support tickets threaded on the account |
| Account and security | Password, email address, two factor methods, account deletion |
| Personalisation | Display name, what you sell, default search area and result count, email preferences |

**For the operator**

| Area | What it does |
| --- | --- |
| Overview | Accounts, active access, paid subscriptions, leads opened, credits sold |
| Users and plans | Every account, with credits, spend, subscription state and lead counts |
| Account detail | Everything one customer has done, plus credits in and out, suspend, lift, sign out everywhere, password reset, internal notes and deletion |
| Activity | A live feed across every account |
| Support | The ticket queue, oldest activity first, with replies that land in the customer's account |
| Messages | The public contact form inbox |
| Branding | Name, logo and palette, applied live without a redeploy |

## Measured coverage

Measured on 1 August 2026: 318 leads discovered and 80 opened across eight trades in eight
cities (dentists, plumbers, hair salons, restaurants, law firms, auto repair, gyms, vets).

| Field | Coverage |
| --- | --- |
| Phone present | 98% |
| Website | 90% |
| Email, on opened leads | 83% |
| Socials, on opened leads | 81% |
| Hiring known, on opened leads | 89% |
| Owner name, on opened leads | 41% |

Owner coverage varies enormously by trade, and the spread matters more than the average.
Dentists and vets around 60%, law firms and gyms around 50%, plumbers 40%, auto repair 30%,
hair salons and restaurants 20%. Professions where a named practitioner is the product name
someone; trades where the business itself is the brand usually do not.

Owner email is only ever shown when the mailbox actually accepted mail. A guessed address
never survives, which keeps the number lower and the sender reputation intact.

## Security

The full policy, what has already been attacked, and the gaps an external tester should
start on are in [SECURITY.md](SECURITY.md). In short:

- Two factor is required on every account, including the operator's. Authenticator app,
  emailed code, text message, or a passkey using Face ID, Touch ID or a security key.
- Recovery codes are issued automatically when the first factor is confirmed, because
  mandatory two factor without them turns a lost phone into a lost account.
- Passwords are hashed with scrypt, API keys are stored as hashes, and CRM tokens are
  encrypted with AES-256-GCM using a key held outside the database.
- Card details never reach our servers.
- Customer data is isolated at the database row level, not only in the interface.
- Rate limits are counted in Postgres so they hold across serverless instances, and are
  sized by what an endpoint costs rather than by how annoying the abuse would be.
- Every operator action on a customer account is written to an append only audit log.

`MFA_DISABLED=1` in the environment is the only way past two factor. It exists so that one
bad deploy cannot lock everybody out, including whoever would fix it.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router), React 19 |
| Language | TypeScript, strict mode |
| Database | Supabase Postgres with row level security on every table |
| Auth | Supabase Auth, cookie sessions via `@supabase/ssr`, plus a separate operator credential |
| Two factor | TOTP implemented in house, WebAuthn passkeys, email and SMS codes |
| Payments | Stripe Checkout and webhooks |
| Email | Resend, behind a provider interface |
| Validation | Zod |
| Discovery | OpenStreetMap Overpass, Google Places |
| Verification | Twilio Lookup, ZeroBounce |
| Hosting | Vercel |

TOTP is written out rather than pulled in. A dependency in the login path of every account
is a third party you can never remove, and it is forty lines of well specified arithmetic
checked against the published RFC vectors.

## Getting started

**Requirements:** Node 20 or newer, and a Supabase project.

```bash
git clone https://github.com/Hassan-Naeem-code/Fresh-Leads.git
cd Fresh-Leads
npm install
cp .env.local.example .env.local   # then fill it in, see below
npm run dev
```

The app runs at `http://localhost:3000`.

Only the three Supabase variables are required to boot. Without Stripe keys the app runs in
open mode with no payment gating, which is the fastest way to try it locally. Without the
verification keys it falls back to offline format and MX checks. Set `MFA_DISABLED=1` while
developing if you do not want to enrol a factor on every throwaway account.

## Environment variables

Real keys belong in `.env.local`, which is gitignored. Never put them in
`.env.local.example`, which is committed.

**Required**

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key, safe for the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Bypasses row level security |

**Payments**

| Variable | Purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/webhooks/stripe` |
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL, used for checkout redirects and the passkey origin |

**Email and scheduling**

| Variable | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Sending provider. Without it nothing sends and every screen says so |
| `EMAIL_TOKEN_SECRET` | Signs unsubscribe links |
| `CRON_SECRET` | Bearer token the scheduled jobs must present |
| `MFA_FROM_EMAIL`, `MFA_FROM_NAME` | Sender for account email |
| `SUPPORT_NOTIFY_EMAIL` | Where new tickets are announced |

**Optional**

| Variable | Effect if missing |
| --- | --- |
| `GOOGLE_PLACES_API_KEY` | OpenStreetMap only, lower coverage and no review counts |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Offline phone format checks only |
| `TWILIO_FROM_NUMBER` | Text message two factor is hidden rather than shown broken |
| `ZEROBOUNCE_API_KEY` | Syntax and MX checks only |
| `CLAUDE_API_KEY` | The ideal customer box falls back to keyword parsing |
| `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` | Service key connection only, no OAuth button |
| `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` | Salesforce connect is switched off |
| `CRM_TOKEN_SECRET` | Falls back to the service role key for token encryption |
| `MFA_TOKEN_SECRET` | Falls back to the email token secret |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Bootstrap credentials for a fresh operator account |
| `ADMIN_SESSION_SECRET` | Defaults to the service role key |
| `MFA_DISABLED` | Set to `1` to bypass two factor. Emergency use only |

If a password contains `#`, quote it. Otherwise dotenv reads everything after the `#` as a
comment.

## Database setup

Run the SQL files in the Supabase SQL editor, in order:

```
supabase/schema.sql                        base tables, RLS policies
supabase/002_admin_branding.sql            site settings and logo storage
supabase/003_admin_accounts.sql            operator credential
supabase/004_contact_messages.sql          contact form inbox
supabase/005_atomic_quota.sql              lead indexes
supabase/006_credits_and_subscription.sql  credits, unlocks, subscriptions
supabase/007_buyer_profile.sql             saved buyer profile
supabase/008_business_snapshots.sql        daily observations of each business
supabase/009_watchlists.sql                saved searches and watched markets
supabase/010_owner_unlocks.sql             owner reveal ledger
supabase/011_api_keys.sql                  hashed API keys
supabase/012_spend_credits.sql             atomic spend with refund on race
supabase/013_crm_connections.sql           encrypted CRM tokens
supabase/014_email_sequences.sql           sequences, steps, enrollments, suppression
supabase/015_crm_instance_url.sql          Salesforce instance host
supabase/016_support_and_preferences.sql   tickets, preferences, closure record
supabase/017_suspension_and_audit.sql      suspension and the operator audit log
supabase/018_mfa.sql                       two factor: factors, challenges, recovery codes
supabase/019_triggers.sql                  detected changes, digest bookkeeping
supabase/020_rate_limits.sql               shared rate limiting
supabase/021_lock_down_profiles.sql        revoke client writes to the money columns
```

Migration 021 matters more than its size suggests. Row level security is row level, not
column level, so a policy allowing a customer to update their own profile row said nothing
about which columns, and `credits` had moved onto that row. It is revoked at the privilege
level now, with a trigger as a backstop.

The app calls SQL functions rather than writing balances directly: `grant_credits`,
`spend_credits`, `unlock_lead`, `unlock_leads_bulk`, `upsert_subscription`,
`hit_rate_limit`.

## Scheduled jobs

Two, both daily, because that is what the hosting plan allows.

| Path | Time | Does |
| --- | --- | --- |
| `/api/cron/email` | 14:00 UTC | Sends whatever sequence steps are due |
| `/api/cron/digest` | 15:00 UTC | Weekly change summary on Mondays, plus housekeeping every day |

Both require `CRON_SECRET` as a bearer token. The digest decides for itself whether today is
the send day, so the weekday lives in code next to the logic rather than in a cron string.

## Testing

```bash
npm test         # 275 unit tests, no network access
npm run test:sql # credit functions against a throwaway Postgres, needs Docker
```

The unit suite covers scoring and grade boundaries, cross source deduplication, the access
rules including suspension, what a locked lead may expose, email candidate selection,
pricing invariants, the volume bonus, change detection, CSV parsing, CRM payload shaping,
email composition and its legal requirements, the mail template's client compatibility,
TOTP against the published RFC vectors, the two factor session token's account binding,
passkey verification against thirteen distinct attacks, the digest send day, landing page
metadata, and the API reference against the routes that actually exist.

`npm run test:sql` exercises the concurrency guarantees: double unlocks, redelivered
webhooks, and balances under parallel spend.

## Project structure

```
app/
  (auth)/           sign in and sign up
  dashboard/        search, results, unlocking, billing, history, email, CRM, API keys,
                    help, account, personalisation
  admin/            operator panel
  api/              route handlers
  docs/             public API reference
  for/[trade]/      landing pages, one per kind of seller
  verify/           two factor challenge
  security/         two factor enrolment
  compare|faq|integrations|pricing|about|contact|privacy|terms
lib/
  sources/          OpenStreetMap and Google Places discovery
  verify/           phone, email, trading status
  mfa/              TOTP, passkeys, challenges, session tokens
  crm/              HubSpot and Salesforce, encrypted token storage
  email/            provider, composer, sender, branded template, notifications
  admin/            operator auth, per account oversight, audit log
  score.ts          grading
  playbooks.ts      what each buyer type cares about
  snapshots.ts      observations over time and the diff between them
  digest.ts         the weekly change summary
  access.ts         who may search, unlock, buy and use the paid sections
  credits.ts        credit operations, all via SQL functions
  lead-view.ts      what a locked lead may expose
  rate-limit.ts     shared limiter
supabase/           schema and migrations
test/               unit tests and SQL tests
```

## Admin panel

Lives at `/admin`. Sign in through the ordinary login form: the operator credential is
checked first, and any other address falls straight through to the customer sign in, so a
customer mistyping a password can neither lock the operator out nor be locked out by them.

There is one operator and no signup. The credential bootstraps from `ADMIN_EMAIL` and
`ADMIN_PASSWORD` on first login, then persists to the database, after which the password is
changed from inside the panel. Two factor applies to the operator exactly as it does to a
customer.

Suspension destroys nothing. It locks the account, kills live sessions and shows the
customer what they were told, and lifting it puts everything back, because the usual reason
to suspend is a suspicion and suspicions are sometimes wrong.

## Public API

Documented at [/docs](https://www.fresh-leads.io/docs), readable without an account.

```bash
curl -X POST https://www.fresh-leads.io/api/v1/leads \
  -H "Authorization: Bearer fl_live_your_key_here" \
  -H "Content-Type: application/json" \
  -d '{"niche":"dentists","location":"Austin, TX","limit":20}'
```

The API and the dashboard are the same code path, so a call can never return more than the
same customer sees on screen, and a credit costs what it costs everywhere else. Every paid
action is idempotent, so a retry cannot charge twice.

## Deployment

Deployed on Vercel from the `main` branch. Set the same environment variables in the Vercel
project, add a Stripe webhook endpoint pointing at `https://your-domain/api/webhooks/stripe`
for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`,
`customer.subscription.updated` and `customer.subscription.deleted`, then put
`STRIPE_WEBHOOK_SECRET` in the environment and redeploy.

The webhook returns 500 on transient failures so Stripe keeps retrying, and it reads the
purchase amounts from Stripe's own copy of the session rather than from the payload it was
sent. A valid signature proves who sent a message, not that the session exists.

---

Copyright Fresh N Fresh, Inc. All rights reserved.
