# Runbook: staging on Coolify, at restro.synexcloud.com

Martin's steps, click by click, for staging on his own server (D172). It replaces §5 of
`docs/runbooks/staging-deploy.md` (Railway) and its private address; the rest of that file still
holds, and this one points back to it where it does. The order and the reasons behind it are in
`docs/deliverables/2026-11-09-staging-chain-for-stripe-checks.md` (#117, checks 4 and 5).

## 0. Ground rules

- **No secret in chat, in the repo, or in a log.** Values go from their source straight into
  Coolify, a GitHub environment secret, or a git-ignored file on this PC. Tell the lead "it's set",
  never the value.
- **The deploy is yours.** Agents never deploy and never run a migration against staging from
  this PC. Every step below that changes staging is a click of yours.
- **Staging is test mode throughout.** Stripe keys start `pk_test_` / `rk_test_` / `sk_test_`; the
  web build refuses any other publishable key. If a value does not start with one of those, stop
  and tell the lead.
- **Nothing here touches a venue's real POS.** Staging's bills come from the simulated POS
  (`sim-pos`), which runs beside the app on the server and nowhere near a venue.

## 1. What must be true first

| | Why |
| --- | --- |
| #375 merged into `main` | it puts the Dockerfile and `docker-compose.staging.yml` into the repository; Coolify builds from them |
| #554 merged (`or/foundation` into `main`) | staging deploys from `main` |
| PR #199 merged, the five secrets set, the migration run | `docs/runbooks/staging-deploy.md` §2 and §3, unchanged: the database must have its tables before the app starts |
| A Turnstile widget for `restro.synexcloud.com` | `staging-deploy.md` §4, with this address as the widget's domain |

Sections 2 to 5 below can be done before the merges; the first deploy (§6) waits for all four.

## 2. The address (5 minutes)

Wherever `synexcloud.com`'s DNS is managed, add an **A record**: name `restro`, value the
server's public IP address (the same one your other Coolify sites point at).

Then tell the lead one thing: **is `synexcloud.com` behind Cloudflare's proxy** (an orange cloud
next to the record) or not? It decides how the app reads a visitor's address for its
guess-limiter on table codes; the lead adjusts that setting to your answer.

## 3. The project (5 minutes)

1. Coolify → **Projects** → **+ Add** → name it `Restro`.
2. Inside it, Coolify has made an environment called `production`. Add one called **`staging`**
   and work only there. Leave `production` empty: production's host is still open (D172).

Restro gets its own project so its network, variables and volume stay apart from your other
projects on the same server.

## 4. The application (10 minutes)

1. In `Restro` → `staging` → **+ New** → **Public Repository**. The repository is public, so
   Coolify needs no access to your GitHub account, and it does not redeploy on its own when
   `main` changes: you deploy when you choose.
2. Repository URL: `https://github.com/MartinKostadinov04/restro`. Branch: **`main`**.
3. **Build Pack:** `Docker Compose`.
4. **Base Directory:** `/` (the repository root; the build needs the whole workspace).
   **Docker Compose Location:** `/docker-compose.staging.yml`. Then **Continue**.
5. Coolify reads the file and shows three services: **`web`**, **`worker`** and **`sim-pos`**.
   If it shows anything else, stop and tell the lead.

## 5. The domain and the variables (15 minutes)

**Domain.** Open the `web` service → **Domains** → `https://restro.synexcloud.com:3000`. The
`:3000` tells Coolify which port inside the container the site answers on; visitors never see
it. Leave **`worker`** and **`sim-pos`** without a domain: they are reached only by the web app,
over the project's private network. Add no port mappings anywhere.

**Variables.** The lead fills a git-ignored file on this PC, `E:\Restro\.env.staging.local`,
generating every random key locally, with a comment above each line saying where the value
came from. The values only you can fetch (the database strings, the Stripe test keys, the
Turnstile keys) are left as named blanks for you to fill from their source. Then:

1. Coolify → the application → **Environment Variables** → **Developer view**.
2. Paste the file's lines, **Save**.
3. Switch back to the normal view. Every variable the Compose file marks as required is
   highlighted while empty, and Coolify will not deploy until each one is set.
4. `SUPABASE_CA_CERT` is several lines long: if the paste flattened it, open that variable,
   tick **Is Multiline**, and paste the certificate text again (the same text as the GitHub
   secret of the same name).
5. **Build time:** only the variables starting `NEXT_PUBLIC_` are needed while the image is
   built (they are public values the web app carries to phones). If Coolify shows a **Build
   time** tick on each variable, untick it on every other one, so no secret goes into a build.
   Tell the lead if the screen looks different from this.

