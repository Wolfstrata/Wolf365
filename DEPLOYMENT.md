# Wolf365 — Deployment Guide (Vercel + Neon)

Step-by-step guide to deploy Wolf365 to **Vercel** with a **Neon Postgres**
database, plus a checklist of the manual tasks only you can do.

---

## Prerequisites

- This repo connected to GitHub
- Accounts: **Vercel**, **Neon**, **Microsoft Entra (Azure AD)**, **Intuit Developer**
- (Optional connectors) **TD SYNNEX Stellr** developer access, **Hudu**, **SuperOps**

---

## 1. Create the Neon database

1. Neon console → **New Project** (region close to your Vercel region).
2. Open **Connection Details** and copy two strings:
   - **Pooled** (host contains `-pooler`) → becomes `DATABASE_URL`
   - **Direct** (no `-pooler`) → becomes `DIRECT_URL`
3. Ensure both end with `?sslmode=require`.

> Prisma uses `DATABASE_URL` (pooled) at runtime and `DIRECT_URL` (direct) for
> migrations — both are wired in `prisma/schema.prisma`.

## 2. Generate the app secrets

Run locally (each prints one value):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"    # WOLF365_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"    # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"  # CRON_SECRET
```

> **`WOLF365_ENCRYPTION_KEY` is critical.** Rotating it later makes every stored
> connector secret/token unreadable. Store it somewhere safe.

## 3. Apply the schema to Neon

From your machine, with the Neon URLs exported:

```bash
export DATABASE_URL="<neon-pooled-url>"
export DIRECT_URL="<neon-direct-url>"
pnpm install
pnpm exec prisma migrate deploy
```

This runs the committed migration (`prisma/migrations/0_init`) and creates all
tables. It is idempotent and safe to re-run.

## 4. Register the Microsoft Entra app (SSO)

1. Entra admin center → **App registrations → New registration**.
2. Account types: **Single tenant** (or per your org policy).
3. Add a **Web** redirect URI (fix the host after step 6 if unknown now):
   `https://<your-domain>/api/auth/callback/microsoft-entra-id`
4. **Certificates & secrets → New client secret** → copy the **Value**.
5. From **Overview** copy **Directory (tenant) ID** and **Application (client) ID**.
6. (Optional, for group→role mapping) **Token configuration → Add groups claim**.

## 5. Register the QuickBooks Online app

1. Intuit Developer → **Create an app → QuickBooks Online and Payments**.
2. **Keys & credentials** → copy **Client ID** + **Client Secret** (Development
   keys for Sandbox, Production keys for live).
3. **Redirect URIs** → add:
   `https://<your-domain>/api/connectors/quickbooks/callback`
4. Scope is `com.intuit.quickbooks.accounting` (already set in code).

You enter these **in the app** (step 8), not as env vars.

## 6. Deploy to Vercel

1. Vercel → **Add New → Project** → import this repo (auto-detects Next.js).
2. Leave the build command default — `build` runs `prisma generate && next build`.
3. Add **Environment Variables** (Production **and** Preview):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** URL |
| `DIRECT_URL` | Neon **direct** URL |
| `WOLF365_ENCRYPTION_KEY` | base64 key from step 2 |
| `AUTH_SECRET` | base64 secret from step 2 |
| `AUTH_URL` | `https://<your-domain>` |
| `CRON_SECRET` | value from step 2 |
| `ENTRA_TENANT_ID` | from step 4 |
| `ENTRA_CLIENT_ID` | from step 4 |
| `ENTRA_CLIENT_SECRET` | from step 4 |
| `WOLF365_BOOTSTRAP_ADMINS` | your email (e.g. `rperumal@wolfstrata.com`) |
| `WOLF365_DEBUG_LOG_RETENTION_DAYS` | `30` (optional) |

4. **Deploy.**

> The `ENTRA_*` vars are only the first-run bootstrap so you can sign in. Once
> you save SSO in-app you can remove them on a later deploy.

