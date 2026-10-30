# A3 Static security: security-static.md

Repair-review of or/foundation, agent A3 (plan §4). Pinned commit `16b59a82` (worktree `rr-pinned`, confirmed at that commit). Read-only: nothing edited, committed or run except the commands in section 1. Every row in section 4 is a CANDIDATE (§6), not a finding. Nothing here has been verified by a second reader.

## 1. Commands used

All from `E:\Restro\.claude\worktrees\rr-pinned`.

- `git rev-parse --short HEAD` (16b59a82); `git fetch origin main`; `git merge-base origin/main HEAD` (d5058b63); `git diff --stat origin/main...HEAD` (932 files, 575 non-doc non-test source files).
- `gh issue view 202` (the filed advisories).
- `pnpm audit --prod` (the only network read).
- The `security-review` skill (Skill tool), over `git diff origin/main...HEAD`.
- Manual pass, `grep -rnE` over `apps/` and `packages/` for: `sql.raw`, `dangerouslySetInnerHTML`, `eval(`/`new Function(`, `Math.random`, `BYPASSRLS|set role|disable row level`, `redirect(`, `window.location`, `delete from|.delete(`, `process.env` (outside `apps/web/src/server/env.ts` and the worker config), log calls carrying `email|phone|token|header|body|secret`, secret patterns (`BEGIN PRIVATE KEY`, `sk_live`, `whsec_`, bot-token and Resend-key shapes, DB URLs with passwords), and `.github/workflows` for `pull_request_target` and `secrets.`.
- Targeted reads: `apps/web/src/server/{guest-api,turnstile,env,log,session,auth}.ts`, `apps/web/src/server/guard/bad-codes.ts`, `apps/web/src/server/publish/table-token.ts`, `apps/web/app/api/**/route.ts` (all 11), `apps/web/app/api/payments/notices/[kind]/handle.ts`, `apps/web/src/connectors/{signed-notices,stripe/notices,notices,return-address}.ts`, `apps/web/src/guest/headers.ts`, `apps/web/src/server/assets/{upload-handler,serve-local}.ts`, `apps/worker/src/{reveal,health-server,logger,connectors}.ts`, `apps/worker/src/alerts/{telegram-link,telegram-linking,telegram-poller}.ts`, `apps/worker/src/receipts/email-sender.ts`, `apps/worker/src/jobs/purge.ts` (every `sql.raw` caller), `packages/core/src/service/{engine,grants,guest,identify,pay,night-export,location-pass}.ts`, `packages/core/src/seal/*`, `packages/payments/stripe/src/{config,api}.ts`, `packages/payments/sim-pay/src/env.ts`, `packages/connectors/sim-pos/src/{hosts,scenario-file,control/server}.ts`, migrations 0029 and the table list of 0028-0042 against `packages/db/src/table-access.ts`.

## 2. The security-review skill's output, condensed

I ran the skill's three phases directly (repository context, comparison against existing patterns, data-flow assessment) over the focus areas, rather than through nested sub-tasks. Result under the skill's own filter (exploitable, confidence 8 of 10 or more, no DoS, rate-limit, library-version or log-spoofing items): **no vulnerability reported.** Nothing reached the bar of an exploit path from an anonymous guest, another organisation or a member to code execution, authentication bypass or cross-tenant data.

What was checked and held (the reasons it did not become a row):