What goes where, so you can check the lead's file. You paste one list; the Compose file hands
each value only to the services that name it, which is how the private seal key reaches the
worker and never the web app.

| Variable | web | worker | sim-pos | Value |
| --- | --- | --- | --- | --- |
| `DATABASE_URL` | ✓ | ✓ | | the app role's pooler string (`supabase-setup.md` §4), ending `sslrootcert=/tmp/supabase-ca.crt`; never the owner's |
| `DATABASE_URL_PURGE` | | ✓ | | the purge role's string, the same way |
| `SUPABASE_CA_CERT` | ✓ | ✓ | | the certificate text, as in the GitHub secret |
| `BETTER_AUTH_URL` | ✓ | | | `https://restro.synexcloud.com` |
| `BETTER_AUTH_SECRET`, `GUEST_PASS_KEY`, `STAFF_PIN_PEPPER` | ✓ | | | fresh random values, generated locally |
| `REVEAL_SERVICE_TOKEN` | ✓ | ✓ | | one fresh random value, the same in both |
| `SEAL_PUBLIC_KEY` | ✓ | ✓ | | the public half of a new pair (`pnpm keys:seal`) |
| `SEAL_PRIVATE_KEY` | | ✓ | | the private half: the worker only |
| `BILL_ID_KEY` | | ✓ | | a fresh random value |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | ✓ | | | from the Turnstile widget (§1) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | ✓ | | | the `pk_test_…` key |
| `NEXT_PUBLIC_CDN_BASE_URL` | ✓ | | | `https://restro.synexcloud.com/cdn` |
| `STRIPE_NOTICE_SECRET` | ✓ | | | the signing secret of the test-mode endpoint (§8); can be blank at the first deploy |
| `STRIPE_SECRET_KEY` | | ✓ | | the `rk_test_…` key |
| `SIM_POS_CONTROL_TOKEN` | | | ✓ | a fresh random value |

Already written in the Compose file, so not in your paste: `ASSET_STORE` and `PUBLISH_STORE`
(`local`), the shared folder they use, `PAYMENTS_ENV=staging`, `PAYMENTS_PROVIDER=stripe`,
`BARSY_ENV=staging`, `WORKER_HEALTH_PORT=8081`, the worker's private address
`http://worker:8081`, the simulator's allowed host, and `LOG_LEVEL=info`.

The exact list is the Compose file's. If the merged file differs from this table, the lead
corrects this table in the same pull request that changes the file.

## 6. The first deploy, and what to check

1. Coolify → the application → **Deploy**. The first build takes a while (it installs and
   builds the whole workspace); later ones reuse what has not changed.
2. When it finishes, each of the three services should show **healthy**.
3. Open `https://restro.synexcloud.com`: the sign-in page loads, with a padlock.
4. Open `https://restro.synexcloud.com/api/health`: it answers `{"status":"ok"}`.
5. Tell the lead "deployed" and nothing else.

**If something is red:** send the lead the service's name and the step that failed (Build or
Running). Coolify's logs can contain values, so do not paste them into chat; the lead will ask
for the few lines it needs. Do not change settings at random: the first build is the first real
test of the Dockerfile and of how Coolify passes variables, and the fix belongs in the
repository.

## 7. Redeploys

- **Code without a new migration:** Coolify → **Deploy**. Photos and published menus are on a
  volume both services share, so they survive the redeploy.
- **Code with a new migration:** run **DB migrate (staging)** first (`staging-deploy.md` §3),
  then deploy. A container never migrates the database.

## 8. Checks 4 and 5

- **Check 4 (signed notices):** once staging runs, the lead connects a staging venue to a Stripe
  **test** connected account and adds a test-mode endpoint in Stripe at
  `https://restro.synexcloud.com/api/payments/notices/stripe`. Its signing secret becomes
  `STRIPE_NOTICE_SECRET` (§5); you paste it and redeploy. Until then the route answers 503 on
  purpose and Stripe retries.
- **Check 5 (Apple Pay and Google Pay):** `restro.synexcloud.com` is already a domain you own, so
  this no longer waits for the Restro domain. An agent registers that exact host with Stripe for
  test mode through the API; then you open the guest page on your phone and tap the wallet, with
  a real card already in it: with test keys Stripe does not charge it (`staging-deploy.md` §8).

## 9. Not in this runbook

Production (its host is open, D172), Sentry, Resend, the Telegram bot, the public R2 bucket, the
CDN domain and the database backups (`DATABASE_URL_BACKUP` stays unset on staging).