## 7. Fix the real domain, then verify login

1. Copy your real domain after the first deploy (e.g. `wolf365.vercel.app`).
2. If it differs from your placeholder: update `AUTH_URL` in Vercel and the
   **Entra** (4.3) and **QuickBooks** (5.3) redirect URIs. Redeploy if you
   changed `AUTH_URL`.
3. Visit the site → **Sign in with Microsoft** → you land as **Owner** (your
   email is in `WOLF365_BOOTSTRAP_ADMINS`).
4. Go to **Security & SSO**, save tenant/client/secret/allowed domains there.
   SSO is now managed in-app (encrypted); you may drop the `ENTRA_*` env vars.

## 8. Connect the connectors

1. **Connectors → QuickBooks Online**: enter Client ID/Secret, choose
   Sandbox/Production, **Save**, then **Connect QuickBooks** → consent.
   **Test Connection**, then **Sync Now** (customers + items).
2. **Connectors → TD SYNNEX Stellr**: from your Stellr Developer Portal enter
   Environment, Region, **API Base URL**, **OAuth Token URL**, Client ID/Secret,
   and the customers/subscriptions resource paths. **Test Connection**, then
   **Sync Now**.
3. (Optional) Configure **Hudu** / **SuperOps**.

## 9. Confirm the daily cron

`vercel.json` registers `/api/cron` at `0 6 * * *` (06:00 UTC). Vercel injects
`Authorization: Bearer $CRON_SECRET`. Check **Vercel → Settings → Cron Jobs**.
Test manually:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-domain>/api/cron
```

It syncs enabled connectors, runs reconciliation, and purges old debug logs.

## 10. First real workflow

**Mappings → Run auto-match** (clients + SKUs) → confirm proposals → open a
**Client** to review the side-by-side comparison + discrepancies → **Billing →
New billing run** → review the pre-push report → **Approve** → **Approve & Push
to QuickBooks Online**.

---

## Database migrations (automated)

Schema changes ship as Prisma migrations in `prisma/migrations/`. A GitHub
Action (`.github/workflows/migrate.yml`) applies them to Neon automatically, so
deployed code never runs against an out-of-date schema.

**One-time setup** — add two repository secrets (GitHub → **Settings → Secrets
and variables → Actions → New repository secret**):

| Secret | Value |
|---|---|
| `DATABASE_URL` | Neon **pooled** connection string |
| `DIRECT_URL` | Neon **direct** connection string |

**How it runs:**
- Automatically on every push to `main` that changes anything under `prisma/`.
- Manually anytime: GitHub → **Actions → Migrate Neon Database → Run workflow**.

**Manual fallback** (no CI) — from the repo folder with the Neon URLs exported:

```powershell
cd C:\Users\agsde\wolf365
git pull
npx prisma migrate deploy
```

Or, to apply a single change instantly, run the migration's SQL in the Neon
**SQL Editor**, then record it so history stays consistent:

```powershell
npx prisma migrate resolve --applied <migration_folder_name>
```

> If sign-in ever shows "Server error / Configuration", it usually means a
> migration is pending — run the Action (or `migrate deploy`) to apply it.

### Baselining an existing database (error `P3005`)

If `migrate deploy` fails with **`P3005 — The database schema is not empty`**,
the database already has the tables but Prisma has no migration history
(`_prisma_migrations`) for them — e.g. the schema was created out-of-band, or
the DB was branched/restored. `migrate deploy` refuses to touch a non-empty DB
it can't account for. Fix it **once** by recording the already-present
migrations as applied. `migrate resolve --applied` only writes history rows; it
never runs DDL, so it can't alter your data.

From the repo folder with the **prod** Neon URLs exported (same values as the
`DATABASE_URL` / `DIRECT_URL` CI secrets — resolve uses the direct URL):

```powershell
# 1. Verify FIRST — expect all migrations listed as "not yet applied" and the
#    P3005 note. Only continue if the schema already matches the code (the app
#    runs fine against this DB). If any show as genuinely pending NEW DDL, stop.
npx --yes prisma@6.19.3 migrate status

