# Fresh Leads

Local business lead generation for people who sell to small businesses.

Fresh Leads finds real companies in a given area, verifies that their phone numbers and
email addresses actually work, confirms they are still trading, and grades each one on how
well it fits what you sell. Live at [fresh-leads.io](https://www.fresh-leads.io).

Most lead tools hand you a list and leave you to work out who is worth calling. This one
scores every business against a buyer playbook, so a card terminal reseller and a web
designer looking at the same street get two completely different lists.

## Contents

- [What it does](#what-it-does)
- [How a search works](#how-a-search-works)
- [Playbooks](#playbooks)
- [Credits](#credits)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Database setup](#database-setup)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Admin panel](#admin-panel)
- [Deployment](#deployment)

## What it does

- **Finds real businesses.** Discovery runs against OpenStreetMap (free, wide coverage) and
  Google Places (paid, better data quality), then merges and deduplicates the two.
- **Verifies contact details.** Phone numbers go through Twilio Lookup, email addresses
  through ZeroBounce. A lead is only marked reachable once something actually answered.
- **Checks whether they are still open.** Permanently closed businesses are filtered out
  before they reach you.
- **Audits their web presence.** Fetches the homepage and detects missing or broken sites,
  social-only presence, slow load times, thin content, missing analytics, missing schema
  markup, and which POS, booking or ordering vendor they already use.
- **Grades the opportunity 0 to 100** with a plain English reason for the score, so a rep
  knows what to say before dialling.
- **Exports to CSV** once a lead is unlocked.

## How a search works

```
location + business type
        |
        v
  geocode (Nominatim)
        |
        v
  discovery: OpenStreetMap + Google Places
        |
        v
  merge and deduplicate
        |
        v
  website audit, freshness, offline contact checks
        |
        v
  score against the active playbook
        |
        v
  ranked results, contact details hidden until unlocked
```

Contact details are never sent to the browser for a locked lead. `lib/lead-view.ts` is the
single definition of what a locked lead may expose, and it works as an allow list, so a
newly added field cannot leak by accident.

Paid verification (Twilio, ZeroBounce) runs when a lead is unlocked rather than when it is
found. Searching is cheap, and the expensive lookups only happen for leads someone actually
wants. This cut the cost per sold lead by roughly four times without changing what the
customer sees.

## Playbooks

A lead is only good relative to what you sell. Each playbook declares which signals count,
which problem filters appear, and what a high score means:

| Playbook | Looks for |
| --- | --- |
| `web_design` | No site, broken site, social-only presence, outdated or slow sites |
| `payments_pos` | Busy independents already on a switchable POS or payment vendor |
| `marketing_seo` | No analytics, no schema markup, thin content, weak search presence |
| `booking_software` | No online booking or ordering |
| `general_smb` | A balanced default across all signals |

Signals outside the active playbook are hidden rather than down-weighted, so a score always
means "fit for what you sell". There is also a free text box that reads a description of
your ideal customer and sets the playbook, target niches and location from it.

## Credits

Two independent things:

- **Access** costs $30 a year and keeps the account open. It includes no credits.
- **Credits** cost $1 each. One credit opens one lead, permanently, and re-opening or
  re-exporting a lead you already own is free.

New accounts get 3 free credits without a card. Buying 300 credits inside a calendar month
adds 50 free, once per month, for subscribers.

Balances live on `profiles.credits` for cheap reads, and every movement is also written to
an append-only `credit_ledger`. The rules that protect revenue (never charge twice for the
same business, never let a balance go negative, never double-grant a redelivered webhook)
are enforced by unique indexes and conditional updates in Postgres, not in application code,
because they have to hold under concurrent requests.

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 15 (App Router), React 19 |
| Language | TypeScript, strict mode |
| Database | Supabase Postgres with row level security on every table |
| Auth | Supabase Auth, cookie sessions via `@supabase/ssr` |
| Payments | Stripe Checkout and webhooks |
| Validation | Zod |
| Discovery | OpenStreetMap Overpass, Google Places |
| Verification | Twilio Lookup, ZeroBounce |
| Hosting | Vercel |

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
verification keys it falls back to offline format and MX checks.

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
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL, used for checkout redirects |

**Optional**

| Variable | Effect if missing |
| --- | --- |
| `GOOGLE_PLACES_API_KEY` | OpenStreetMap only, lower coverage and no review counts |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Offline phone format checks only |
| `ZEROBOUNCE_API_KEY` | Syntax and MX checks only |
| `CLAUDE_API_KEY` | The ideal customer box falls back to keyword parsing |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Bootstrap credentials for a fresh admin account |
| `ADMIN_SESSION_SECRET` | Defaults to the service role key |

If a password contains `#`, quote it. Otherwise dotenv reads everything after the `#` as a
comment.

## Database setup

Run the SQL files in the Supabase SQL editor, in order:

```
supabase/schema.sql                        base tables, RLS policies
supabase/002_admin_branding.sql            site settings and logo storage
supabase/003_admin_accounts.sql            admin credential table
supabase/004_contact_messages.sql          contact form inbox
supabase/005_atomic_quota.sql              lead indexes
supabase/006_credits_and_subscription.sql  credits, unlocks, subscriptions
supabase/007_buyer_profile.sql             saved buyer profile
```

Migration 006 also creates the SQL functions that move credits (`grant_credits`,
`unlock_lead`, `unlock_leads_bulk`, `upsert_subscription`). The app calls these rather than
writing balances directly.

## Testing

```bash
npm test        # unit tests, no network access
npm run test:sql # credit functions against a throwaway Postgres, needs Docker
```

The unit suite covers scoring and grade boundaries, cross-source deduplication, the access
rules, what a locked lead is allowed to expose, email candidate selection, pricing
invariants, and the volume bonus. `npm run test:sql` exercises the concurrency guarantees:
double unlocks, redelivered webhooks, and balances under parallel spend.

## Project structure

```
app/
  (auth)/           sign in and sign up
  dashboard/        search, results, unlocking, billing, history
  admin/            admin panel, separate login
  api/              route handlers
  pricing|about|contact|privacy|terms
lib/
  sources/          OpenStreetMap and Google Places discovery
  verify/           phone, email, trading status
  score.ts          grading
  playbooks.ts      what each buyer type cares about
  vendors.ts        POS, booking and builder detection
  access.ts         who may search, unlock and buy
  credits.ts        credit operations, all via SQL functions
  lead-view.ts      what a locked lead may expose
supabase/           schema and migrations
test/               unit tests and SQL tests
```

## Admin panel

Lives at `/admin` behind its own login at `/admin/login`, deliberately separate from
customer accounts. There is one admin and no signup. Credentials bootstrap from
`ADMIN_EMAIL` and `ADMIN_PASSWORD` on first login, then persist to the database, after which
the password is changed from inside the panel.

Sections: overview, customers and their access, site branding (name, logo, palette, applied
live without a redeploy), the contact form inbox, and account settings.

## Deployment

Deployed on Vercel from the `main` branch. Set the same environment variables in the Vercel
project, add a Stripe webhook endpoint pointing at `https://your-domain/api/webhooks/stripe`
for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `invoice.paid`,
`customer.subscription.updated` and `customer.subscription.deleted`, then put
`STRIPE_WEBHOOK_SECRET` in the environment and redeploy.

The webhook returns 500 on transient failures so Stripe keeps retrying. A paid customer is
never silently left without what they bought.

---

Copyright Fresh N Fresh, Inc. All rights reserved.
