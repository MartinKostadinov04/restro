# Runbook: the staging deploy — the GitHub secrets, the migration, Railway

Martin's steps, click by click, for the staging environment that sandbox checks 4 and 5 need
(`docs/deliverables/2026-11-09-staging-chain-for-stripe-checks.md` has the order and the reasons;
`#117`, T25). The database itself is `docs/runbooks/supabase-setup.md`; this file starts where that
one left off, at its section 6.

## 0. Ground rules

- **No secret in chat, in the repo, or in a log.** Passwords and keys go from their source straight
  into a GitHub environment secret or a Railway variable, or into a git-ignored file on this PC.
  Tell the lead "it's set", never the value.
- **The deploy is yours.** Agents never deploy and never run a migration against staging from this
  PC; both are forbidden in `CLAUDE.md`. Every step below that changes staging is a click of yours.
- **Staging is test mode throughout.** Stripe keys start `pk_test_` / `rk_test_` / `sk_test_`, and
  the app refuses a live key outside production. If a value you are about to paste does not start
  with one of those, stop and tell the lead.
- **Nothing here touches a venue's real POS.** Staging reads a pilot venue at most, and writes only
  to a test installation (D33, rule 7).

## 1. What must be true before you start

| | Why |
| --- | --- |
| `or/foundation` merged into `main` | staging deploys from `main`, and the paying code and its 18 migrations are not there yet |
| PR #199 merged | it is the migration runner, and it only runs from `main` |
| Your acceptance walk done | so what reaches the deploy path is code you have seen working |

Section 5 (Railway) does not wait for any of those and can be done first.

## 2. The five GitHub environment secrets (about 20 minutes)

GitHub → the repository → **Settings** → **Environments**. If there is no `staging` environment,
**New environment** → name it exactly `staging`.

In that environment, first set **Deployment protection rules** → tick **Required reviewers** → add
yourself. That is what makes every migration run wait for your approval. Then **Add environment
secret**, five times:

| Secret | Where the value comes from |
| --- | --- |
| `SUPABASE_CA_CERT` | the **text inside** `prod-ca-2021.crt`, downloaded in the Supabase runbook §3. Open it in Notepad and paste the whole thing, `-----BEGIN CERTIFICATE-----` line included. Not a secret, but the run fails without it |
| `STAGING_DATABASE_URL` | the session-pooler connection string for the **app** role (Supabase runbook §4) |
| `STAGING_DATABASE_URL_OWNER` | the same string for the **owner** role. Only the migration itself uses it |
| `STAGING_DATABASE_APP_PASSWORD` | a fresh 32-character password you generate (Supabase runbook §5) and keep in your password manager as "Restro staging app role" |
| `STAGING_DATABASE_PURGE_PASSWORD` | a second one, the same way, for the purge role (D83). Save it as "Restro staging purge role" |

Both connection strings must end with `sslrootcert=/home/runner/work/_temp/supabase-ca.crt` — the
runbook's §6 explains why; the certificate is written to that path on the runner.

A sixth, `STAGING_DATABASE_URL_PURGE`, is the worker's and belongs in Railway (§6), not here.

## 3. Run the migration

1. GitHub → **Actions** → in the left list, **DB migrate (staging)** → **Run workflow**.
2. Branch: **main**. Leave `rotate_app_password` and `rotate_purge_password` **unticked** — they are
   only for after you have changed a password in §2.
3. **Run workflow**, then wait for the yellow "waiting for approval" bar and **Review deployments**
   → tick `staging` → **Approve and deploy**.
