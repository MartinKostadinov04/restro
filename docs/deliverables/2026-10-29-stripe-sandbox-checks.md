# Stripe sandbox checks (#117)

The six checks before the pilot (D127, design §13), run by the #117 agent against "Restro Sandbox" on 2026-10-29. This file holds checks 1–3. Checks 4–6 are filed in a later dated deliverable that revises this one (deliverables are not edited after they are filed, D114). Evidence is request ids and object ids only, never a key. The facts learned also sit in `2026-10-22-stripe-knowledge.md` as V29 [SANDBOX] lines.

**How they were run:**
- **Script:** `packages/payments/stripe/src/testing/sandbox-checks.test.ts`, skipped unless `STRIPE_SANDBOX_CHECKS=run` is set (CI never sets it, so CI never reaches Stripe). It stops before any request unless the platform's credential is a restricted sandbox one (`rk_test_`) and the harness's is a sandbox one (`rk_test_`/`sk_test_`). A full credential could refund, so it is refused.
- **Credentials:** the platform's restricted credential from Martin's `.env.local` (account "Restro Sandbox", test mode), with `Stripe-Account`. The harness's own credential (`STRIPE_HARNESS_KEY`) only reads the balance, which the platform's may not.
- **Account:** the sandbox's harness connected test account `acct_1UUjd8H6CXJeKV2v`, made for #107's conformance recordings. No new account was made.
- **Card and versions:** test card `pm_card_amex_threeDSecureNotSupported` (the provider's hold with `request_three_d_secure: any`, confirmed server-side). stripe-node 23.0.1, API `2026-09-30.endive`.
- **Not used:** the Stripe CLI, a browser.
- **Asserted on every run:** the created, confirmed, captured and cancelled payments are `livemode` false.

| Check | Result | Date |
|---|---|---|
| 1. The key | **passed** | 2026-10-29 |
| 2. The hold, captured (also in part) | **passed** | 2026-10-29 |
| 3. The hold, released | **passed** | 2026-10-29 |
| 4. Notices | waiting for Martin (needs a staging deploy at a public HTTPS address) | – |
| 5. Wallets | waiting for Martin (needs the staging deploy and a real phone) | – |
| 6. 3-D Secure | waiting for PR #195 (the card form) to reach `or/foundation` | – |

## Check 1: the key

- **Refunds refused.** `POST /v1/refunds` as the platform, with `Stripe-Account`, on a captured payment: by `payment_intent` → 403 `more_permissions_required`; by `charge` → 403 `more_permissions_required`. The charge afterwards has `amount_refunded` 0 and `refunded` false.
  - Payment: `pi_3UVhf3H6CXJeKV2v0Mjx513T`, charge `ch_3UVhf3H6CXJeKV2v0TNsNvni`.
  - Refused requests: `req_UbE7aUCfeagM9X` (by payment), `req_VpDIXMaEDCrjrP` (by charge).
- **Create, capture and cancel with `Stripe-Account`.** All answered 200.
  - Requests: create `req_DFK0ytlVIT2oB9`, confirm `req_diUIPyLarPvCQm`, capture `req_5frcPMpxzQM8Yi`, cancel `req_YzejswwpOuOL1H`.
  - Cancelled payment: `pi_3UVhf9H6CXJeKV2v1DWDKJsU`.
- **The provider's own code path.** `createHold`, `readPayment`, `capture` (600 of 1000) and `release` also worked against the sandbox.
  - Held and captured 600: `pi_3UVhfBH6CXJeKV2v1k4NSBjg`.
  - Released: `pi_3UVhfDH6CXJeKV2v0pQknIZe`.
- **`expand[]=latest_charge`.** `GET /v1/payment_intents/pi_3UVhf3H6CXJeKV2v0Mjx513T?expand[]=latest_charge` (`req_c8eh1L8zcPUx4a`) returned the charge as an object (`captured` false while held).

## Check 2: the hold, captured

- A 1000 EUR hold reached `requires_capture` (`amount_capturable` 1000, charge `captured` false, `capture_before` set on the held charge, asserted). Capture of 1000 → `succeeded`, `amount_received` 1000, `amount_captured` 1000; exactly one balance transaction on the charge, type `charge`, 1000 (`req_i1mHyzANk7ksWM`).
- **Partial:** `pi_3UVhf6H6CXJeKV2v0aMvjCvW`, capture 600 of 1000 (`req_YoNpXWPB25LlnV`) → `succeeded`, `amount_received` 600, `amount_capturable` 0, `amount_captured` 600; exactly one `charge` balance transaction, 600 (`req_LNrTtuFzDZuY8N`, charge `ch_3UVhf6H6CXJeKV2v0PpCv6s8`). The other 400 never moved.

## Check 3: the hold, released

- `pi_3UVhf9H6CXJeKV2v1DWDKJsU`, confirmed to `requires_capture`, then cancelled (`req_YzejswwpOuOL1H`) → `canceled`, `amount_received` 0. Its charge `ch_3UVhf9H6CXJeKV2v1AQicD72`: `captured` false, `amount_captured` 0, `balance_transaction` null. Balance transactions listed by that charge: none (`req_uID2lpHKcb91ge`, count 0). A capture afterwards → 400 `payment_intent_unexpected_state` (`req_7fUKxnnp61Fvo0`). The released hold cost nothing in the balance.

## Checks 4 and 5: waiting for Martin

Both need a staging deploy at a public HTTPS address (Martin's OK) and, for 5, a real phone. Not attempted.
- 4: a test connected account's events reach the notice route with valid signatures; the live/test check holds.
- 5: Apple Pay and Google Pay show on a real phone with the domain registered through the API; `capture_before` read on a wallet payment.

## Check 6: waiting for the card form

Stripe's 3-D Secure test cards completing inside the page with no redirect needs the card form of PR #195 on `or/foundation`. Its result, and checks 4 and 5 once done, go in a new dated deliverable that revises this one.

## Failures

None in checks 1–3, so no bug ticket.
