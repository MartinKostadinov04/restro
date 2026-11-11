# Stripe sandbox checks (#117): check 6, 3-D Secure inside the page

Check 6 of the six checks before the pilot (D127, design §13), run against "Restro Sandbox" on 2026-11-09 through the app's own guest payment screen. It **supersedes the check-6 row of `2026-10-29-stripe-sandbox-checks.md`**, which still says "waiting for PR #195"; the card form is now on the branch this was run from (`or/staging-chain-plan` at `2310d97f`, which contains the card form's commit `270e548b`). Deliverables are not edited after they are filed (D114), so that file stays as it was. Checks 1–3 are still as it says; checks 4 and 5 are still waiting (they need the staging deploy and Martin's phone; the plan is `2026-11-09-staging-chain-for-stripe-checks.md`). Evidence is request ids and object ids only, never a key. The facts learned are also in `2026-10-22-stripe-knowledge.md` as V09 [SANDBOX] lines.

**The claim under test** (`apps/web/src/connectors/stripe/card-form.ts`): the form confirms with `confirmPayment({ redirect: 'if_required' })`, and "with cards only, the bank's check opens inside the page and nothing redirects".

## How it was run

- **The real guest page, in a browser.** The built-in browser pane, emulating a 375×812 phone, on `/m/<venue>#t=<table code>` served by the web app. A guest ticked "The whole bill", tapped Pay, typed a test card into Stripe's own Payment Element and tapped Pay in the form. No standalone script took part in the payment. The card form code is the app's (`card-form.ts`, Stripe.js loaded by `@stripe/stripe-js/pure`).
- **The venue.** The pay harness in its Stripe mode (`apps/worker/src/e2e/pay-harness.ts`, `PAY_HARNESS_PROVIDER=stripe`, `PAY_HARNESS_PAGE=1`, `PAYMENTS_ENV=test`): a venue on the simulated POS ("Pay Bar", table 1, a waiter's round of €32.50), whose payment account is `stripe` on the sandbox's connected test account **`acct_1UUjd8H6CXJeKV2v`** (reused from checks 1–3; no account was made). The harness's worker paid through the real provider with the platform's restricted key. A second, ordinary worker ran the publish jobs, with no Stripe key.
- **Keys.** `STRIPE_SECRET_KEY` (`rk_test_`) and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (`pk_test_`) from `.env.local`, read by the app and the worker as they normally are. Their prefixes were checked before anything started. No key was printed or written anywhere. The Stripe-side reads below used the platform's key from the environment in a command that was not saved.
- **Cards.** Stripe's published test card `4000 0027 6000 3184` (3-D Secure 2 on every payment), expiry 12/34, CVC 123, country Bulgaria (the form's default). No real card.
- **Human check.** Cloudflare's published test keys (the site key from `.env.example`, the secret `1x…AA`), with Cloudflare's own script (not stubbed).
- **Versions.** Next.js 16.4.3 (Turbopack), API `2026-09-30.endive`.
- **Asserted on everything created:** the three PaymentIntents and the one charge are `livemode` false.
- **Where it was not the plain recipe** (the lead should know, none of it changed a line of the repo):
  - The web app ran as `next dev` (not a production build), started from a shell with its own environment, not through `.claude/launch.json`. The reason: `.env.local`'s `DATABASE_URL` names `restro_design`, which **does not exist** on this machine's Postgres, so a scratch database `restro_check6` was made, migrated (`db:migrate`, `db:roles`) and **dropped afterwards**; the web app, the worker and the harness all pointed at it. The publish store was a folder in the session's scratch directory.
  - The harness alone does not make the page servable: it publishes the menu in the database but queues no `publish-files`/`publish-live` job, so `/cdn/v/<code>.json` answered 404 ("This menu is not available"). I queued those two jobs by hand (pg-boss), and restarted the worker so its start-up `seal-table-codes` wrote the table's file. Out of scope; noted below.
  - The harness's connected account can belong to one venue only (`payment_accounts_account_unique`), so before the second venue I deleted the first venue's account row in the scratch database.

## Result

| Check | Result | Date |
|---|---|---|
| 6. 3-D Secure, inside the page, no redirect | **passed**, with the limits listed under "Not shown" | 2026-11-09 |

Both outcomes are on record: a challenge that was completed, and one that was failed.

## Evidence

All times are UTC (the workers' logs). Request ids are the answers to my reads of the objects afterwards, not the browser's own confirm calls (see "Not shown").

### Does the app's own policy let the challenge render?

Yes, with no change. The header the dev server sent on the guest page:

`script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com; frame-src https://challenges.cloudflare.com https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com; connect-src 'self' https://api.stripe.com ws: wss:`

That is the policy of the 10-29 harness's log plus the development-only `'unsafe-eval'` and `ws:`/`wss:` (`apps/web/src/guest/headers.ts`; the hosts come from `connectors/stripe/card-form-hosts.json`). A `securitypolicyviolation` listener on the page recorded **nothing** in either run. The Payment Element, its hidden controller and hCaptcha frames, and the challenge frame all came from `js.stripe.com`. The production policy differs only by those two development additions; it was not exercised in the browser here (the repo's `guest-pay-return.spec.ts` and `guest/headers.test.ts` hold it).

### Run A: authentication passed

- **Payment:** `py_2x2N1tYD4N8YiFuSSBvFUn` → `pi_3UZvdSH6CXJeKV2v0q6PDBbY`, 3250 EUR, manual capture, card only, `livemode` false. Charge `ch_3UZvdSH6CXJeKV2v0gekAnQN`.
- **16:41:30** the guest taps Pay and the hold is made; the card form (Stripe's Payment Element, in `[data-slot="pay.form"]`) is drawn about ten seconds later.
- **16:42:36** the form's Pay button is tapped. About four seconds later a frame `three-ds-2-challenge-….html` from `js.stripe.com` covers the viewport **inside the page**: Stripe's mock bank page, "This is a test 3D Secure 2 authentication for a transaction with RESTRO SANDBOX", with FAIL and COMPLETE (and CANCEL outside it).
- **While the challenge was open** the payment in Restro was `awaiting_guest` and its `confirm_by` had moved from 16:43:34 to **16:51:34**, the session's end (created + 10 minutes): Restro read from Stripe that the guest's bank was asking for a step, and stretched the deadline as `core/service/pay.ts` says it does. The challenge stayed open past the old 2-minute deadline without the payment expiring.
- **About 16:44:22** COMPLETE was activated. The challenge frame closed, the page showed its own "waiting" screen (the guest page's, not the form's), then **"Paid", payment number `TNU9Q`**.
- **Restro's state:** `captured`, `three_ds_result` `authenticated` (the row was updated 16:44:30).
- **Stripe's state** (`GET /v1/payment_intents/pi_3UZvdSH6CXJeKV2v0q6PDBbY?expand[]=latest_charge`, `req_8FpFhjhM3TLDWL`): `succeeded`, `amount_received` 3250, `amount_capturable` 0, charge `captured` true, `amount_captured` 3250, `payment_method_details.card.three_d_secure`: `authentication_flow` `challenge`, `result` `authenticated`, `version` `2.1.0`, `electronic_commerce_indicator` `05`.
- **What Restro's own provider reads** from that intent (`readPayment`): `status` `captured`, `threeDs` `authenticated`, `needsGuestAction` false. The same three words as in its database.
- **No redirect.** At the end the page's `performance.timeOrigin` was the value it had before the form was opened (one document, never reloaded), `performance.getEntriesByType('navigation').length` was 1, `location.href` was unchanged (`#t=…` and all), and the address held none of `payment_intent`, `client_secret`, `redirect_status`. `history.length` went up by one (2 → 3), which is not the page leaving: nothing in `apps/web/src`, `packages/shell/src` or `packages/faces` calls `pushState`, and the top-level entry is unchanged; I read it as the browser counting the challenge's frame in the session history (my inference, not something I could look inside to confirm).

### Run B: authentication failed

A second venue (the first one's bill was paid), the same card and flow.

- **Payment:** `pi_3UZvmkH6CXJeKV2v1ajzgdt3`, 3250 EUR, `livemode` false, hold made 16:51:10.
- The same in-page challenge appeared (16:51:33). **FAIL** was activated.
- **The page:** the challenge frame closed, the guest stayed on the card screen with Stripe's own text in the form's alert, **"We are unable to authenticate your payment method. Please choose a different payment method and try again."** The page never said "Paid". Same document again (`timeOrigin` unchanged, 1 navigation entry, address unchanged and clean; `history.length` 5 → 6).
- **Stripe's state** (`req_Q3cei3B6cf4gXx`): `requires_payment_method`, `amount_received` 0, **no charge** (`latest_charge` null), `last_payment_error`: `code` `payment_intent_authentication_failure`, `type` `invalid_request_error`, message "The provided PaymentMethod has failed authentication. You can provide payment_method_data or a new PaymentMethod to attempt to fulfill this PaymentIntent again."
- **Restro's reading** of it: `status` `failed`, `threeDs` null, `needsGuestAction` false. Its payment stayed `awaiting_guest` (the form lets the guest try another card). I did not try another card.
- **End:** at the confirm deadline (16:53:10) the app released it: Restro `released`, reason `expired` (16:53:12); Stripe `canceled` (`req_ExeQNJ6Vx77xNC`).

### An unplanned third payment: the 2-minute window

My first attempt took longer than two minutes between the Pay button and the form's Pay button. `pi_3UZvaGH6CXJeKV2v1bgILZFw` (3250 EUR, made 16:38:16) passed its `confirm_by` (16:40:16) and the app released it at 16:40:20: Restro `released`, reason `expired`; Stripe `canceled` with no charge (`req_s3HOBsWTL3r7jJ`). The page said **"Your time ran out. Nothing was charged."** with "Pay again" and "Back to the bill". It confirms `PAYMENT_CONFIRM_MS` = 2 minutes (`core/service/pay.ts`) and the expiry path; it is not a check of its own.

## Not shown, and why

- **The browser's confirm calls.** Stripe.js sends `POST /v1/payment_intents/<id>/confirm` from the browser, so their request ids are not in any log of ours. Both the platform's key and the harness's key were refused `GET /v1/events` on the connected account (403 `more_permissions_required`), so the events' `request.id` could not be read either. The ids above are the object reads and nothing else.
- **A real phone, a second browser, a production build.** One Chromium pane emulating a phone, `next dev`. Apple Pay and Google Pay are check 5.
- **Other 3-D Secure paths.** Only the challenge flow (`authentication_flow` `challenge`, version 2.1.0) of one card. Not tried: a frictionless card, a card that authenticates and is then declined (`4000 0084 0000 1629`, listed in the knowledge file), the CANCEL button, a second attempt with another card after a failure, a bank page that needs more than a button.
- **The pane's mouse.** Mouse clicks on the buttons inside Stripe's challenge frame did not register in the pane (clicks on the page's own elements did, and so did the first click into the card field). The challenge's buttons were reached with the keyboard (Tab to the button, Enter). That is a limit of this pane, not evidence about phones.

## Failures

None. The claim held, and the app's policy already allowed the challenge. No bug was found, so no bug ticket. Nothing in the repo was changed, and nothing was committed.

## Open questions, for the lead

1. **After a failed authentication the guest has only the rest of the 2 minutes.** The deadline stretches to the session's end (10 minutes) only while the bank is asking for a step; once the challenge is failed there is no step open, so a guest who fails at 1:50 has ten seconds to try another card before the payment is released (run B shows the end of this). Recommendation: ask whether failing authentication should extend the window like an open challenge does; if so, it is a small change in the same place (`confirmOver && !read.needsGuestAction`), for Martin to rule on. I did not change it.
2. **Stripe's form offers Link.** Under the card fields it shows "Secure, fast checkout with Link" and "Save my information for faster checkout" (email, phone). `card-form.ts` creates the element with `layout: 'tabs'` only. Whether a guest at a club should be offered that is a product and privacy call; I have not looked up how Stripe lets a platform turn it off. Recommendation: put it to Martin with D127 beside it.

## Out-of-scope observations

- `.env.local`'s `DATABASE_URL`/`DATABASE_URL_OWNER` name `restro_design`, which this machine's Postgres no longer has; anyone running the app from `.env.local` as it is will fail to start.
- The pay harness in `PAY_HARNESS_PAGE=1` mode needs the publish files and the table file written, which only a worker's jobs do; a worker started before the harness may not seal the new table code until it restarts. `guest-pay-card.spec.ts` presumably relies on the e2e worker; I did not read how.
- `.claude/launch.json` in this checkout has uncommitted `dev` instead of `start`; mine did not touch it.
- Left behind in the sandbox: the three test PaymentIntents above (test mode, two `canceled`, one `succeeded`). The 10-29 harness folder `.check6` was not touched.