- **SQL.** Every `sql.raw` is a constant: the `schema.ts` check patterns, `engine.ts` timeouts (constants), and in `purge.ts` the `table` and `column` arguments, whose callers all pass string literals or the `VENUE_SERVICE_TABLES` constant. All values go through `sql` parameters.
- **XSS.** The four `dangerouslySetInnerHTML` sites inject constant stylesheets or the constant theme-init script. `inactivePageHtml` escapes its (constant) text. CSV export neutralises formula prefixes (`night-export.ts` `cell`).
- **Redirects.** `/login?next=` goes through `safeNextPath` (single leading slash, no `//`, no backslash, no control characters). `/t/<code>` redirects to a relative path built from the published file. No `redirect()` takes a request value.
- **Guest API.** Table code only in `Authorization: Table <code>`, shape-checked before any database read, bodies capped at 8 KB and parsed strictly. `applyService` re-checks that `command.tableId` has `qr_code_hash` equal to the code's hash, is not archived, hidden or a payment table, before any guest command. The payment handle is 128 random bits, stored as a sha-256, and `guestPayment` filters by handle hash, table and venue together.
- **Table codes and tokens.** 22 base62 characters (128 bits), `crypto` random. Payment handles use `randomBytes(16)`. Telegram link codes are HMAC-SHA256 under a purpose-separated key, truncated to 80 bits, compared with `timingSafeEqual`, expiry inside the MAC.
- **Provider notices.** Raw body capped at 1 MiB, HMAC over `t.body`, constant-time compare on equal-length buffers, five-minute tolerance both ways, `livemode` checked against `PAYMENTS_ENV`, stored by event id, never acted on in the route. Nothing about body, signature or header is logged.
- **Stripe keys.** `checkStripeKey` refuses a live key outside production and a test key in production. `withoutSecrets` scrubs key-shaped text.
- **Authorisation on web.** All 11 route handlers authenticate (or, for the guest API and notices, use the code or signature); the admin `proxy.ts` matcher excludes `api/`, and each of the CSV, QR and upload routes calls `getAccess()` itself. Every `'use server'` file calls `requireTenant`/`inSettingsScope`, except `i18n/actions.ts`, which only sets the locale cookie.
- **Worker internal endpoints.** `/internal/*` needs a bearer compared by digest in constant time, a private Host (defence in depth only), POST, a size cap and a strict Zod schema, then `applyService` checks the named actor's permission and writes a Log entry before any sealed value is opened.
- **Crypto.** Seal envelope is ECDH + HKDF-SHA256 + AES-256-GCM with AAD binding tenant and table or staff member.
- **Logs.** `logError` logs only the root cause's class, code and message (Drizzle's parameters excluded); the worker logger redacts and uses the `describeError` serializer. No hit on request bodies, headers, emails, phone numbers or tokens in any log line of the added code.
- **Secrets.** No live-key shapes, private keys, or credentialed DB URLs outside tests and `.env.example` placeholders. No `.env*` file tracked. CI does not use `pull_request_target`.
- **RLS grep.** No `BYPASSRLS`, `set role` or `disable row level security` in app code (only comments that forbid it, and migration comments about the owner role). Every table created in 0028-0042 appears in `table-access.ts`; `operators` and `provider_notices` are declared `tenancy: 'system'`.
- **Deletes.** `delete from` appears in app code only in `core/apply/apply.ts` (`source_links`, `placements`, `field_values`: the three allowed kinds), in `purge.ts`, and in test or e2e harnesses (`worker/src/e2e/refunds-harness.ts` is a test harness).

## 3. `pnpm audit --prod` deltas against #202

`pnpm audit --prod` at 16b59a82: **14 vulnerabilities, 2 critical, 7 high, 5 moderate**, the same counts as #202.