# 2. Mark every existing migration as applied, in order:
$migrations = @(
  "0_init",
  "20260617120000_add_user_timezone",
  "20260618000000_superops_billing",
  "20260623000000_subscription_customer_price",
  "20260624000000_rate_limit",
  "20260624010000_three_role_model",
  "20260624020000_crm_opportunities",
  "20260624030000_crm_monthly_commission",
  "20260624040000_salesforce_connector",
  "20260624050000_user_created_audit",
  "20260625000000_crm_fix_annual_mrr",
  "20260625010000_crm_reclassify_by_name",
  "20260625020000_crm_mrr_from_tcv",
  "20260625030000_crm_local_edit_lock",
  "20260626000000_backups",
  "20260626010000_backup_restore",
  "20260626020000_sandbox_purge_audit",
  "20260626030000_opportunity_locked_fields",
  "20260626040000_client_hierarchy",
  "20260627000000_sales_quotas_leads"
)
foreach ($m in $migrations) {
  Write-Host "resolving $m"
  npx --yes prisma@6.19.3 migrate resolve --applied $m
  if ($LASTEXITCODE -ne 0) { break }  # stop on the first failure
}

# 3. Confirm — status should say "up to date"; deploy should apply nothing:
npx --yes prisma@6.19.3 migrate status
npx --yes prisma@6.19.3 migrate deploy
```

After this the **Migrate Neon Database** Action goes green, and future runs only
apply genuinely new migrations. Keep the list above in sync with
`prisma/migrations/` if you ever need to baseline again.

---

## Gotchas
- **Never change `WOLF365_ENCRYPTION_KEY`** after storing connector secrets, or
  you must re-enter them.
- Keep QBO **Sandbox vs Production** consistent: sandbox keys only work against
  sandbox, and the connector's Environment toggle must match.
- Login redirect errors are almost always an Entra redirect URI that doesn't
  exactly match `https://<domain>/api/auth/callback/microsoft-entra-id`.
- Re-run `prisma migrate deploy` whenever future schema changes ship.

---

## Your manual checklist (only you can do these)

These require your accounts, credentials, or decisions — no code.

**Accounts & infrastructure**
- [ ] Create the Neon project; copy pooled + direct connection strings
- [ ] Create/import the Vercel project from this repo
- [ ] Add all env vars in Vercel (Production + Preview)
- [ ] Run `prisma migrate deploy` against Neon
- [ ] (Optional) Attach a custom domain in Vercel

**Microsoft Entra (SSO)**
- [ ] Register the Entra app; capture Tenant ID, Client ID, Client Secret
- [ ] Add redirect URI `…/api/auth/callback/microsoft-entra-id`
- [ ] (Optional) Enable the groups claim for group→role mapping
- [ ] Set `WOLF365_BOOTSTRAP_ADMINS` to your email

**QuickBooks Online**
- [ ] Create the Intuit app; capture Client ID/Secret; decide Sandbox vs Production
- [ ] Add redirect URI `…/api/connectors/quickbooks/callback`

**TD SYNNEX Stellr**
- [ ] From the Stellr Developer Portal: Client ID/Secret, region API base URL,
      OAuth token URL, customers/subscriptions resource paths
- [ ] Confirm the live response field names so the defensive mapping can be verified

**Optional connectors**
- [ ] Hudu base URL + API key
- [ ] SuperOps subdomain + API token + data center

**In-app, after deploy**
- [ ] Sign in → finalize SSO under Security & SSO
- [ ] Connect QuickBooks; configure TD SYNNEX; run syncs
- [ ] Confirm client + SKU mappings
- [ ] Generate → approve → push a real billing run to validate end-to-end
