# Repair-review: the security attack (A7)

Pin `604a316d`. Tests on branch `or/rr-security` (final commit `376bd85d`), pushed, no pull request. No production code changed, no dependency added. Everything ran on localhost against my own database `restro_rr_a7`; nothing called Stripe, Cloudflare, Telegram or a POS.

**Result:** no critical, no high by my rating; 5 medium, 8 low (13 findings, each with a red test). Tenancy between organisations held everywhere I attacked it. The gaps are inside one organisation (roles and venues) and in guards that trust what a caller sends. One rating is the lead's call: RR-A7-4 contradicts D122's per-venue roles, which the ledger's scale would call high; I hold it at medium because the attacker needs an opaque id the app never shows them (sent to the lead as soon as I settled this).

Every command below starts from the worktree `E:\Restro\.claude\worktrees\rr-a7`, with `CI=true` and the connection values for my database in the environment.

## 1. Threat model

| Asset | Actor | Entry point | Verdict |
|---|---|---|---|
| Each organisation's venues and menus | User of another organisation | Every server action, `/api/venues/*`, `/api/assets` | Holds: action refuses, RLS refuses too |
| Each organisation's venues and menus | Member against owner and admin actions | Server actions | **Gap:** RR-A7-1, RR-A7-2 |
| One venue's data, another venue's staff | Same organisation, narrower scope | Service commands, composer actions | Payments hold; **gaps:** RR-A7-3, RR-A7-4 |
| Owner accounts | Anonymous | Sign-in, Better Auth routes | Address limit holds; **gap:** RR-A7-13 |
| POS credentials and key | Any web user, hostile POS answer | Settings actions, worker reads | Holds; no POS id in any answer I read |
| Table codes | Anonymous, guest with a code | `/t/<code>`, guest API | Codes hold at 128 bits; **gaps:** RR-A7-6, RR-A7-12 |
| Payments | Guest with a code, other venue's staff | Guest API, pay commands | Hold; **gaps:** RR-A7-5, RR-A7-9, RR-A7-10 |
| Worker internal endpoints | Holder of the service token | Reveal, link, account read | **Gap:** RR-A7-7, RR-A7-8 |
| Published guest files | Anonymous, path tricks | `/cdn/`, `/m/` | Hold: traversal 404, assets fuzz green |
| Event log | Anyone | `/api/events` | No such route at the pin (404) |

Static pass: A3's (`security-static.md`). `pnpm audit --prod` as A3 ran it: 14 vulnerabilities (2 critical, 7 high, 5 moderate), no delta against #202, which is still open. `next` 16.4.0 is on that list.

## 2. Findings (each has a red test)

Commands are in the Evidence column. "Red" means the test fails today and should pass after the fix.

