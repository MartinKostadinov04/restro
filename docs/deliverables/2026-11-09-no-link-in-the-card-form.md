# The guest's card form offers no Link account (#379, D145)

Run on 2026-11-09 against "Restro Sandbox" (test mode), through the app's own guest pay screen. It proves D145's change in Stripe's sandbox, which Stripe's documentation does not promise (D145, "The facts behind it"). Check 6's own file (`2026-11-09-stripe-sandbox-checks-6.md`) and the 10-29 file are left as filed (D114). Evidence is object and request ids only; no key was written to a file or committed.

## The change

`apps/web/src/connectors/stripe/card-form.ts` creates the Payment Element with `{ layout: 'tabs', wallets: { link: 'never' } }`, with a comment citing D145. A unit test (`card-form.test.ts`) pins the options. Nothing passes `link` anywhere: the only PaymentIntent create (`packages/payments/stripe/src/provider.ts`) sends `allowed_payment_method_types: ['card']` and nothing else about payment methods, and no other code creates a Payment Element.

## Result

| Claim | Result |
|---|---|
| No "Secure, fast checkout with Link" and no "Save my information" box in the card form | **Shown**, in English, one browser, one account (below) |
| The same form **did** show both before the change (so the change is what removed them) | **Shown** by a control run in the same session, same venue, with only the option taken out |
| A card payment still works end to end with the option | **Shown**: hold, 3-D Secure, capture, "Paid" |
| The 3-D Secure challenge still opens inside the page | **Shown**, with the limits under "Not shown" |
| No account setting had to change | **Shown for this account**: the code switch was enough, so the Dashboard question in the ticket's §4 does not arise |

## How it was run

