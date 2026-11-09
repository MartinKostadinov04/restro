# The staging chain behind sandbox checks 4 and 5

**Asked for:** Martin, 2026-11-09 — "plan the staging chain behind checks 4 and 5", not just the T25 account guide.
**Revises nothing.** It plans the path for the two checks left open in `docs/deliverables/2026-10-29-stripe-sandbox-checks.md`; check 6 runs separately today and gets its own file.

## 1. What the two checks actually need

Both wait on the same thing in the 10-29 file's words — "a staging deploy at a public HTTPS address" — but they do not need the same amount of it, and that splits the chain in two.

| | Check 4: notices arrive signed | Check 5: Apple Pay and Google Pay |
| --- | --- | --- |
| What it proves | A test connected account's events reach `POST /api/payments/notices/stripe` with valid signatures, and the live/test check holds | The two wallets show on a real phone, with the domain registered through the API; `capture_before` read on a wallet payment |
| Needs a public HTTPS address | Yes — Stripe has to reach us from outside | Yes |
| Needs our own domain | **No.** Railway's own `*.up.railway.app` address is public HTTPS and is enough for a signed notice | **Yes** (§5) |
| Needs Martin's phone | No | **Yes**, with a real card in its wallet (§5) |
| Needs the venue connected to a Stripe test account | Yes | Yes |

So check 4 is reachable as soon as staging runs at all. Check 5 needs the domain too, which is a T25 item we need for the pilot regardless.

The notice route refuses everything until two settings are in place: without `PAYMENTS_ENV` or without `STRIPE_NOTICE_SECRET` it answers 503 and Stripe retries later. On staging those are `PAYMENTS_ENV=staging` and the signing secret of a test-mode endpoint. A live notice is taken only in production and a test one only elsewhere, so a test notice on staging is exactly what check 4 exercises.

## 2. The chain, in order

Each line says who does it and what it waits for. Nothing here can be reordered: every step's prerequisite is the step above it.

| # | Step | Whose | Waits for |
| --- | --- | --- | --- |
| 1 | **Acceptance walk of ordering and paying** on `or/foundation` | Martin | nothing — it can start now |
| 2 | **Merge `or/foundation` into `main`** | Martin's click, the lead prepares it | 1 |
| 3 | **Merge PR #199**, the DB migrate (staging) workflow | Martin's click | 2 (it is already green and mergeable, but it is pointless before the migrations are on `main`) |
| 4 | **Set the five `staging` environment secrets** on GitHub | Martin (§4.1) | 3 |
| 5 | **Run DB migrate (staging)** and approve the run | Martin's click (§4.2) | 4 |
| 6 | **Railway account and project**, EU West (Amsterdam), a staging environment with web + worker | Martin (§4.3) | nothing — it can be done in parallel with 1–5 |
| 7 | **Paste the staging variables** into Railway | Martin (§4.4) | 5 and 6 |
| 8 | **Deploy staging** | Martin's click — agents never deploy | 7 |
| 9 | **A venue on staging pointed at a Stripe test connected account** | the lead, from a ticket | 8 |
| 10 | **Check 4** | an agent; evidence is request ids | 9 |
| 11 | **Domain bought and pointed at staging** | Martin (§4.5) | 6 |
| 12 | **Register the domain for the wallets through the API** | an agent | 11 |
| 13 | **Check 5** on Martin's phone | Martin taps, the agent reads the result | 12 |

Steps 1 and 6 are the two that gate everything and neither waits for the other. If Martin starts Railway (6) while the acceptance walk (1) is in progress, the chain is about a week shorter.

## 3. What the merge to `main` actually carries

`main` is at `d5058b63` (2026-10-21) with 28 migrations. `or/foundation` has 46. The 18 in between are `0028_service_tables` through `0045_guest_events`: the service tables, paying, the breaker, refunds and disputes, the night report, guest events. The first migration run therefore applies every one of them in a single go, and the workflow's log is the record of where it started — nothing has yet been migrated on `restro-staging` through the sanctioned path, and CLAUDE.md forbids doing it from this PC.

A shortcut exists and I recommend against it: letting the migrate workflow run from `or/foundation` as well as `main`. That workflow is restricted to `main` on purpose, and loosening it is a guardrail change (D67), so it would be Martin's call, not mine. The gain is a few days; the loss is the one rule that stops a half-finished schema reaching a database.

## 4. Martin's steps, click by click

Written out in full, with the Railway and Turnstile steps and the whole variable list, in
`docs/runbooks/staging-deploy.md` (Martin asked for it the same day). What follows is the summary.

### 4.1 The five GitHub secrets (about 20 minutes)

GitHub → the repository → **Settings → Environments → staging** (create it if it is not there) → **Add secret**, five times. `docs/runbooks/supabase-setup.md` sections 4 and 5 say where each value comes from; sections 5 and 8 cover generating and later rotating the passwords. Also add a **required reviewer** (yourself) on that environment, so a run always waits for your approval.