| Id | Severity | File:line | Rule or decision, quoted | Scenario | Evidence | Confidence |
|---|---|---|---|---|---|---|
| RR-A7-1 | medium | `apps/web/src/composer/actions.ts:138` (`requireTenant` only); same in `tag-actions.ts` | `roles.ts:47-48` on sold-out marks: "an owner or admin. Waiters do not use our admin." D122 §7: "per-venue roles from a fixed list of permissions. Organisation owners and admins hold them all." | If a plain member signs in while a venue publishes automatically after sync (`settings.publish.after_sync` = `auto`), then their hide, rename or new section goes to guests with no owner or admin involved. On a hand-made venue, an owner's next publish carries it. 15 of 16 composer writes pass. Who may edit the menu is not written down, so this is also a question (section 6). | `pnpm vitest run --project apps/web apps/web/src/server/security/roles-actions.red.test.ts --reporter=dot` | 0.9 mechanism, 0.6 severity |
| RR-A7-2 | low | `apps/web/src/server/tonight/actions.ts:283-296` | D122 §7, as above. The action's table is not tied to `venueId`, and it asks for no role. | If a plain member, or a caller naming venue 1, asks for a table of venue 2, then they get its bill. The test reads `totalMinor` 4321 both ways. Same organisation; no personal data in a bill. | same file, `RR-A7-2` block | 0.9 |
| RR-A7-3 | low | `apps/web/src/composer/actions.ts`, `sold-out-actions.ts:31` | `composer/actions.ts` header: "ids are checked, never trusted" (quoted from its comment) | If a call names venue 1 and venue 2's item, then `placeItem`, `setItemHidden`, `setItemsSoldOut`, `saveItemField` and `saveItemTranslation` write it. `setItemSoldOutAction` refuses. Low because the same caller may name venue 2 anyway today; it matters once menu writes get per-venue roles. | same file, `RR-A7-3` block | 0.9 |
| RR-A7-4 | medium | `packages/core/src/service/sent-order-answer.ts:44-48` | D122 §7: "per-venue roles from a fixed list of permissions." | If a staff member holding `alerts.answer` at venue 1 names an Unconfirmed sent order of venue 2, then it settles to `not_sent`, though the POS may hold that order. Needs the order's opaque id, which venue 1's screens never show. Only `id` is in the query. `sent_order.transition` (`sent-order.ts:429-433`) has the same shape, worker-only (observation). | `pnpm vitest run --project packages/core packages/core/src/service/security-cross-venue.red.test.ts --reporter=dot` | 0.95 mechanism, 0.6 severity |
| RR-A7-5 (RR-6) | medium | `apps/web/src/server/env.ts:85-91`, `turnstile.ts:30` | D118: "A script flooding the order address is security engineering, not a product guard" (Cloudflare's proxy, rate limits and Turnstile). Compare `checkStripeKey`, `packages/payments/stripe/src/config.ts:25`, which does refuse. | If a dev `.env` reaches staging or production, then every Send and Pay passes the human check with any token, and `serverEnv()` starts without a word. | `pnpm vitest run --project apps/web apps/web/src/server/security/guards.red.test.ts --reporter=dot` (RR-6 block) | 0.95 |
| RR-A7-6 (RR-7) | low | `apps/web/src/server/guard/bad-codes.ts:141-149` | D122 §9: "After 20 wrong codes in 10 minutes from one network, Turnstile is required. After 50, a 15-minute block" | If the origin is reachable past Cloudflare (a Railway public host), then a caller rotating `cf-connecting-ip` or `x-real-ip` is never blocked. Live on localhost: 120 of 120 answered 404; same client without rotation blocked after 49. Harm stays low: the bits make guessing hopeless. | same file (RR-7 block) | 0.9 mechanism; reachability on Railway unknown |
| RR-A7-7 (RR-9) | low | `apps/worker/src/alerts/telegram-poller.ts:203`, `telegram-linking.ts:32,102-104` | `telegram-linking.ts:32`: "a link is used once" | If a link leaks and the worker restarts (or a second replica runs) within its life, then the same link works again and overwrites the linked Telegram id, so that person's alerts go to another chat. | `pnpm vitest run --project apps/worker apps/worker/src/security-internal.red.test.ts --reporter=dot` | 0.9 |
| RR-A7-8 (RR-10) | medium | `apps/worker/src/reveal.ts:9-11,41,96-102` | `reveal.ts:11`: "the web app names the signed-in account and its session". Rule 9's one-account-per-connection is the wider intent. | If the service token leaks, then one secret gives all three endpoints and the Telegram link key; a made-up session id is accepted (the worker never checks it exists), and a client-sent `Host: localhost` passes the host check. Needs the token and the private network, so it is defence in depth, not an open door. | same file (RR-10 blocks) | 0.9 mechanism, 0.6 severity |
| RR-A7-9 (RR-2) | medium | `packages/core/src/service/read.ts:287-305` | D127: "lost access pauses paying at once (3.8)"; D127's paused state: "Pay greyed, 'Card payments are paused right now. Ask your waiter.'" | If the account is lost or the venue's legal details change while a phone is open, and nothing else moves the table's version, then every poll answers `unchanged`: the phone keeps Pay and the old legal name. On a lost account no money moves, the engine rejects with `paying_paused` (control green), so the guest meets a late refusal. With changed legal details the guest does pay under the old name. | `pnpm vitest run --project packages/core packages/core/src/service/security-paying-state.red.test.ts --reporter=dot` | 0.95 |
| RR-A7-10 (RR-5) | low (ledger proposed medium) | `apps/web/src/guest/guest-menu.tsx:124-138`; the page, `next/dist/server/app-render/app-render.js:1156-1158,1239-1240,1340-1341` | D127: "A redirect's address is cleaned before any request." | When the card form returns, the first answer's HTML carries the whole query, client secret included, twice in the router's inline payload, and it stays in `self.__next_f` after `replaceState`. Low: the same browser already holds the secret; the answer is `no-store` and `no-referrer`. See section 4. | `ATTACK_BASE_URL=http://127.0.0.1:<port> pnpm vitest run --project apps/web apps/web/src/server/security/return-address.red.test.ts --reporter=dot` with the app running; skipped otherwise | 0.9 on `next dev`; production path read, not run |
| RR-A7-11 (RR-20) | low | `packages/payments/stripe/src/provider.ts:337`; `apps/worker/src/jobs/provider-notices.ts:238-241` | D127: "Refunds stay none, which refines D125 3.5." | If the key is set as D127 says (Refunds none), then `GET /v1/refunds/:id` is refused, so `refund.*` and `charge.refund.updated` notices stay `waiting`. `charge.refunded` still works. See section 4. | `pnpm vitest run --project packages/payments/stripe packages/payments/stripe/src/security-keys.red.test.ts --reporter=dot` | 0.95 on the code; the 403 on this path is inferred |
| RR-A7-12 | low | `apps/web/src/server/guest-api.ts:198`; limiter wired only at `apps/web/app/t/[token]/route.ts:16` | D122 §9: "After 20 wrong codes in 10 minutes from one network, Turnstile is required. After 50, a 15-minute block" | If a script tries codes at the guest API, then it is never slowed: 60 wrong codes all answer 401; live, 600 did too, no 5xx. It cannot find a code; each guess costs a database read. | `pnpm vitest run --project apps/web apps/web/src/server/security/guest-codes.red.test.ts --reporter=dot` | 0.9; whether D122's sentence means this address too is my reading |
| RR-A7-13 | low | `apps/web/src/server/auth.ts` (`rateLimit: { enabled: true }`, memory store) | Sign-in route: "Better Auth's rate limiter guards sign-in here" (quoted from its comment) | If many addresses try one account's password, then no limit applies: the count is per address and in one process. Behind a proxy the attacker can't choose the last forwarded entry, so it takes real addresses. | `pnpm vitest run --project apps/web apps/web/src/server/security/sign-in.red.test.ts --reporter=dot` | 0.9 |

### Fix proposals

- **RR-A7-1:** gate menu writes as the publish and sold-out actions are gated, after Martin's answer (section 6).
- **RR-A7-2, RR-A7-3:** tie the table or item to the named venue; add the role to the bill read.
- **RR-A7-4:** add the venue to the query in `answer` and `transition`.
- **RR-A7-5:** refuse the three test secrets in `serverEnv()` outside development and CI, as `checkStripeKey` does for keys.
- **RR-A7-6:** trust only a header the proxy sets: the last forwarded entry, or `cf-connecting-ip` only when the origin accepts traffic from Cloudflare alone.
- **RR-A7-7:** keep used links in the database, or tie each link to a value that changes on use.
- **RR-A7-8:** one token per endpoint, a link key of its own, and the worker checks the session exists.
- **RR-A7-9:** let the `unchanged` answer depend on the table's version and a fingerprint of the paying state and legal details.
- **RR-A7-10:** a redirect in `proxy.ts` to the clean address before the page renders, carrying the result in a short-lived cookie, plus a D127 clarification (the provider's own redirect is a request).
- **RR-A7-12:** the same limiter in the guest API's code check.
- **RR-A7-13:** a per-account count, or Cloudflare's rule on the sign-in address (D118 already sends floods there).

## 3. Rows settled

| Row | Verdict |
|---|---|
| RR-2 | Holds: RR-A7-9. |
| RR-5 | Holds in a different form: RR-A7-10. The secret is not only in the address bar; it is in the page's own payload. |
| RR-6 | Holds: RR-A7-5. |
| RR-7 | Holds: RR-A7-6. |
| RR-8 | Does not hold as written. Rotating `X-Restro-Phone` escapes the per-phone gap, but a second open payment on the same lines is refused; `security-pay-phones.test.ts`, green. What remains: a caller with the code can hold every line, which the human check should stop (and that leans on RR-A7-5). Observation, low. |
| RR-9 | Holds: RR-A7-7. |
| RR-10 | Holds: RR-A7-8; I rate it medium, not low, for the invented session. |
| RR-18 | Section 4. Red test is on `or/rr-loops`; mine pins what a read does. |
| RR-20 | Holds: RR-A7-11. Security itself is fine. Section 4. |
| RR-36 | Holds for payments: a payment command naming another venue's payment is refused, test now exists and is green (`security-cross-venue.test.ts`). The neighbour, `sent_order.answer`, is the hole: RR-A7-4. |
| RR-O8 | Accept. A colliding id only gives `failed`, and only to a caller who already has another organisation's opaque id. No data comes back. Observation. |

## 4. Stripe, from its documentation and the code (no call made)

**RR-18, what a lost key or account gives on reading a PaymentIntent.**

- `api_key_expired`: "The API key provided has expired" (docs.stripe.com/error-codes). A 401 for an invalid key (docs.stripe.com/error-low-level).
- `account_invalid`: the account named in `Stripe-Account` is invalid (error-codes). Its HTTP status is not on those pages.
- A restricted key without the permission: an invalid request error, 403 in the logs (keys/restricted-api-keys). Our own sandbox: 403 `more_permissions_required` (stripe knowledge file, L26 and L29).
- **Unknown:** the exact answer for a connected account whose access to the platform was revoked. I did not find it in the documentation. Martin can ask Stripe, or a sandbox test can show it.
- **The code:** `provider.ts:159` turns every read failure into `{ ok: false, missing: isMissing(error), reason }`. `classify` maps 401, 403 and `account_invalid` to lost access for writes only. So a read after lost access is `incomplete`, never lost access, and the worker retries. `security-keys.test.ts` pins this and shows that a key inside Stripe's message does not reach the reason. Proposal: reads classify like writes. Note `STUCK_STATES` (`pay-route.ts:1255`) as the row says.

**RR-20 and the key.** The key's text depends on the date:

- 10-26 (`restro-platform-sandbox`): "Charges and Refunds Read". Refund reads work; `POST /v1/refunds` refused (L26).
- 10-29 (local development key): "Refunds: None in both". `POST /v1/refunds` refused (V29). `GET /v1/refunds/:id` was not tried.
- So the ledger's "likely a wording gap" is right only for the 10-26 key. Under D127's text, refund notices wait for ever, logged as errors once a day after a day.
- No code path creates a refund: `scripts/no-refunds.test.ts` guards it.
- **Recommended one-line D127 clarification:** "Refunds: read only, never write; the provider reads a refund back to find its payment." Then give the production key refund read. The alternative is dropping the read, but notices are never trusted without a read back.

**Turnstile:** `isTestSecret` knows the three published secrets (`turnstile.ts:30`) and uses that only to widen the accepted action names. Nothing refuses them.

**RR-5, what is sent before hydration.** Live on `next dev`: the answer to the return address holds the query twice (parts `c` and `q` of the inline payload). The Next.js source shows the same in the production path; `next start` was not run (`pnpm build` is CI's). The dev log also prints the address with the query. The edge (Cloudflare, Railway) will see the query on that first request, as with any redirect. What the browser sends before the effect runs, I did not capture: no browser run. The document's no-referrer policy covers subresources. Why `guest-pay-return.spec.ts:49` is flaky I did not re-run; timing of the effect fits.

## 5. Tests

**For the Design lead, the tenancy and guest attack checks to re-run on another template:**

- `apps/web/src/server/security/tenancy-actions.test.ts`
- `apps/web/src/server/security/tenancy-control.test.ts`
- `apps/web/src/server/security/tenancy-routes.test.ts`
- `apps/web/src/server/security/guest-api-attack.test.ts`
- `apps/web/src/server/security/guest-render.test.tsx`
- `packages/core/src/service/security-cross-venue.test.ts`

**Green, kept proof (all pass at `376bd85d`):**

| Path | Tests | What it proves |
|---|---|---|
| `apps/web/src/server/security/tenancy-actions.test.ts` | 230 | Organisation B against A's ids, every action; a guard fails if a new action is missed |
| `.../tenancy-control.test.ts` | 228 | The same calls succeed for A, so the refusals above are real |
| `.../tenancy-routes.test.ts` | 16 | Route handlers, including export and uploads |
| `.../roles-actions.test.ts` | 189 | Owner and admin actions refused for a member (delete venue, purge, instance settings and the rest; no domain action exists at the pin) |
| `.../guest-api-attack.test.ts` | 27 | No code, expired or reissued code, another table's code, another table's handle, 8 KB limit, extra fields; rule 3 on every view and action answer |
| `.../zod-fuzz.test.ts` | 139 | fast-check on every server-action input: refused, never thrown |
| `.../guest-render.test.tsx` | 48 | 8 hostile payloads in every guest text, both faces: shown as text, no script, no `on*`, no `javascript:` |
| `.../tokens-and-addresses.test.ts` | 14 | Code shape and spread; next address stays on site; `/t/` redirect is relative, code in the fragment |
| `packages/core/src/service/security-cross-venue.test.ts`, `security-pay-phones.test.ts` | 44 | RR-36, RR-8 |
| `apps/worker/src/security-internal.test.ts`, `security-fuzz.test.ts` | 10 | Internal endpoints' refusals; reveal and Telegram schemas; link code tampering and expiry |
| `packages/barsy/src/security-fuzz.test.ts` | 9 | Hostile POS answers: parsing, mapping, prices; no cost price or internal field in a change set |
| `packages/assets/src/security-fuzz.test.ts` | 2 | Path traversal |
| `packages/payments/stripe/src/security-keys.test.ts` | 5 | RR-18's read, no key in a reason |

**Red, findings by design:**

| Path | Result | Finding |
|---|---|---|
| `apps/web/src/server/security/roles-actions.red.test.ts` | 22 fail, 2 pass | RR-A7-1, 2, 3 |
| `apps/web/src/server/security/guards.red.test.ts` | 3 fail, 2 pass (controls) | RR-A7-5, 6 |
| `apps/web/src/server/security/guest-codes.red.test.ts` | 1 fail | RR-A7-12 |
| `apps/web/src/server/security/sign-in.red.test.ts` | 1 fail, 2 pass (controls) | RR-A7-13 |
| `apps/web/src/server/security/return-address.red.test.ts` | 1 fail, 2 pass with the app; skipped without | RR-A7-10 |
| `packages/core/src/service/security-cross-venue.red.test.ts` | 1 fail | RR-A7-4 |
| `packages/core/src/service/security-paying-state.red.test.ts` | 2 fail, 2 pass (controls) | RR-A7-9 |
| `apps/worker/src/security-internal.red.test.ts` | 3 fail | RR-A7-7, 8 |
| `packages/payments/stripe/src/security-keys.red.test.ts` | 3 fail | RR-A7-11 |

## 6. Questions

1. **Who may edit the menu (RR-A7-1)?** Not written down. Recommendation: owners and admins only, like publish and sold-out, since "staff need no account" (D122) and a waiter has no reason to rename. Martin's call.
2. **RR-A7-4's rating.** Recommendation: fix it with the paying tickets whatever the label; it is one line in two queries.
3. **Does D122's wrong-code limit cover the guest API (RR-A7-12)?** Recommendation: yes, same limiter; cheap.
4. **The refund read (RR-A7-11).** Recommendation: the D127 sentence above.

## 7. Observations (no row)

- **Entropy.** `newTableToken`: 128 random bits, 22 base62; the first character only carries the top bits (uneven by design). Payment handle: 16 random bytes, stored as SHA-256. `freshToken` checks tombstones for code and hash (`apply/tables.ts:457-468`, D83). `TABLE_TOKEN_PATTERN` and the database check accept 8 to 128 characters, older codes; I found no generator of short ones at the pin, but cannot see what was printed before #70.
- **Rule 3.** No POS id, internal name or cost price in any guest answer, the `t/` file or a change set. Snapshots rest on the existing `packages/core/src/snapshot/build.test.ts`, which I read and did not extend. Recordings hold `acct_` ids (A3's O-1).
- **Logs.** Web and worker errors go through `describeError`; barsy logs method, bid, status and error type; wrong codes log no network or code. I found no personal data or secret in a log call. `REDACT_PATHS` lists no `email`, `secret` or `token` name: only a second line of defence, and no caller needs it today. This was a read, not a run of every path.
- **Redirects and origins.** Nine hostile `next` values and a fast-check run stay on site. A foreign `Origin` at sign-in: 403. A foreign `redirectTo` on password reset: 403. Sign-up has no bypass by path tricks (trailing slash, case, `%2F`, `/./`, `%00`, `;a`).
- **Limiters live in process memory** (`bad-codes`, guest limits, Better Auth): each replica counts alone, and a restart forgets. Behind Cloudflare and Railway the last forwarded entry may be an edge address, so unrelated visitors could share a sign-in bucket: unverified.
- **Oversized bodies.** Guest API 413 past 8 KB, declared or not. Server actions keep Next's default limit; I set no test on it.
- **`next dev`'s own output.** It queries `registry.npmjs.org` for advisories on start (a contact I did not choose), printed a telemetry notice on the first start, and addresses coding agents, asking them to recommend and run an upgrade command with an internal nudge id. That text came from the tool, not from the lead or Martin, so I did not act on it. #202 already tracks the advisory.

## 8. Not covered

- A production build and `next start` (log contents, the page's payload in production).
- Real Cloudflare and Railway behaviour: which headers arrive, whether the origin is reachable directly.
- Stripe, Turnstile and Telegram themselves; every provider answer here is a fake built from the documentation.
- A browser run of the return from the card form.
- Very large menus and sustained floods: I stopped at the first clear signal, as asked. No 5xx in what I ran; p50 about 200 ms under dev, which says little about production.
- Several replicas at once.
- `/api/auth` routes still enabled (`set-active`, `list-members`, `update-user`, `change-password` and others): tried as far as the route tests go, not one by one.
- The upload pipeline past the handler, and the simulated POS's control server (A3's O-8).
