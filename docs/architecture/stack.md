# Stack

Oct 8, 2026 · @Martin

Restro runs as one TypeScript repository deployed as two small Node processes, a Next.js web app and a pg-boss worker, on Railway in Amsterdam. Postgres holds both the data and the job queue, Cloudflare R2 serves menus, images and backups, and Cloudflare's free proxy guards the web app. At pilot traffic the platform should cost about $10–15 a month: every choice favours few moving parts and free tiers over scale, because traffic is low (Martin, 2026-10-08).

## At a glance

&#91;embedded content: runtime map · 2 processes, 1 database, 3 outside systems\]

Guests load menus from the CDN and send only carts and payments to the web app. The worker alone calls Barsy; Barsy's webhooks land in the web app's inbox.

## Choices

Each layer takes the most widely used tool that has a free or usage-priced tier, so AI agents have the most examples to learn from and the bill tracks real traffic. Versions are pinned exactly at setup.

| Layer | Choice | Why | Not chosen |
| --- | --- | --- | --- |
| Language | TypeScript, strict mode | Type errors catch most AI mistakes before code runs | — |
| Runtime | Node.js 24 LTS; Node 26 once it reaches LTS (expected late October 2026) | Every library and host supports Node first; pg-boss needs Node 22.12 or later | Bun: less example code, occasional library gaps |
| Repository | One repo, pnpm workspaces | Web, worker and shared packages in one place agents can follow | Several repos |
| Web framework | Next.js 16.4.x, the newest minor of the 16.x line (16.x is Active LTS); security patches applied within 48 hours | Most example code of any framework; server-rendered first paint for weak basement signal | Vite + Hono: two apps to wire together |
| UI | Tailwind CSS, shadcn/ui, react-hook-form + Zod for forms, TanStack Table, Recharts for owner stats | AI writes these reliably; light on the guest's phone | Heavy component suites |
| Validation | Zod | One validator for the editor, the Barsy adapter, the publisher and the API (checks V1–V12) | — |
| Database | Postgres 17 on Supabase (EU, Ireland, D43, D54), pinned; database host only, Data API, Auth and Storage off; Pro before money flows | Relational and transactional, as the data model requires; one small instance covers pilot traffic | Serverless Postgres: the worker polls, so it never sleeps and costs more |
| Data access | Drizzle ORM + drizzle-kit migrations | Reads like SQL, so queries can be reviewed; row-level security policies live in the schema | Prisma: heavier, hides the SQL |
| Background jobs | pg-boss 12, inside the same Postgres | No extra service; cron schedules, retries with backoff, dead-letter queues, debounce; jobs are queued in the same transaction as the data write (Drizzle adapter) | Inngest or Trigger.dev: another vendor; BullMQ: needs Redis |
| Files and CDN | Cloudflare R2 (EU jurisdiction) behind Cloudflare's CDN | No egress fees; snapshots, image variants and backups fit the free tier | S3 + CloudFront: egress fees |
| Images | sharp, in the worker | Makes each CDN variant once | Paid image services |
| Venue-admin login | Better Auth with its organization plugin | Free; accounts stay in our Postgres; tenant = organization with owner/admin/member roles, invitations, and a staff role that can only mark items sold out. Email and password (magic links optional), so a slow email never locks staff out mid-service | Clerk: another vendor holding staff accounts |
| Email | Resend | Login links, invitations, the daily ops digest | — |
| Payments | Payments are a connector kind (D98): one `PaymentProvider` interface (hold, capture, release, refund, hosted checkout, status notifications) with capability flags (hold and how long, Apple Pay and Google Pay, split), and one package per provider. myPOS is the first candidate, pending the feasibility check (T80); Stripe is second | The venue is the merchant on its own payment account at the provider, and Restro never holds money; Restro's fee is invoiced to the venue. The platform knows no provider's name. Whether guests can pay through barsy's payment link when they order from the menu is a separate open question (Q39, Q58) | Restro holding funds; building on one provider first |
| Barsy access | One typed client, split into `read` and `write`; native `fetch` with a 30-second timeout | Agents cannot invent endpoints; every write is a named call on an allowlist Martin approves (order placement, webhook subscribe and restart; POS registration stays manual) | Ad-hoc calls |
| Dates and money | date-fns + @date-fns/tz; integer minor units; `Intl.NumberFormat` | Past-midnight schedules in Europe/Sofia; Barsy's rounding in one module | Floats |
| Interface text | next-intl (BG, EN) | Interface strings only; menu text comes from snapshots | — |
| Tests | Vitest, fast-check, Playwright, MSW with recorded Barsy responses | Agents can check their own work; property tests guard "more cautious than the till" | — |
| Code checks | Biome (lint + format), `tsc --noEmit`, dependency-cruiser | One fast tool, import rules that enforce the architecture, and gitleaks so no secret is ever committed | ESLint + Prettier: more configuration |
| Hosting | Railway, EU West (Amsterdam): web and worker in one project (Postgres on Supabase, D43) | Always-on processes for the queue; usage-based billing suits low traffic. Cloudflare's free proxy sits in front: rate limits, Turnstile bot checks, and a cached static guest page that keeps menus up even if Railway is down | Vercel: Hobby is non-commercial, Pro is $20 a seat plus a separate worker host. A VPS is cheaper still, but someone has to run the server |
| Monitoring | Sentry (EU region, no personal data), guest events in our own Postgres, deep health checks, phone alerts through a Telegram bot | Errors; funnel data we own and Martin can query in SQL or Power BI (H1–H3); a phone alert within a minute when orders or money get stuck | PostHog: another vendor and a consent question; paid APM |

