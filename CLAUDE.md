# Wolf365 — Project Guide (CLAUDE.md)

Wolf365 is a secure Microsoft 365 billing reconciliation and invoicing-staging
SaaS for MSPs. It syncs licensing/customer data from **TD SYNNEX StreamOne
Stellr** and customer/product/accounting data from **QuickBooks Online (QBO)**,
lets accounting users review/adjust pending billing (prorations, discounts,
adjustments), and pushes approved invoices to QBO. Also connects **Hudu** and
**SuperOps** (SuperOps has its own billing pipeline, separate from M365).

> Follow my global engineering standards (`~/.claude/CLAUDE.md`) too — the
> Non-negotiables and Security checklist there always apply. This file adds
> Wolf365-specific facts and commands.

---

## Commands

Node ≥ 20. The lockfile is **pnpm** (`pnpm-lock.yaml`) and CI uses it, but local
dev on Windows uses **npm/npx** (corepack `enable` hit EPERM). Either works; do
not switch the committed lockfile.

```
npm run dev            # next dev
npm run typecheck      # tsc --noEmit  (strict)
npm run lint           # next lint
npm test               # vitest run
npm run build          # prisma generate && next build
npm run db:migrate     # prisma migrate dev   (local schema changes)
npm run db:deploy      # prisma migrate deploy (prod; also run in CI)
npm run db:studio      # prisma studio
```

**Verification gate before claiming done:** `typecheck` → `lint` → `test` →
`build`, all green, results reported honestly.

---

## Stack & deployment

- **Next.js 15** (App Router) + **React 19** + **TypeScript strict**.
- **Prisma 6** over **Neon Postgres**. Migrations applied in prod by the GitHub
  Action `.github/workflows/migrate.yml` (`prisma migrate deploy`).
- **Auth.js v5** (`next-auth@5 beta`) + **Microsoft Entra ID** SSO; DB-backed,
  HTTP-only sessions. Bootstrap admins via `WOLF365_BOOTSTRAP_ADMINS`.
- **Vercel** (Pro: 300s functions). `vercel.json` sets framework, build command
  (`prisma generate && next build`), and a daily cron at `/api/cron` (06:00 UTC).
- **Tailwind** + shared primitives in `src/components/ui/primitives`.
- **Vitest** for unit tests. **Outbound static egress IP** via QuotaGuard proxy
  (`QUOTAGUARDSTATIC_URL`) for production QBO IP allowlisting.

---

## Layout

- `src/app/(app)/` — authenticated app pages (dashboard `page.tsx`, `clients/`,
  `billing/`, `superops-billing/`, `admin/`, `reports/`, `mappings/`,
  `exceptions/`, `settings/`).
- `src/app/api/` — route handlers (`connectors/quickbooks/callback`, `cron`,
  `export`, `auth/[...nextauth]`).
- `src/connectors/` — connector framework: `registry.ts`, `types.ts`,
  `runtime.ts` (`buildContext`, secret save/load), `http.ts` (`connectorFetch`
  — retrying undici client + proxy agent), and one dir per integration
  (`quickbooks/`, `tdsynnex/`, `hudu/`, `superops/`).
- `src/lib/billing/` — **pure** business logic + tests: `proration`, `pricing`,
  `line`, `state` (state machine), `generate`, `recurring` (MRR/ARR/cost/margin),
  plus I/O at the edges: `service.ts`, `push.ts` (push run → QBO invoice).
- `src/lib/` — `crypto.ts` (AES-256-GCM secret encryption), `redact.ts`,
  `rate-limit.ts`, `rbac.ts`, `auth/`, `mapping/` (`materializeClients`),
  `reconciliation/` (discrepancy detection), `audit.ts`, `db.ts`.
- `prisma/schema.prisma` + `prisma/migrations/` (idempotent).

---

## Wolf365-specific rules (learned the hard way)

- **Pure billing math stays pure.** All MRR/ARR/cost/margin/proration/pricing
  logic lives in `src/lib/billing/*` as dependency-free, unit-tested functions.
  Map Prisma `Decimal` → `Number` once via `toRecurringInput` in `recurring.ts`;
  don't re-inline coercions per page.
- **Invoices are NEVER auto-pushed.** A run pushes to QBO only when `APPROVED`
  (or retrying `PARTIALLY_FAILED`) **and** a human triggered it. Lines without a
  mapped QBO item are skipped, never silently dropped → run goes
  `PARTIALLY_FAILED`. Respect the `state.ts` transitions; assert illegal ones.
- **Encrypt connector secrets** with `crypto.ts` before DB storage; never log or
  echo them. Route errors through `redact.ts`.
- **QBO OAuth:** auth-code grant, scope `com.intuit.quickbooks.accounting`,
  refresh-token rotation, **revoke on disconnect but always clear the local
  connection even if revoke throws**. Use the **OpenID discovery document**
  (`discovery.ts`) for endpoints with a constants fallback. Redirect URI must
  match Intuit exactly (prefer `AUTH_URL`). Callback stays a GET route.
- **TD SYNNEX Stellr:** OAuth client-credentials. Credentials are
  **reseller-scoped** — confirm the reseller number matches the data you expect
  (a scoping mismatch returns 0 records, not an error). Customers:
  `/api/v1/cloud/customers?pageNo=1&pageSize=100` (page params are **required**).
  Subscriptions per customer fetched in parallel (concurrency 6); set
  `maxDuration` high for long syncs. `customerPrice` = suggested bill price,
  `unitCost` = our cost (margin = price − cost).
- **SuperOps billing is separate** from M365 agreement billing (its own
  import → review → push pipeline and DB models).
- **Static IP / proxy:** `connectorFetch` uses **undici's own `fetch`** + a
  `ProxyAgent` with an **explicit Basic auth token** (undici ignores
  URL-embedded creds). Degrade to no-proxy on a malformed proxy URL.
- **Migrations must be idempotent** (`IF NOT EXISTS` / guarded `DO` blocks) — a
  failed migration once wedged the whole chain.
- **CSP:** per-request nonce in `src/middleware.ts`
  (`script-src 'nonce-…' 'strict-dynamic'`). Don't reintroduce inline scripts.
- **Honest UI:** dashboard and lists show real synced figures (counts, MRR/ARR,
  margin) and flag problems loudly (e.g. negative-margin clients) with links to
  fix them. Empty states explain how to populate data.
- **Compliance:** the app targets Intuit production security requirements. Don't
  weaken CSP, token handling, or encryption to make something easier.

---

## Git

- Develop on the designated feature branch; the main session branch has been
  `main` per explicit instruction. Never push elsewhere without permission.
- Small, descriptive commits. **Do not** create PRs unless asked.
- Never put secrets, credentials, or model-identity strings in commits/PRs/code.