| Advisory group | In #202? |
|---|---|
| next (2 critical RCE: GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr; 1 high DoS GHSA-p3m5-59mp-jv5r), `apps__web>next` | yes |
| sharp (high, GHSA-wq5f-xc86-pv6w), `apps__worker>sharp` | yes |
| zod (high, GHSA-mrhx-c7xc-m3w5), `apps__web>zod` | yes |
| undici (4 high, 4 moderate, via `better-auth>vitest>jsdom`) | yes (undici; the table in #202 lists its worst only) |
| esbuild (moderate, GHSA-67mh-4wv8-2f99, via `better-auth>drizzle-kit`) | yes |

**Delta: none.** No advisory outside #202. The new `packages/payments/stripe` and the Resend/web-push/Telegram code add no advisory. One note for #202's own text, not a delta: the four undici advisories at moderate (GHSA-4qv8-2p9j-2685, GHSA-f72v-6w45-q472, GHSA-9fm3-97px-rjf6, GHSA-55wc-3pg8-jfw6) sit under the same path as the high ones, so the same `pnpm.overrides` fix closes them.

## 4. Candidate rows

No candidate is proposed above medium. Format: id | severity | file:line | rule or decision text | scenario | evidence | confidence.

**RR-A3-1** | medium | `apps/web/src/server/turnstile.ts:31-34,58-62` and `apps/web/src/server/env.ts:85-91`
- Rule: D127 Limits and the file's own header: "Fail closed: a failed token, no secret, or an answer for another action is `failed`". #117's note (via plan A7): "nothing refuses a test secret outside dev and CI".
- Scenario: if `TURNSTILE_SECRET_KEY` is one of Cloudflare's published `1x…AA` secrets in staging or production (a copy of the dev `.env`), then siteverify answers `success: true` for any token, and `expected` becomes `[undefined, 'test', action]`, so every Send and every Pay passes the human check, and a script holding one table code can Send and Pay without a person.
- Evidence: `const expected = isTestSecret(secret) ? [undefined, 'test', action] : [action]`; `TURNSTILE_SECRET_KEY: z.string().optional()...` with no environment-aware refusal (compare `checkStripeKey`, which refuses by environment).
- Confidence: 0.6 (needs the misconfiguration; the code has a refusal pattern for Stripe and none here).

**RR-A3-2** | low | `apps/web/src/server/guard/bad-codes.ts:141-148`
- Rule: D122 limits: wrong codes "count against the network they came from (#70)" (`/t/<code>` header comment).
- Scenario: if the web app is reached without Cloudflare in front (staging, Railway's own domain) while an attacker sends many wrong codes, then `cf-connecting-ip` and `x-real-ip` are read before `x-forwarded-for`, so the attacker sends a fresh `cf-connecting-ip` per request and is never counted or blocked. The `x-forwarded-for` branch correctly takes the last (proxy-appended) entry, but is never reached.
- Evidence: `headers.get('cf-connecting-ip')?.trim() || headers.get('x-real-ip')?.trim() || forwarded?.trim()`.
- Confidence: 0.5. Impact low on its own (a code is 128 bits, so guessing is not the risk); it defeats the "Turnstile required" and block tiers of the limiter.

**RR-A3-3** | low | `packages/core/src/service/guest.ts:1246,1255-1262` (also `:989`)
- Rule: D122 §4 limits (per-phone limits' key is "the random value the page made at load", `guest.ts:820`); D127 Limits (a Pay passes Turnstile and the per-phone gaps).
- Scenario: if a script holds a table code and sends each `pay.start` with a fresh 22-character `X-Restro-Phone`, then `payGap`, `pays` and the one-open-payment rule (keyed `tableHash:phone`) never apply to the second request, so many payments can be opened on one table; only `codeRequests` (20 per second per code) and Turnstile remain.
- Evidence: `const subject = \`${target.hash}:${input.phone}\`` with `GUEST_PHONE_PATTERN = /^[A-Za-z0-9_-]{22}$/` (any value of the shape).
- Confidence: 0.4 (I did not trace whether another engine check, such as the knock `seen` lines or the table's order lock, already stops a second open payment on the same lines; A5/A10b should).

**RR-A3-4** | low | `apps/worker/src/alerts/telegram-linking.ts:30,102-104` and `telegram-link.ts:8-9`
- Rule: the file's header: "A code is used once: the poller remembers the ones it has accepted until they run out".
- Scenario: if a link code is leaked in its 15 minutes (a link pasted in a chat) and the worker restarts, or a second worker replica polls, after the owner used it, then `used` (an in-memory `Map`) is empty, the code opens again, and an attacker's group is linked as the venue's alert group (alert text with table numbers goes to it) or an attacker's Telegram user is linked to the staff member of a `person` link, which `telegram_taken` only refuses if the real person already linked.
- Evidence: `readonly used: Map<string, number>` ("The codes accepted so far"), `deps.used.has(start.code)` as the only replay check.
- Confidence: 0.35.

**RR-A3-5** | low | `apps/worker/src/health-server.ts:112-118,215-217` and `apps/worker/src/reveal.ts:97-108`
- Rule: CLAUDE.md rule 3 (internal values stay in the backend) and D122 §9 (the reveal is only for the web's server, over the private network).
- Scenario: if `REVEAL_SERVICE_TOKEN` leaks (one bearer guards `/internal/reveal`, the Telegram-link endpoint and the payment-connection endpoint, and is also the secret the Telegram link key is derived from) or the worker's port is reachable from outside, then the Host check is bypassed with `Host: localhost`, and the caller names any `tenantId`, `venueId` and `actor` (`kind: 'operator'` passes `resolveGrants` for any listed operator id), so every table code and staff PIN of any venue can be revealed. The server listens on all interfaces (`server.listen(port, ...)` with no host).
- Evidence: `isPrivateHost(request.headers.host)` is the only network check; `hasServiceToken(...)`; `RevealActorSchema` accepts `operator` from the body.
- Confidence: 0.35 (it is the documented design, trust placed in one secret and in the private network; the candidate is that blast radius of that one secret is every tenant).

## 5. Observations (true, but no failure scenario worth a row)

- **O-1.** The Stripe sandbox recordings in `packages/payments/stripe/fixtures/recordings/` (27 files) contain five real sandbox connected-account ids (`acct_1UUjd8H6CXJeKV2v` and four more), in a public repo (memory: repo public since 10-19). No keys, client secrets, `whsec_` or email addresses in them (grep). Account ids are not secrets, but they are real; the scrub in `testing/test-scrub.ts` does not mask `acct_`.
- **O-2.** The guest CSP (`apps/web/src/guest/headers.ts`) sets only script, frame and connect; no `default-src`, `object-src`, `base-uri` or `frame-ancestors`. This is stated as intended ("It sets only these three directives"), so the Pay page can be framed by another origin. No scenario found that moves money without the guest's own taps.
- **O-3.** `process.env` is read with a default parameter outside the two env modules in: `apps/worker/src/connectors.ts:45`, `apps/web/src/connectors/{notices,providers,server}.ts`, `apps/web/src/guest/{headers,cdn}.ts`, `apps/web/src/server/publish/table-token.ts:43` (raw `NEXT_PUBLIC_CDN_BASE_URL`, only an `https?://` regex check), `apps/web/src/server/{assets/index,publish/store}.ts`, `apps/web/app/api/payments/notices/[kind]/route.ts:17` (passes whole `process.env` to the connector). `PAYMENTS_ENV` is validated where read; the others are trusted deployment values.
- **O-4.** `Math.random` is used for backoff jitter (`worker/jobs/breaker.ts:181`, `payment-breaker.ts:105`, `web/guest/services-client.ts:397`) and for a test-kit reference (`core/connectors/service/testing/checks-write.ts:51`). No entropy-critical use. Codes, handles, ids and tokens all use `crypto`.
- **O-5.** `provider_notices` (system table, no tenant RLS) grants `restro_app` SELECT, INSERT and UPDATE (`table-access.ts:181`); it holds provider event ids and account refs of every tenant. A tenant-scoped transaction could read other tenants' notice rows if code ever queried it outside the worker job; left to A4.
- **O-6.** `pay.start`'s repeat branch (`pay.ts` `handle`, "A repeat of the same tap finds its payment") replaces `handle_hash` for the row found by `actionId`. `actionId` is any client UUID; a second phone at the same table would need the first phone's actionId (a random UUID) to take over its payment handle. Same-table trust, unguessable key; not raised.
- **O-7.** A guest's `receiptEmail` makes the worker send a real email via Resend, from a sender display name made from the venue's name (`senderName` strips header-splitting characters). Only after a payment closes and only to the address the payer typed; Turnstile guards the Pay. Not a spam vector worth a row unless Pay's human check fails open (RR-A3-1).
- **O-8.** The shared-device PIN guard (`PinGuard`) and the guest limiters are in process memory (`identify.ts` header), so they reset on restart and do not add across replicas. A 4-digit PIN with five tries per five minutes per device stays slow for one device; across replicas the budget multiplies.
- **O-9.** `sim-pos` control server with no token accepts only loopback binds, but then a web page in the developer's browser could POST to `127.0.0.1:<port>/control/api/*` (no Origin or Host check). Development tool only; the worker refuses the simulator in production (`hosts.ts`).
- **O-10.** `apps/web/app/api/assets/route.ts` lets any signed-in member of an organisation upload (no role check); the Origin check uses `x-forwarded-host ?? host`, which only a browser's own `Origin` makes meaningful. Predates this branch as far as I can tell (not re-diffed).

## 6. What I could not cover

- **Dynamic behaviour.** No call was made as organisation B against A's ids, no fuzzing, no flooding: that is A7. Everything above is from reading code.
- **Per-function authorisation in every server action.** I checked that each `'use server'` file authenticates through `requireTenant`/`inSettingsScope`, not that each exported function enforces the right role for its action (the `canManageIntegration`-style checks); A7 covers this.
- **The `security-review` skill's sub-task fan-out.** I did the vulnerability and false-positive filtering passes myself in one thread; there was no second independent filter pass.
- **Not read line by line:** `packages/core/src/service/*` beyond `engine`, `grants`, `guest`, `identify`, `pay` (first 420 lines), `night-export`, `location-pass`; `apps/worker/src/jobs/payments.ts` (2,000+ lines) and the other jobs; `packages/payments/stripe/src/provider.ts` (589 lines; only the config and API schemas were read); `apps/web/src/server/tonight/*` data loaders; the `/cdn/` and `/m/` routes; the upload pipeline beyond the handler (`storeImage`, SVG handling); `packages/assets` stores; the whole of `packages/db/migrations/0028`-`0042` (A4's job; I only cross-checked table names and the one SECURITY DEFINER function in 0029).
- **Hostile POS response paths** (the audit-security actor "a hostile POS response") in `packages/connectors/sim-pos` and the worker's readings: not traced.
- **Table-code entropy of legacy codes.** Codes made before #70 keep their old `qr_token` until `seal-table-codes` reaches them; I did not read how old codes were generated (0029 backfills their hash from the plain value).
- **Dependencies:** `pnpm audit` covers the lockfile's advisory database only; it says nothing about unlisted malicious or abandoned packages, nor about dev dependencies (`--prod` only).