## UI libraries: in use, and considered but not adopted

Already in the admin, and kept: Sonner (the one Toaster), vaul (drawers), clsx and class-variance-authority (class names), `@hello-pangea/dnd` (the composer's drag and keyboard reorder), tw-animate-css (shadcn's enter and exit classes). A guest template adds none of them (the designer guide's §9.1: React and nothing else).

Considered and not adopted, so nobody proposes them again (D109):

| Library | Why not |
| --- | --- |
| motion (Framer Motion) | A template adds no animation library (§9.1) and its motion is plain CSS; the admin is calm shadcn (D107) |
| NumberFlow | A price must never animate: prices are `price.text` and money stays integer minor units (rule 8); a rolling number is motion without a tap |
| cmdk | A keyboard-first command palette is the opposite of D107 for an owner who is not a tech person |
| zustand | Server components read and server actions write (U4), so there is no client store to hold |
| Virtuoso, virtua | Every item stays in the markup; virtualising a long list is a proposal for Martin after a measurement, never added unasked (row 3 of `.claude/skills/template-review/references/web-interface-guidelines.restro-overrides.md`) |
| base-ui | Radix through shadcn is installed; swapping an installed library is churn |
| next-themes | The admin follows its own theme choice (`apps/web/src/lib/theme.ts`), and the Toaster reads it |
| dnd kit | `@hello-pangea/dnd` runs the composer, the Platform port map uses it, and a keyboard-reorder e2e depends on it |
| Leva | A live panel for tuning values while developing; it has no screen of the product to serve |

## Cost at pilot scale

Production should cost about $10–15 a month before money flows, almost all of it Railway, and about $35–40 once Supabase Pro is on (D43). The usage figure is an estimate; check it against the first month's invoice.

| Item | Per month | Basis |
| --- | --- | --- |
| Railway Hobby plan | $5, which includes $5 of usage | Price page |
| Railway usage above that | about $3–5 | RAM $10 per GB-month, CPU $20 per vCPU-month, egress $0.05 per GB. Estimate: web and worker use about 0.5 GB of RAM in total and little CPU, so about $8–10 of usage |
| Supabase (database) | $0, then $25 | Free plan until money flows, then Pro, which includes about $10 of compute, enough for the smallest instance (D43) |
| Staging environment | about $3–5 while running | Same services, smaller; stopped when not in use |
| Cloudflare R2 + CDN | $0 | Free tier: 10 GB-month of storage, 1 million writes, 10 million reads; egress is free |
| Sentry | $0 | Free plan: 5,000 errors, 1 user, 30-day lookback |
| Cloudflare proxy, Telegram alert bot | $0 | Free plans; guest analytics live in our own Postgres |
| Resend | $0 | Free tier: 3,000 emails a month, 100 a day |
| GitHub, uptime checks | $0 | Free plans |
| Domain | about $1 | Roughly €10–15 a year |
| Payment fees | $0 to Restro | Paid by the venue (D7) |

Through about 10 clubs hosting stays as D43 set it (D103). The bill grows with the number of clubs:

| Clubs | Per month | What changes | Ceiling |
| --- | --- | --- | --- |
| Pilot | about $10–15, then $35–40 | As above; Supabase Pro once money flows | n/a |
| About 10 | about $55–80 | Same split; a slightly larger Supabase instance and Resend's paid tier; agent time goes into portability, not into bigger plans. Point-in-time recovery is decided at go-live with paying clubs | $100 |
| About 50 | about $200–300 | A medium Supabase instance, two web replicas on Railway Pro, Sentry Team, Resend's next tier; past the $100 trigger, so the plans are reviewed when it fires (see Open choices) | $500 |

The figures and ceilings leave out the AI coding subscription and the venues' payment fees.

What would raise the bill: Railway Pro at $20 a month (includes $20 of usage, adds team seats), Sentry Team at $26 a month, or traffic beyond the free tiers. The AI coding subscription and the venues' payment fees are not counted here.

## Repository and boundaries

One repository holds two deployable apps, five shared packages and one package per payment provider; CI checks which may import which, so the architecture holds even when nobody reads the code line by line.

```text
restro/
├─ apps/
│  ├─ web/        Next.js: guest shell + QR face, venue admin, order API, webhook receivers
│  └─ worker/     Node: pg-boss jobs (Barsy sync, resolve, publish, images, outbox, health, backups)
├─ packages/
│  ├─ core/       field types, Zod schemas, apply(), resolver, checks V1–V12, snapshot builder
│  ├─ shell/      population rules R1–R14 → view model (pure: no React, no database)
│  ├─ db/         Drizzle schema, migrations, row-level security, tenant-scoped client
│  ├─ barsy/      typed Barsy client (read/ and write/), mappers, recorded fixtures
│  ├─ payments/   PaymentProvider interface and capability flags (no provider's name)
│  └─ <provider>/ one package per payment provider, like barsy/ (myPOS first, pending T80)
├─ docs/          decisions, runbooks (restore, onboarding a venue, live-night incidents)
└─ CLAUDE.md      conventions, commands, the nine rules, what agents must never do
```

Import rules, checked in CI by dependency-cruiser:

- `shell` and the faces in `apps/web` never import `db`, `barsy` or a payment provider package.
- Only `core/apply` imports the write side of `db`.
- Only `apps/worker` imports `barsy`. Its `write` part exposes only the calls on Martin's allowlist: order placement (outbox) and webhook subscribe and restart (onboarding, `barsy-health`). POS registration stays a manual, admin-only action.
- `apps/web` never calls Barsy; it reads Barsy state from Postgres and only verifies webhook signatures.
- Only `apps/worker` imports a payment provider package and calls a provider (capture, release, refund, test call). The web app never imports one: its inbox checks a notification's signature through that provider's part in `apps/web/src/connectors/` (where POS-specific web code already lives), stores it, and reads payment state from Postgres (D98).
- Packages never import apps.

## How the nine rules are enforced

Every non-negotiable rule from the Data architecture tab is backed by a check that fails CI or by a database constraint, never by memory alone.

| Rule | Enforced by |
| --- | --- |
| 1. One write path | Import rule: only `core/apply` writes; every `field_values` row requires its layer, source and job (NOT NULL) |
| 2. Every value keeps its source and layer | NOT NULL and check constraints; the `events` table is append-only (the app's database role has no UPDATE or DELETE on it) |
| 3. External ids stay in the backend | The snapshot Zod schema rejects unknown keys; a contract test fails if a Barsy id appears in any snapshot |
| 4. The shell reads only snapshots | Import rule; the shell's only input type is `Snapshot` |
| 5. Our layers only make the menu more cautious | Property tests (fast-check) on the resolver: whatever the layers hold, an item Barsy hides or takes off sale is never orderable, and an orderable item's price always equals Barsy's |
| 6. Absence is a deletion only after a complete full pull | Integration test with a failed page in the fixture: nothing is hidden |
| 7. Sync never writes into Barsy | `barsy/write` holds only the named calls on Martin's allowlist (order placement, webhook subscribe and restart); the venue-approved translation push (D26) would be added there by name |
| 8. Integer minor units, Barsy's rounding | One `money` module; Zod `.int()` on every amount; tests built from Barsy's own calculation examples |
| 9. Barsy accounts | One API user per integration per environment; unique `pos_registrations.venue_id`; the outbox command schema requires a `uuid`; staging configuration refuses production hosts |

## Background jobs

All background work runs as pg-boss queues in the worker. A job that depends on a data change is queued in the same transaction as that change, so a crash can never leave one without the other.

| Queue | Started by | Notes |
| --- | --- | --- |
| `barsy-inbox` | each stored webhook, same transaction | Parses ids and operations |
| `barsy-refetch` | `barsy-inbox` | Debounced 10 s per integration, type and id; re-fetches for every venue on the installation |
| `barsy-reconcile` | every 10 minutes per venue | Tree checksum, then articles changed since the cursor. If Barsy's timestamps carry no time-zone offset, the overlap widens to 65 minutes so the autumn clock change cannot hide an hour |
| `barsy-stock` | every 5 minutes, opted-in venues | Optional stock-based sold out |
| `barsy-full-pull` | nightly per venue, default about 12:00 local (P31, not yet confirmed) | The only job allowed to conclude a deletion |
| `barsy-health` | daily | Webhook subscriptions; restarts and reconciles a deactivated one |
| `menu-resolve` | `apply()`, same transaction | Debounced per menu |
| `menu-publish` | `menu-resolve` | 30-second merge window; writes snapshot and pointer to R2 |
| `asset-variants` | new or changed image | Downloads, makes variants with sharp, uploads |
| `order-outbox` | checkout, as the confirmed payment route defines it | Retries with backoff and the same server-generated `uuid`; test installation only until D33 is met |
| `payment-events` | each stored payment notification, same transaction as the inbox write (signature checked in the web app first) | Updates payment, hold and share state |
| `payment-outbox` | a command that needs money to move: accept (capture), skip after accept (refund), release | Calls the provider with an idempotency key, so a retry never charges twice; retries with backoff (D98, D99) |
| `request-queue-close` | each venue's service day end, or the DJ closing the night earlier | Releases every unplayed hold through `payment-outbox` and records the night's totals (D99) |
| `health-check` | every minute | Outbox age, payment-to-Barsy delay, snapshot age, webhook lag. Past a limit it switches that venue to menu-only and alerts by Telegram |
| `reconcile-money` | nightly, after the service day ends | Payments vs Barsy bills vs our orders (P8) |
| `db-backup` | hourly during service hours, nightly otherwise | `pg_dump` to R2, kept 30 days |
| `ops-digest` | daily | Email to Martin: failed jobs, webhook health, sync lag |

Failed jobs land in a dead-letter queue and show in the pg-boss dashboard, served behind the venue-admin login for Restro staff only.

## Data, tenancy and secrets

One Postgres database holds everything; the database itself, not just the code, keeps venues apart. Inside it, separate schemas hold the core, auth, jobs, guest events, money and bookings. Events and money have no foreign keys into the core except by id, so they can move to their own instance without touching the menu engine (D103).

- **Tenancy.** Every tenant-owned table carries `tenant_id`. Row-level security limits each query to the tenant set for its transaction (`set_config('app.tenant_id', …)`), so a forgotten filter in AI-written code returns nothing instead of another venue's data. The app connects with a role that cannot bypass row-level security; migrations run with a separate owner role.
- **Guests.** Guests never read the database for the menu: they get snapshots from the CDN. The order API resolves the table token to venue and tenant.
- **Guest events.** Append-only, free of personal data, and in their own schema from the start. One ingest module writes them in batches and never joins core tables (D103).
- **Payment credentials.** Each venue's payment account credentials are sealed in the application like the Barsy credentials below, after the platform checks them with a test call (D98).
- **Barsy credentials and webhook secrets.** Encrypted in the application (AES-256-GCM) before they are stored. The key for Barsy credentials lives only in the worker's environment; the key for webhook secrets only in the web app's. The Data architecture tab says "secret store, never in the database"; this keeps plaintext out of the database without paying for a secret manager, and needs Martin's OK (P38).
- **Backups.** `pg_dump` to R2 every hour during service hours and nightly otherwise, kept 30 days. Supabase's own backups are a second copy; point-in-time recovery is decided at go-live with paying clubs. A restore from the R2 dumps is rehearsed at least once before the first club goes live (D103), from the runbook in `docs/`.
- **Retention.** Database space is limited by the Supabase plan, and privacy law needs limits anyway: raw Barsy records, the webhook and payment inboxes, events, IP addresses and device ids each get a retention period, set with the legal check (D25).
- **Card data.** None touches our servers: guests pay on the payment provider's hosted checkout (D98).
- **EU and privacy.** Railway Amsterdam, Supabase Ireland (D54), R2 with EU jurisdiction, Sentry's EU region with personal data switched off. Before the first guest: a privacy notice and terms for guests, and a data processing agreement with each venue that says who is controller and who is processor.

## Environments and delivery

Code reaches production only through a green pull request and a check on staging; no environment except production ever writes to a live venue's Barsy.

| Environment | Runs on | Barsy | Purpose |
| --- | --- | --- | --- |
| Local / agent | Node + Postgres (a container or a dev database) | Recorded fixtures (MSW) only | Building and tests |
| CI | GitHub Actions with a Postgres service container | Recorded fixtures | Every pull request, and pushes to `main` and the stage branches (`<stage>/foundation`) |
| Staging | A Railway environment, stopped when idle | Reads: a pilot venue, through its own API user. Writes: the Barsy test installation only (D33) | Martin checks changes before release |
| Production | Railway, EU West | Pilot venues, one API user each | Live |

1. An agent works on a branch per ticket, following `CLAUDE.md`.
2. It opens a pull request per ticket into the stage branch. CI runs the type check, lint, import rules, gitleaks, unit, property, integration and contract tests, and the build. Anything red blocks the merge.
3. A second agent reviews the pull request against `CLAUDE.md` and the nine rules (optional: Claude Code's GitHub Action).
4. After a green CI and review, the lead merges each pull request into the stage branch. Merging to `main` deploys staging; database migrations run as Railway's pre-deploy step.
5. Playwright end-to-end tests run against staging; Martin checks it and promotes the release to production.
6. No production deploys from Thursday to Sunday, 18:00–08:00 local, except fixes Martin approves.
7. Dependency updates arrive as one grouped pull request a month (Renovate), with exact versions; security patches for Next.js and Node go out within 48 hours.

## Monitoring

Martin should learn about a problem from an alert or the daily digest, never from a venue.

- **Errors:** Sentry in the web app and the worker (EU region, personal data off), each error tagged with the request or job that caused it.
- **Logs:** structured JSON logs (pino) in Railway's log view.
- **Health:** the `health-check` job watches outbox age, payment-to-Barsy delay, snapshot age and webhook lag. A paid order that is not in Barsy within 60 seconds pages Martin through a Telegram bot and switches that venue to menu-only.
- **Uptime:** external checks every few minutes on the health endpoint and the webhook URL. Barsy deactivates a webhook subscription after 14 days without a successful delivery.
- **Guest funnel:** anonymous events (menu opened, item added, checkout started, paid) written to our own Postgres. No third-party analytics and no cookies; Martin can query them in SQL or Power BI. They are the evidence for H1–H3 and feed the owner stats (D31).
- **Night promise (D102):** the menu never goes down, because it is static files on the CDN. Platform features (service actions, song requests, bookings) may pause for minutes, never hours: within a minute of the platform turning unhealthy the phone shows "requests paused", and the alert reaches Martin by Telegram. No one is on call until clubs pay for it.
- **Daily digest:** the `ops-digest` job emails failed jobs, webhook health and sync lag every morning.

## Open choices and upgrade paths

Three items need Martin's OK before setup; everything else waits until a trigger below actually happens.

- [ ] **P38. Barsy credentials:** encrypt them in the application (key only in the worker's environment) instead of a separate secret manager. Changes the wording "secret store, never in the database" in the Data architecture tab.
- [ ] **Railway plan at go-live:** Hobby ($5) or Pro ($20). Check at signup whether pull-request environments need Pro.
- [ ] **Point-in-time recovery** (about $100 a month): decided at go-live with paying clubs, not for the pilot (D103).
- [ ] **Changes from the 2026-10-08 review, already applied on this tab; veto any:** Next.js 16.4.x; Postgres 17; only the confirmed payment route gets built; a write allowlist for live Barsy; Cloudflare proxy with rate limits and Turnstile from day one; a cached static guest page; guest analytics in our own database instead of PostHog; Telegram alerts and deep health checks; hourly backups during service; no deploys on busy nights; gitleaks.

| When this happens | Then |
| --- | --- |
| myPOS fails the feasibility check (T80), or a club or market needs another provider | Build the next provider package behind the same `PaymentProvider` interface (Stripe is second, D98) |
| A reliability incident on a service night, or the bill crossing about $100 a month | Review the plans or move a part. Neon, Railway Postgres or a VPS are acceptable alternatives; on Supabase its Data API, Auth and Storage stay off. The move is a redeploy, prepared by the portability work (T85, D103) |
| Restro wants a per-transaction fee after the pilot | Invoice the venue, fixed or a percentage computed from Restro's records of captures; split inside the payment only when a provider offers it (D98). The charging model is open (Q77) |
| Traffic grows | A second web replica on Railway |
| The payment flow outgrows pg-boss | Move only that flow to a workflow engine (Inngest or Temporal) |
| A team joins | Railway Pro (team seats); Sentry Team ($26 a month) |
| Node 26 reaches LTS | One upgrade pull request, tested on staging |

## Sources

Prices and versions as checked on 2026-10-08:

- [Railway plans and resource prices](https://docs.railway.com/pricing/plans)
- [Railway backups](https://docs.railway.com/reference/backups)
- [Railway regions](https://docs.railway.com/reference/deployment-regions)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [pg-boss](https://pgboss.io/): version 12, Node 22.12+, Postgres 13+, cron, retries, dead-letter queues, debounce, transactional send via the Drizzle adapter
- [Next.js blog](https://nextjs.org/blog): 16.4 released 2026-10-06; the 2026-09-30 security release patched the then-newest minor (16.3.8)
- [Node.js releases](https://nodejs.org/en/about/previous-releases): Node 24 LTS, Node 26 Current
- [Better Auth organization plugin](https://www.better-auth.com/docs/plugins/organization)
- [Resend pricing](https://resend.com/pricing)
- [Sentry pricing](https://sentry.io/pricing/)
- [PostHog pricing](https://posthog.com/pricing)
- [Next.js support policy](https://nextjs.org/support-policy): 16.x is Active LTS for the whole major