4. It applies the migrations, then creates the roles, then checks the app role can log in. The first
   run applies every migration at once (0001 through 0045 at today's `main`), so give it a few
   minutes.

Tell the lead the run number. Nothing else — no passwords, ever.

**If it fails:** send the lead the run number and the name of the step that went red. Do not re-run
it until the lead has read the log; a half-applied migration is worth looking at before it is
touched again.

## 4. Cloudflare Turnstile (about 5 minutes)

You already have a Cloudflare account from the R2 step. Staging needs its own Turnstile keys,
because the published test keys must never be used outside this PC.

1. Cloudflare dashboard → **Turnstile** → **Add widget**.
2. Name `restro-staging`, **Widget mode: Invisible**, and add the Railway hostname from §5 as the
   domain (you can come back and add it once you have it).
3. Copy the **site key** and the **secret key** into the staging variables (§6).

Without the secret key, a guest's Send on the bill fails its check and nothing can be ordered or
paid on staging.

## 5. Railway: the account, the project, the two services (about 30 minutes)

1. https://railway.com → sign up with GitHub.
2. Plan: **Hobby**, $5 a month, which includes $5 of usage. Do not take Pro yet; see the note below.
3. **New Project** → **Deploy from GitHub repo** → `MartinKostadinov04/restro`. Give Railway access
   to that repository only.
4. Rename the environment it creates, or add one, so you have an environment named **staging**
   (Railway gives every project a `production` environment by default; a project may have more).
   Do your work in `staging` and leave `production` empty for now.
5. In **Service → Settings → Region**, choose **EU West (Amsterdam)**, which Railway now lists as
   "EU West Metal, Amsterdam, `europe-west4-drams3a`". This is not a preference: our privacy
   position is that the app runs in the EU (D43, D54, and the stack doc's EU and privacy note).
   **If Railway will not let you choose a region on Hobby, stop and tell the lead** — an old forum
   answer says region choice is Pro-only, Railway's current documentation does not say so, and if it
   is still true then Pro at $20 a month is not optional and that is a cost decision, yours.
6. You need **two** services from the one repository — the web app and the worker. Add the second
   with **New** → **GitHub Repo** → the same repository, inside the same environment.
7. **Leave each service's Root Directory empty.** This is a shared pnpm workspace: both apps import
   packages from the repository root, and pointing a service at `apps/web` would hide them and the
   root lockfile. Railway's own monorepo guidance for this shape is to keep the root and override
   the build command per service instead:

   | Service | Build command | Start command |
   | --- | --- | --- |
   | web | `pnpm --filter @restro/web build` | `pnpm --filter @restro/web start` |
   | worker | `pnpm --filter @restro/worker build` | `pnpm --filter @restro/worker start` |

8. **Generate a domain** on the web service (Settings → Networking → **Generate Domain**). That
   gives a `…up.railway.app` address over HTTPS, which is all check 4 needs. Send it to the lead.
9. The worker needs **no** public domain. It talks to the web app over Railway's private network.

**What is not ready yet.** The repository has no deploy configuration in it — no `railway.json`, no
Dockerfile, nothing that tells a builder how to build a pnpm workspace with a pinned Node 24. The
commands in step 7 are the right ones, but whether Railway's builder gets there on its own is only
proven by the first build. Expect the lead to have one ticket's worth of work here, and tell the
lead when the first build fails rather than changing settings at random.

## 6. The staging variables

Both services need variables, and some values must be **identical** in both. Rather than you typing
thirty values, the lead fills a git-ignored file on this PC (`.env.staging.local`) once the Railway
address from §5.8 exists, generating every random key locally; you then copy each line into
Railway's **Variables** → **Raw Editor**, one service at a time. No value goes through chat.

What goes where, so you can check the lead's work:

**Web service**

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the app role's pooler string — never the owner's |
| `BETTER_AUTH_URL` | the `https://…up.railway.app` address |
| `BETTER_AUTH_SECRET`, `GUEST_PASS_KEY`, `STAFF_PIN_PEPPER`, `REVEAL_SERVICE_TOKEN` | fresh random values, generated locally |
| `SEAL_PUBLIC_KEY` | the public half of a new pair (`pnpm keys:seal`) |
| `WORKER_REVEAL_URL` | `http://<worker service name>.railway.internal:8081` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | from §4 |
| `ASSET_STORE`, `PUBLISH_STORE` | both `local` (see the note below) |
| `PAYMENTS_ENV` | `staging` |
| `PAYMENTS_PROVIDER` | `stripe` |
| `STRIPE_NOTICE_SECRET` | the signing secret of a **test-mode** endpoint in Stripe, created in step 7 |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | the `pk_test_…` key |

**Worker service**

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the same app-role string |
| `DATABASE_URL_PURGE` | the purge role's string, built from the password in §2 |
| `SEAL_PUBLIC_KEY`, `SEAL_PRIVATE_KEY` | both halves of the pair — the private half goes **only** here |
| `REVEAL_SERVICE_TOKEN` | the same value as the web service's |
| `WORKER_HEALTH_PORT` | `8081` |
| `BILL_ID_KEY` | a fresh random value |
| `ASSET_STORE`, `PUBLISH_STORE` | both `local` |
| `PAYMENTS_ENV` | `staging` |
| `STRIPE_SECRET_KEY` | the `rk_test_…` key |
| `LOG_LEVEL` | `info` |

**Why `local` for both stores.** Published menus and photos can be served by the app itself; the
code allows it outside development as long as the setting is explicitly set. So staging needs no
second, public R2 bucket and no CDN domain — one less thing on the chain. The cost is that those
files live on the container's disk and are gone after every deploy, so a venue has to be published
again after each one. If that becomes annoying, a Railway volume (5 GB on Hobby) fixes it.

## 7. The first deploy, and what to check

The deploy is your click: Railway → the service → **Deploy**.

When both services are up:

1. Open the `…up.railway.app` address. The sign-in page should load.
2. Tell the lead. The lead then creates a venue on staging, connects it to a Stripe **test**
   connected account, and adds a test-mode endpoint in Stripe pointing at
   `https://…up.railway.app/api/payments/notices/stripe` — the secret of which is the
   `STRIPE_NOTICE_SECRET` in §6. Until both `PAYMENTS_ENV` and that secret are set, the route
   answers 503 on purpose and Stripe simply retries later.
3. **Check 4** then runs as an agent task. Its evidence is Stripe request ids, never a key.

## 8. The domain, for check 5 only

Check 5 — Apple Pay and Google Pay — needs a domain registered with Stripe, so a
`…up.railway.app` address is not enough. Buy the main domain (T25), point `staging.<domain>` at the
Railway web service (Settings → Networking → **Custom Domain** gives you the DNS record to add;
Hobby allows two custom domains), and tell the lead. An agent then registers that exact host with
Stripe through the API and serves the association file.

Then the part only you can do: open the guest page on your own phone and tap the wallet. Stripe's
test cards cannot be added to an Apple Pay wallet, so this needs **a real card already in your
phone's wallet** — and with test keys Stripe turns it into a test token and **does not charge it**.
You will not type a card number anywhere.

## 9. One thing still to decide

To pay on staging there has to be a bill to pay, and a bill comes from a POS. The stack doc says a
simulated POS (`sim-pos`) on staging "is a later step that needs Martin's OK". Checks 4 and 5 need
it, or something like it.

**Recommendation:** yes, run `sim-pos` on staging for these checks. The guardrail that matters is
already in the code — the worker refuses source kind `sim` in production and the source picker hides
it there — so saying yes for staging cannot leak into production. The alternative, pointing staging
at the barsy test installation, drags a second system into a payment check that has nothing to do
with it.

## 10. What is deliberately not in this runbook

Sentry, Resend, the Telegram bot, the public R2 bucket, the CDN domain, the short QR domain, and
anything production (Supabase `restro-prod`, a production Railway environment, live Stripe keys).
None is needed for checks 4 and 5. They are the rest of T25 and get their own guide when production
is set up.