| Secret | What it is |
| --- | --- |
| `SUPABASE_CA_CERT` | the text of `prod-ca-2021.crt`, downloaded from Supabase → Database → SSL. A public certificate, not a secret, but it has to be there |
| `STAGING_DATABASE_URL` | the session-pooler connection string for the **app** role (runbook §4) |
| `STAGING_DATABASE_URL_OWNER` | the same string for the **owner** role — used only by the migration itself |
| `STAGING_DATABASE_APP_PASSWORD` | a fresh 32-character password you generate (runbook §5) |
| `STAGING_DATABASE_PURGE_PASSWORD` | a second one, for the purge role (D83) |

A sixth, `STAGING_DATABASE_URL_PURGE`, is the worker's and can wait until step 7.

### 4.2 Run the migration

Actions → **DB migrate (staging)** → **Run workflow**, from `main` → then approve the run when GitHub asks. Leave both `rotate_app_password` and `rotate_purge_password` unticked: they are only for after a password change. It runs the migrations, then the roles, then checks the app role can log in. Tell the lead the run number and nothing else — no passwords, ever, in chat.

### 4.3 Railway (about 20 minutes)

`docs/runbooks/staging-deploy.md` §5 covers this click by click; in short: a Railway account on the Hobby plan ($5, includes $5 of usage), one project, region **EU West (Amsterdam)**, two services from this repository — the web app and the worker, both with an empty root directory and a filtered build command — and a **staging** environment that you stop when you are not using it (about $3–5 a month while running). Do not connect a production environment yet.

Two things the runbook found that this plan did not know when it was written. **Cloudflare Turnstile** needs its own staging widget, because the published test keys must not be used off this PC and without the secret a guest's Send fails its check: five minutes in the Cloudflare account Martin already has. And **there is no deploy configuration in the repository** — no `railway.json`, no Dockerfile — which is now ticket #375, opened on Martin's go-ahead the same day and linked as a blocker of #117 so the board shows the two checks waiting on it.

### 4.4 The staging variables

The whole list is in the runbook §6, split by service. The lead fills a git-ignored file on this PC once the Railway address exists, generating every random key locally, and Martin pastes it into Railway's raw editor — no value through chat. One finding worth having here: both stores can be `local`, which the code allows outside development as long as the setting is explicit, so **staging needs no public R2 bucket and no CDN domain**. The price is that published files are gone after each deploy and a venue has to be published again; a Railway volume fixes that if it becomes annoying.

### 4.5 The domain (check 5 only)

Buy the main domain (T25 names it) and point it at the Railway staging service, or a `staging.` subdomain of it. Then the lead's agent registers that exact host with Stripe through the API and serves the association file. Each host registers separately, and separately again for test and live mode, so the staging host being registered does not register the pilot's.

## 5. What check 5 will ask of you, so it is not a surprise

Apple Pay cannot be tested with a card number. Stripe's own support page is explicit: Stripe's test cards cannot be added to an Apple Pay wallet, so testing needs **a real card already in your phone's wallet**, and with test keys Stripe turns that real card into a test token and **does not charge it**. You will not type a card number anywhere; you will tap the wallet you already use. Google Pay behaves differently and the agent running the check will read Stripe's current page for it rather than assume.

Sources: <https://support.stripe.com/questions/testing-apple-pay-with-stripe>, <https://docs.stripe.com/testing/wallets>, <https://docs.stripe.com/payments/payment-methods/pmd-registration>

## 6. One conflict to settle

`docs/architecture/stack.md` (Environments and delivery, step 4) says "Merging to `main` deploys staging; database migrations run as Railway's pre-deploy step." PR #199 says the opposite: a manual workflow, restricted to `main`, with an approval gate, is "the only way to migrate `restro-staging`". Both cannot be true.

**Recommendation:** keep the manual, approved workflow and do **not** configure a Railway pre-deploy migration step while the schema is still moving — 18 pending migrations is not something to apply automatically on a push. Revisit once the schema settles, which is roughly when production is set up. If Martin agrees, the lead corrects that line in `stack.md`; it needs no decision file.

## 7. Open questions

1. **Does the acceptance walk have to come first?** It is listed first because merging ordering and paying into `main` before Martin has seen them working would put code he has not accepted on the deploy path. *Recommendation:* yes, keep it first; it is also the longest-standing item.
2. **Staging subdomain or the bare domain for check 5?** *Recommendation:* `staging.<domain>`, registered for test mode only, so the pilot's own host is registered fresh and live-mode registration is never done against a test deployment.
3. **`sim-pos` on staging.** To pay there has to be a bill, and a bill comes from a POS; the stack doc says a simulated POS on staging "is a later step that needs Martin's OK". *Recommendation:* yes, for these checks. The guardrail is already in the code — the worker refuses source kind `sim` in production and the picker hides it there — so a yes for staging cannot reach production. Pointing staging at the barsy test installation instead drags a second system into a payment check that has nothing to do with it.
4. **Does Railway's Hobby plan allow choosing a region?** Railway's current documentation does not gate it and the pricing page has no region row; one old forum answer says it is Pro-only. *Recommendation:* try it on Hobby, and if Railway refuses, Pro at $20 a month is not optional — running outside the EU is not a trade we can make (D43, D54). Martin finds out in one click at §5.5 of the runbook.
