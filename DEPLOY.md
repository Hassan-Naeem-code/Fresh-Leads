# Deploying Fresh Leads live (for your partner to see)

Follow top to bottom. ~15 minutes. Everything here is on free tiers.

> What your partner will see once live: **Landing → Sign up → Onboarding → Custom quote →
> (placeholder) checkout → Dashboard lead search.** Real payment and verified leads come in
> the next build phases — this is the full flow demo, not yet a sellable product.

---

## Step 1 — Create the Supabase project (the database + login)

1. Go to **https://supabase.com** → sign in → **New project**.
2. Name it `leadradar`, set a strong database password (save it), pick the region closest to you.
3. Wait ~2 min for it to finish provisioning.

## Step 2 — Create the database tables

1. In the project, open **SQL Editor** (left sidebar) → **New query**.
2. Open the file `supabase/schema.sql` from this repo, copy **all** of it, paste into the editor.
3. Click **Run**. You should see "Success". This creates every table, security rule, and the
   auto-profile trigger.

## Step 3 — Grab your keys

1. Go to **Project Settings → API**.
2. Copy these three values (you'll paste them into Vercel in Step 5):
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key (secret) → `SUPABASE_SERVICE_ROLE_KEY`

## Step 4 — Let people sign up instantly

1. Go to **Authentication → Providers → Email**.
2. Turn **OFF** "Confirm email" and **Save**. (Otherwise sign-ups wait on a confirmation email.)

---

## Step 5 — Deploy to Vercel

1. Go to **https://vercel.com** → sign up with your **GitHub** account.
2. Click **Add New… → Project** → **Import** the `Hassan-Naeem-code/Lead-Radar` repo.
3. Before clicking Deploy, expand **Environment Variables** and add these three
   (name → value from Step 3):
   ```
   NEXT_PUBLIC_SUPABASE_URL        = https://xxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY   = eyJ....(anon key)
   SUPABASE_SERVICE_ROLE_KEY       = eyJ....(service_role key)
   ```
4. Click **Deploy**. ~2 minutes later you get a URL like `https://lead-radar.vercel.app`.

## Step 6 — Point Supabase at your live URL

1. Copy your new Vercel URL.
2. In Supabase → **Authentication → URL Configuration** → set **Site URL** to that URL and
   add it under **Redirect URLs** too → **Save**.

## Step 7 — Enable the admin panel (`/admin`)

The admin panel lets you manage every user's plan/access and change the site's
branding (colors, logo, name). Admin sign-in is its **own separate login** (not a
normal user account, and there's no admin signup). Setup:

1. **Add the database tables + logo storage.** In Supabase → **SQL Editor → New query**,
   run **both** of these (paste all, Run):
   - `supabase/002_admin_branding.sql` — the `site_settings` table + public `branding`
     storage bucket. (Confirm the bucket shows under **Storage**, marked *public*.)
   - `supabase/003_admin_accounts.sql` — the single admin credential table.
2. **Set the fixed admin login.** Add these env vars (Vercel → Settings → Environment
   Variables, or `.env.local` locally):
   ```
   ADMIN_EMAIL    = you@fresh-leads.io
   ADMIN_PASSWORD = <a strong first password>
   ```
   Redeploy after adding them. These are only the **starting** credentials — on first
   login they're saved to the database, and you change the password from inside the panel.
   There is no way to create a second admin from the app.

Now go to **`/admin/login`**, sign in with those credentials, and you land in **`/admin`**:
- **Users & plans** — every account with its access. Edit lead quota, status, and expiry, or
  **Grant access** to someone who never paid. Changes go live on their next request. (This
  controls access in your database only — it does **not** cancel/refund real Stripe billing.)
- **Branding** — change the color theme, upload a logo, and set the brand name/tagline, then
  **Publish** to push it live across the whole site.
- **Account** — change your admin password. It replaces the initial `ADMIN_PASSWORD` and
  persists in the database, so the env value is only ever used for that first sign-in.

---

## Done — send the Vercel link to your partner

They can sign up, define their needs, see a real custom quote, and use the lead dashboard.

### What's still stubbed (coming next)
- **Payment**: `/checkout` is a placeholder. To take real money we add Stripe (needs a Stripe
  account + 2 keys) — set it up when you're ready.
- **Verified leads**: the dashboard still runs the free OpenStreetMap search with unverified
  contacts. The email/phone/active-business verification engine is the next major phase.

### Updating the live site later
Every time new code is pushed to `main` on GitHub, Vercel redeploys automatically. No extra steps.
