# Stack

Oct 8, 2026 · @Martin · brought up to date for ordering on Oct 22, 2026 (D110–D124) and for paying on Oct 25, 2026 (D125–D127)

Restro runs as one TypeScript repository deployed as two small Node processes, a Next.js web app and a pg-boss worker, on Railway in Amsterdam. Postgres holds both the data and the job queue, Cloudflare R2 serves menus, images and backups, and Cloudflare's free proxy guards the web app. At pilot traffic the platform should cost about $10–15 a month: every choice favours few moving parts and free tiers over scale, because traffic is low (Martin, 2026-10-08).

## Kickoff amendments (2026-10-08)

These override the rest of this tab where they differ; stages are in the Stage plan tab of the live document (not mirrored here).

| Area | Change |
| --- | --- |
| Database | Postgres 17 on Supabase (free plan, West EU Ireland, D43, D54), organisation "Restro", projects `restro-staging` and `restro-prod`. Data API off, own hourly backups to R2. Supabase Pro ($25/month) before money flows. Railway runs only web + worker |
| Barsy freshness | Polling: incremental every 5 min + nightly full pull. No webhooks (D41, D110), so the `barsy-inbox`, `barsy-refetch` and `barsy-health` queues are not started; writes are waiter actions only (D110) and barsy has none yet |
| Faces | QR → phone only (D38); faces are packages (`packages/faces/*`) that pass one contract |
| Payments package | `packages/payments` holds the `PaymentProvider` interface and the conformance suite; the simulated provider `sim-pay` and the first real provider, Stripe (`packages/payments/stripe`, D126, D127), are packages beside them. Built with paying in the app (part 2, spec #102) |
| Repo | Public GitHub `MartinKostadinov04/restro` (public since 2026-10-19, so CI is free). Pushing to `main` and merging one's own pull request are forbidden by `CLAUDE.md` |
| Cost | $0 in Stage 1; about $5–10 a month from Stage 3 plus domains; about $30–35 a month once payments run |

## At a glance

&#91;embedded content: runtime map · 2 processes, 1 database, 3 outside systems\]

Guests load menus from the CDN and talk to the web app only through the guest API (D121): the order, Send, a call to the waiter and, from part 2, paying (D127). The worker alone calls a POS, through a connector, and alone calls a payment provider; POS webhooks stay out (D41), while a provider's signed notices reach one web route (D125, D127).

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
| Database | Postgres 17 on Supabase (EU, Ireland, D43, D54; database host only, Data API, Auth and Storage off; Pro before money flows), pinned | Relational and transactional, as the data model requires; one small instance covers pilot traffic | Serverless Postgres: the worker polls, so it never sleeps and costs more |
| Data access | Drizzle ORM + drizzle-kit migrations | Reads like SQL, so queries can be reviewed; row-level security policies live in the schema | Prisma: heavier, hides the SQL |
| Background jobs | pg-boss 12, inside the same Postgres | No extra service; cron schedules, retries with backoff, dead-letter queues, debounce; jobs are queued in the same transaction as the data write (Drizzle adapter) | Inngest or Trigger.dev: another vendor; BullMQ: needs Redis |
| Files and CDN | Cloudflare R2 (EU jurisdiction) behind Cloudflare's CDN | No egress fees; snapshots, image variants and backups fit the free tier | S3 + CloudFront: egress fees |
| Images | sharp, in the worker | Makes each CDN variant once | Paid image services |
| Venue-admin login | Better Auth with its organization plugin | Free; accounts stay in our Postgres; tenant = organization with owner/admin/member roles, invitations, and staff roles per venue. Staff on a shared bar device use a PIN, not an account (D122 §7). Email and password (magic links optional), so a slow email never locks the owner out mid-service | Clerk: another vendor holding staff accounts |
| Email | Resend | Login links, invitations, the daily ops digest | — |
| Payments | Payments are a connector kind (D98): one `PaymentProvider` interface (create a hold, read a payment, capture, release, connect the venue's account, check notices; no refund, D122 §8) with capability flags (hold window, partial capture, Apple Pay and Google Pay, refund notices, smallest payment), and one package per provider. Stripe is the first provider (D126, D125): Payment Intents with manual capture, direct charges on the venue's own account, the card form in the page (`@stripe/stripe-js` in `apps/web`, `stripe` in `packages/payments/stripe`). The worker makes every provider call; the web app takes the guest's pay commands, receives signed notices and loads the card form (D127) | The venue is the merchant on its own account at the provider, and Restro never holds money; Restro's fee is its subscription (D122 §9). The platform knows no provider's name. Stripe holds a wallet card inside Restro's own page, which is what D122 §8's order needs; its documentation and test mode are public. | Restro holding funds; Checkout Sessions (they need the guest's email, D125); myPOS first (parked, D126); building on one provider only |
| Barsy access | One typed client, split into `read` and `write`; native `fetch` with a 30-second timeout | Agents cannot invent endpoints; every write is a waiter action (D110); webhooks and POS registration stay out (D41) | Ad-hoc calls |
| POS connectors | A POS-neutral `ServiceConnector` interface owned by the integration layer, one package per connector (`packages/barsy`, `packages/connectors/sim-pos`), and one conformance kit every connector must pass (D122 §3, D124, spec #64) | The pilot's POS has not answered yet, so the platform is built against a simulated POS and proven by the checks a real connector must also pass; a timeout is always "unknown", never a second write | A connector per POS written ad hoc; waiting for the pilot's POS |
| Dates and money | date-fns + @date-fns/tz; integer minor units; `Intl.NumberFormat` | Past-midnight schedules in Europe/Sofia; Barsy's rounding in one module | Floats |
| Interface text | next-intl (BG, EN) | Interface strings only; menu text comes from snapshots | — |
| Tests | Vitest, fast-check, Playwright, MSW with recorded Barsy responses, the `sim-pos` simulator, and `sim-pay` with the first provider's sandbox for payments | Agents can check their own work; property tests guard "more cautious than the till" | — |
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

One repository holds two deployable apps, six shared packages and one package per payment provider; CI checks which may import which, so the architecture holds even when nobody reads the code line by line.

```text
restro/
├─ apps/
│  ├─ web/        Next.js: guest shell + QR face, venue admin, guest API, payment-notice receivers
│  └─ worker/     Node: pg-boss jobs (POS sync and readings, sending orders, resolve, publish, images, health, backups)
├─ packages/
│  ├─ core/       field types, Zod schemas, apply(), applyService() (core/service), resolver, checks V1–V12, snapshot builder
│  ├─ shell/      population rules R1–R15 → view model (pure: no React, no database)
│  ├─ db/         Drizzle schema, migrations, row-level security, tenant-scoped client
│  ├─ barsy/      typed Barsy client (read/ and write/), mappers, recorded fixtures
│  ├─ connectors/ one package per other connector; sim-pos is the simulated POS (kind `sim`)
│  └─ payments/   PaymentProvider interface, capability flags and the conformance suite (no provider's name); one package per provider beside them: sim-pay (the simulated provider) and stripe (the first real one, D126)
├─ docs/          decisions, runbooks (restore, onboarding a venue, live-night incidents)
└─ CLAUDE.md      conventions, commands, the nine rules, what agents must never do
```

Import rules, checked in CI by dependency-cruiser:

- `shell` and the faces in `apps/web` never import `db`, `barsy` or a payment provider package.
- Only `core/apply` and `core/service` import the write side of `db` (`db-write-only-from-core-write-paths`); a write-target guard test pins which tables each writes. `@restro/core/service` may be imported only by the guest API routes, the admin's server actions, the worker, and the payment provider notice route, which calls only `recordProviderNotice` (D127).
- Only `apps/worker` imports a connector package, `barsy` or one under `packages/connectors/` (`connectors-only-from-worker`, `web-no-connectors`). A connector's `write` part exposes only waiter actions (D110), such as adding a round to a table's bill. Webhook subscription and POS registration are setup, not waiter actions, and stay out (D41).
- `apps/web` never calls a POS; it reads POS state from Postgres, and readings and writes are worker jobs whose outcome reaches the phone through the guest state (D121).
- Only `apps/worker` imports a payment provider package and calls a provider (hold, read, capture, release, test call; never a refund, D122 §8). The web app never imports one: its notice route checks a notice's signature through that provider's part in `apps/web/src/connectors/` (where POS-specific web code already lives), stores it in the platform-level `provider_notices` inbox, and reads payment state from Postgres (D98, D127). The guest page loads the provider's card form from the same folder (D127), into a slot the template places: a face never loads a provider library (D72).
- The payment libraries are named by the build tickets, `stripe` in `packages/payments/stripe` and `@stripe/stripe-js` in `apps/web` (D127); a ticket that does not name a dependency adds none.
- Packages never import apps.

## How the nine rules are enforced

Every non-negotiable rule from the Data architecture tab is backed by a check that fails CI or by a database constraint, never by memory alone.

| Rule | Enforced by |
| --- | --- |
| 1. One write path | Import rule: only `core/apply` writes menu values, and `core/service` alone writes service tables; every `field_values` row requires its layer, source and job (NOT NULL) |
| 2. Provenance | NOT NULL and check constraints; the `events` table is append-only (the app's database role has no UPDATE or DELETE on it). Service rows have no layer: `source`, `actor` and `job_id` are NOT NULL, plus `via`, and append-only service tables allow only SELECT and INSERT (D122 §9) |
| 3. POS ids stay in the backend | The snapshot Zod schema rejects unknown keys; a contract test fails if a POS id appears in any snapshot; a forbidden-values walk checks every guest API answer (D121); a connector's POS ids live in a backend-only reference type |
| 4. The shell reads only snapshots | Import rule; the shell's only input type is `Snapshot` |
| 5. Our layers only make the menu more cautious | Property tests (fast-check) on the resolver: whatever the layers hold, an item Barsy hides or takes off sale is never orderable, and an orderable item's price always equals Barsy's |
| 6. Absence is deletion only after a complete full read | Integration test with a failed page in the fixture: nothing is hidden. A reading with any failed part is `complete: false` in the connector interface, and a property test shows a partial reading ends no sitting, clears no order and lifts no pause |
| 7. Restro writes into a POS only as a waiter would (D110) | Menu sync stays read-only; a connector's `write` part exports only waiter actions (open a bill, add a round, split or move a bill, take a payment, ask for the bill or a receipt, cancel), each declared as such and checked by a test in the connector conformance kit; never back-office writes (items, prices, settings, users); tests only on a test installation. Provider notices are fine (D125): the notice route only checks and stores them. A guardrail test keeps a refund call out of Restro's payment code, and the provider key cannot refund (D122 §8, D125, D127) |
| 8. Money is integer minor units, with the POS's rounding | One `money` module; Zod `.int()` on every amount; tests built from Barsy's own calculation examples |
| 9. POS accounts | One API user per connection per environment; staging configuration refuses production hosts; (later) one POS-registration owner, unique `pos_registrations.venue_id`, and a command schema that requires a server-generated `uuid` |

## Background jobs

All background work runs as pg-boss queues in the worker. A job that depends on a data change is queued in the same transaction as that change, so a crash can never leave one without the other.

| Queue | Started by | Notes |
| --- | --- | --- |
| `barsy-inbox` | each stored webhook, same transaction | Not started: webhooks stay out (D41). Parses ids and operations |
| `barsy-refetch` | `barsy-inbox` | Not started with the webhooks. Debounced 10 s per integration, type and id; re-fetches for every venue on the installation |
| `barsy-reconcile` | every 10 minutes per venue | Tree checksum, then articles changed since the cursor. If Barsy's timestamps carry no time-zone offset, the overlap widens to 65 minutes so the autumn clock change cannot hide an hour |
| `barsy-stock` | every 5 minutes, opted-in venues | Optional stock-based sold out |
| `barsy-full-pull` | nightly per venue, default about 12:00 local (P31, not yet confirmed) | The only job allowed to conclude a deletion |
| `barsy-health` | daily | Not started with the webhooks. Webhook subscriptions; restarts and reconciles a deactivated one |
| `menu-resolve` | `apply()`, same transaction | Debounced per menu |
| `menu-publish` | `menu-resolve` | 30-second merge window; writes snapshot and pointer to R2 |
| `asset-variants` | new or changed image | Downloads, makes variants with sharp, uploads |
| `order-outbox` | a Send, as D122 §4 defines it (the queue's name is set by the ticket that builds it) | Sends a sent order once, with the server-generated `uuid` where the POS deduplicates, and reads the table back after a timeout instead of sending again; test installation only until D33 is met |
| `payment-events` | each stored provider notice, same transaction as the inbox write (signature checked in the web app first, D127) | Maps the provider account to its venue, reads the object back from the provider and updates the payment or the connection; never acts on the event's own copy (D125) |
| `payment` (name set by the ticket that builds it) | a guest's `pay.start`, `pay.returned` or `pay.cancel`, a stored notice, and the recovery job | Every provider call and the whole route: price, create the hold, read it back, queue for a payment table, move the lines, check, close, capture or release (D122 §8, D127). A short check interval so a job starts within about a second, and a `singletonKey` per payment so one job per payment runs at a time. An idempotency key on every provider write, so a retry never charges twice; never a refund |
| `payment-recovery` | worker start, then every 30 s | Finds payments whose last recorded step is `attempting` or unchanged for too long, and finishes, undoes or proves the close from that step; reminds staff about `unconfirmed` holds (D127) |
| `request-queue-close` | each venue's service day end, or the DJ closing the night earlier | Releases every unplayed hold through the `payment` queue and records the night's totals (D99) |
| `health-check` | every minute | Outbox age, payment-to-Barsy delay, snapshot age, webhook lag. Past a limit it switches that venue to menu-only and alerts by Telegram |
| `reconcile-money` | nightly, after the service day ends | Payments vs Barsy bills vs our orders (P8) |
| `db-backup` | hourly during service hours, nightly otherwise | `pg_dump` to R2, kept 30 days |
| `ops-digest` | daily | Email to Martin: failed jobs, webhook health, sync lag |

Failed jobs land in a dead-letter queue and show in the pg-boss dashboard, served behind the venue-admin login for Restro staff only.

Paying (spec #102) runs on the `payment` queue and the recovery job above, and the provider breaker's probes and pauses follow D120's rule per venue account. Ordering adds more worker jobs, named when their tickets are built (spec #64): the readings of a floor and of a table, the read-back after a timeout, the connection breaker's probes and pauses (D120, D122 §6), the pre-opening check, alerts by Web Push and by Telegram (one group per venue, read by long polling, so no new public endpoint), and the retention step of the daily purge. The worker's HTTP server gets one internal endpoint that opens a sealed value for an authorised actor, reachable only over the private network with a service token (D122 §9).

## Data, tenancy and secrets

One Postgres database holds everything; the database itself, not just the code, keeps venues apart. Inside it, separate schemas hold the core, auth, jobs, guest events, money and bookings. Events and money have no foreign keys into the core except by id, so they can move to their own instance without touching the menu engine (D103).

- **Tenancy.** Every tenant-owned table carries `tenant_id`. Row-level security limits each query to the tenant set for its transaction (`set_config('app.tenant_id', …)`), so a forgotten filter in AI-written code returns nothing instead of another venue's data. The app connects with a role that cannot bypass row-level security; migrations run with a separate owner role.
- **Guests.** Guests never read the database for the menu: they get snapshots from the CDN. The guest API (D121) looks the table code up by its hash and resolves it to venue and tenant; the code travels in a header, never in a query string.
- **Service data.** The service tables (sittings, orders, readings, the Log, payments and the rest) are tenant-scoped with row-level security in the same pattern and written only in `core/service`, by `applyService`. The one exception to tenant scope is `provider_notices`, the platform-level inbox of a payment provider's notices: it has no venue, and the web app's role may only insert into it (D127). Log entries are classed `night` (kept 31 days) or `record` (kept 18 months), and the daily purge deletes them by date through its own role (D83, D122 §9).
- **Table codes and PINs.** A table code has at least 128 random bits, stored as a hash with a sealed copy so stickers can be printed again; a staff PIN is stored as a keyed hash for lookup with a sealed copy beside it. Only the worker opens seals (D55, D122 §9).
- **Guest events.** Append-only, free of personal data, and in their own schema from the start. One ingest module writes them in batches and never joins core tables (D103).
- **Payment accounts and keys.** Restro never sees a venue's provider password or key: the owner connects through the provider's own hosted form, and Restro keeps only the account's reference (D125). Restro's own restricted provider key lives only in the worker's environment, and the signing secret for notices only in the web app's. The guest's payment handle is stored as a hash and never logged (D127).
- **Barsy credentials and webhook secrets.** Encrypted in the application (AES-256-GCM) before they are stored. The key for Barsy credentials lives only in the worker's environment; the key for webhook secrets only in the web app's. The Data architecture tab says "secret store, never in the database"; this keeps plaintext out of the database without paying for a secret manager, and needs Martin's OK (P38).
- **Backups.** `pg_dump` to R2 every hour during service hours and nightly otherwise, kept 30 days. Supabase's own backups are a second copy; point-in-time recovery is decided at go-live with paying clubs. A restore from the R2 dumps is rehearsed at least once before the first club goes live (D103), from the runbook in `docs/`.
- **Retention.** Database space is limited by the Supabase plan, and privacy law needs limits anyway: raw Barsy records, the webhook and payment inboxes, events, IP addresses and device ids each get a retention period, set with the legal check (D25).
- **Card data.** None touches our servers: the card form is the provider's own, loaded into the guest page, and the card goes from the browser to the provider (D98, D127). No card digits and no phone, device or IP identifier are stored with a payment.
- **EU and privacy.** Railway Amsterdam, Supabase Ireland (D54), R2 with EU jurisdiction, Sentry's EU region with personal data switched off. Before the first guest: a privacy notice and terms for guests, and a data processing agreement with each venue that says who is controller and who is processor.

## Environments and delivery

Code reaches production only through a green pull request and a check on staging; no environment except production ever writes to a live venue's Barsy.

| Environment | Runs on | Barsy | Purpose |
| --- | --- | --- | --- |
| Local / agent | Node + Postgres (a container or a dev database) | Recorded fixtures (MSW) only | Building and tests |
| CI | GitHub Actions with a Postgres service container | Recorded fixtures | Every pull request, and pushes to `main` and the stage branches (`<stage>/foundation`) |
| Staging | A Railway environment, stopped when idle | Reads: a pilot venue, through its own API user. Writes: the Barsy test installation only (D33). A `sim-pos` server on staging is a later step that needs Martin's OK | Martin checks changes before release |
| Production | Railway, EU West | Pilot venues, one API user each | Live |

`sim-pos` runs locally and in CI as the pilot POS's stand-in; source kind `sim` is refused by the worker in production and hidden from the source picker there.

Paying follows the same rule (rule 7, D125): locally and in CI it runs against `sim-pay`, and the first real provider is tested only in its sandbox, with the provider's test accounts, never on a venue's live account. A notice whose live or test flag does not match the environment is refused.

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
- **Health:** the `health-check` job watches outbox age, payment-to-Barsy delay, snapshot age and webhook lag. When the POS stops answering, or a sent order stays Unconfirmed, ordering pauses and alerts reach staff, the owner and the Restro team (D120, D122 §6). When the payment provider stops answering for a venue's account, or Restro loses access to it, paying pauses (ordering to the bill goes on) and owners and managers are alerted (D120, D125, D127). An outside watchdog (Healthchecks.io, pinged every minute) alerts the Restro team when Restro itself stops.
- **Uptime:** external checks every few minutes on the health endpoint and the webhook URL. Barsy deactivates a webhook subscription after 14 days without a successful delivery.
- **Guest funnel:** anonymous events (menu opened, item added, checkout started, paid) written to our own Postgres. No third-party analytics and no cookies; Martin can query them in SQL or Power BI. They are the evidence for H1–H3 and feed the owner stats (D31).
- **Night promise (D102):** the menu never goes down, because it is static files on the CDN. Platform features (service actions, song requests, bookings) may pause for minutes, never hours: within a minute of the platform turning unhealthy the phone shows "requests paused", and the alert reaches Martin by Telegram. No one is on call until clubs pay for it.
- **Daily digest:** the `ops-digest` job emails failed jobs, webhook health and sync lag every morning.

## Open choices and upgrade paths

Three items need Martin's OK before setup; everything else waits until a trigger below actually happens.

- [ ] **P38. Barsy credentials:** encrypt them in the application (key only in the worker's environment) instead of a separate secret manager. Changes the wording "secret store, never in the database" in the Data architecture tab.
- [ ] **Railway plan at go-live:** Hobby ($5) or Pro ($20). Check at signup whether pull-request environments need Pro.
- [ ] **Point-in-time recovery** (about $100 a month): decided at go-live with paying clubs, not for the pilot (D103).
- [ ] **Changes from the 2026-10-08 review, already applied on this tab; veto any:** Next.js 16.4.x; Postgres 17; only the confirmed payment route gets built; waiter-only writes (D110, which replaced the write allowlist for live Barsy); Cloudflare proxy with rate limits and Turnstile from day one; a cached static guest page; guest analytics in our own database instead of PostHog; Telegram alerts and deep health checks; hourly backups during service; no deploys on busy nights; gitleaks.

| When this happens | Then |
| --- | --- |
| A club or a market needs another payment provider (myPOS is parked, D126) | Build the next provider package behind the same `PaymentProvider` interface (D98) |
| A reliability incident on a service night, or the bill crossing about $100 a month | Review the plans or move a part. Neon, Railway Postgres or a VPS are acceptable alternatives; on Supabase its Data API, Auth and Storage stay off. The move is a redeploy, prepared by the portability work (T85, D103) |
| Restro wants a per-transaction fee after the pilot | Restro's fee is a fixed subscription (D122 §9), so nothing counts a fee per order; a different model needs its own decision (D98, Q77) |
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