- The pay harness in its Stripe mode (`PAY_HARNESS_PROVIDER=stripe`, `PAY_HARNESS_PAGE=1`, `PAYMENTS_ENV=test`), a venue on the simulated POS ("Pay Bar", table 1, a waiter's round of €32.50) whose payment account is the sandbox's connected test account `acct_1UUjd8H6CXJeKV2v` (reused; no account was made). A scratch database `restro_nolink` was made, migrated, and **dropped afterwards**. The web app ran as `next dev` on 3100, an ordinary worker beside the harness's, the two publish jobs queued by hand.
- Key prefixes were checked first: `rk_test_` and `pk_test_`. Stripe's published test card `4000 0027 6000 3184`, 12/34, CVC 123, country Bulgaria.
- The guest was **Playwright's Chromium** (375×812, mobile emulation, light theme) against that dev server, using the page's own controls (`pay.whole`, `pay.start`, the form's own submit). My first attempt in the in-app browser pane typed into Stripe's frame unreliably (keystrokes landed in the wrong field), so it was abandoned; its screenshot (option on) also showed no Link but is not counted as evidence. The driver script is not committed.
- For each form the text of **every Stripe frame** was read after the form was drawn and again after the card was typed, because Link's sign-up box only appears once card details are typed.

## Evidence

Screenshots, in `2026-11-09-no-link-in-the-card-form/`, card typed, same venue and bill:

- `form-before-d145.png`: the control, option removed. "Secure, fast checkout with Link" above the card number; under Country, "Optional · Save my information for faster checkout" with **Email, Mobile number and Full name** and Link's terms.
- `form-with-d145.png`: the change. Card number, Expiration, Security code, Country, then Pay. Nothing else.

The frames' text agrees with the pictures: with the option, none of "Link", "Save my information", "email" or "phone" appears before or after typing; without it, "Secure, fast checkout with Link" appears at once and "Save my information for faster checkout / Email / Mobile number" after typing.

**The payment** (with the option): `py_733KvO2RC3BHASO4y8GRgu` → PaymentIntent **`pi_3UZwhBH6CXJeKV2v0PM3g4yo`**, 3250 EUR, manual capture, `payment_method_types` `["card"]`, `livemode` false. Charge **`ch_3UZwhBH6CXJeKV2v0QcJir21`**, `captured` true, `livemode` false. Read from Stripe afterwards (`GET /v1/payment_intents/pi_3UZwhBH6CXJeKV2v0PM3g4yo?expand[]=latest_charge`, `req_Ly89xhxZ7jNynp`): `succeeded`, `amount_received` 3250, `amount_capturable` 0, `payment_method_details.card.three_d_secure` `authentication_flow` `challenge`, `result` `authenticated`, `version` `2.1.0`, `electronic_commerce_indicator` `05`. Restro's row: `captured`, `three_ds_result` `authenticated`, 3250 captured. The page ended on "Paid", payment number `VTKTQ` (`paid` screen captured).

**The challenge** opened about 12 seconds after the form was drawn (including typing the card) in a frame of the guest page from `testmode-acs.stripe.com/3d_secure_2_test/acct_…/…`; COMPLETE was clicked there. The page's address after the payment was equal to its address before the form's Pay was tapped, and held none of `payment_intent`, `client_secret` or `redirect_status`.

**The control's PaymentIntent** `pi_3UZwTrH6CXJeKV2v0465nLWO` (card typed, never confirmed) also lists `["card"]`; it was released at its 2-minute deadline and Stripe says `canceled`, no charge (`req_IUahAcO5gfIKON`). So the option changes the element, not the intent.

Other PaymentIntents made during the run and left `released`/`canceled` or expired, none charged (test mode, Restro's rows `released`, `expired`): `pi_3UZwOpH6CXJeKV2v1HDtoMZF` (in-app pane, option on), `pi_3UZwRkH6CXJeKV2v1uLJFSkW` (control, first look), `pi_3UZwWNH6CXJeKV2v05QavSzW` (option on; the challenge opened but my script did not find its button in time, so it was never completed). That last one also shows the challenge opening inside the page and the deadline stretching to the session's end, as in check 6; I did not read its Stripe-side state.

## Not shown, and why

- **Bulgarian.** The guest's default language is Bulgarian; every run was `?lang=en`, and my text search for "Link" is English. The switch is an option, not a text filter, so it should not depend on the language, but it was not looked at in Bulgarian.
- **One browser, one run of each.** One headless Chromium emulating a phone, no real phone, no production build, no second browser. The control was seen twice (both showed Link's headline; the second also typed a card and showed the sign-up box). The change was seen in two scripted runs, each with the frames' text read before and after typing (the first was not completed by my script; the second is the paid one), and once in the in-app pane before typing.
- **A guest who already has a Link account** (Stripe's cookie on their phone) was not tried; the form would not ask them for anything, but whether Stripe still recognises them was not looked at.
- **The connected account's own payment-method settings** were not opened and not read. The control shows Link was available for that account; the change worked without touching it. If Stripe changes what the option does, or a venue's account somehow behaves differently, the per-account override (`manage-payment-methods`) is the route; nothing here needed it.
- **Failed authentication, the declined card, Apple Pay, Google Pay** are other checks (#378, check 5) and were not repeated.
- **"No redirect"** I read from the address (equal before and after, no Stripe value). Playwright also counted four main-frame navigation events over the whole run; I did not separate them by time, so I do not claim they all happened before the form's Pay (they include the page's own move from the short menu address to its canonical one). Check 6's own, more careful reading of "no redirect" is the one to rely on.

## Where the recipe (`2026-11-09-stripe-sandbox-checks-6.md`) was wrong or missing

- It is **not on `or/foundation`**: the file lives only on `or/staging-chain-plan` (commit `3f85a13c`), so a branch cut from `or/foundation` does not have it; I read it with `git show`. The V09 lines of the knowledge file are on that branch too, so this PR's knowledge lines use their own source tag, **N09**, and the two PRs will meet at that file.
- `.env.local` is in the main checkout, not in a worktree; a worktree needs `pnpm install` first (3 minutes).
- The worker also needs a **sealing key pair** (`SEAL_PUBLIC_KEY`, `SEAL_PRIVATE_KEY`); I generated a throwaway pair for the run, the way `apps/worker/src/e2e-seal-keys.ts` does.
- The harness needs its stdin kept open (`tail -f /dev/null | node …`), and `STRIPE_E2E_ACCOUNT` set; neither is said.
- The two publish jobs need the tenant, venue and menu ids, which are read from the scratch database; the payload is `{ tenantId, menuId, venueId }`.
- The pane's mouse and keyboard were unreliable inside Stripe's frame; Playwright was reliable. The challenge's COMPLETE button sits in a **nested** frame, so a locator on the last Stripe iframe (as `guest-pay-card.spec.ts` uses) may not find it; I searched every frame for the button.

## Out-of-scope observations

- Stripe.js warns on this page that the integration "is using an older API" and recommends migrating to the Checkout Sessions API (`…/payment-element/migration-ewcs`). Not a defect; worth knowing before the pilot.
- Stripe.js also warns that the page's domain is not registered, so `apple_pay` is not enabled in the Payment Element: check 5 needs the domain registered and the page served over HTTPS.
- Full name is also asked by Link's box in the control, besides email and phone.
