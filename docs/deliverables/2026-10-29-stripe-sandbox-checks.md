# Stripe sandbox checks (#117)

The six checks before the pilot (D127, design §13), run by the #117 agent against "Restro Sandbox" on 2026-10-29. Evidence is request ids and object ids only, never a key. Facts learned also sit in `2026-10-22-stripe-knowledge.md` as C29 [SANDBOX] lines.

**How they were run:**
- **Script:** `packages/payments/stripe/src/testing/sandbox-checks.test.ts`, skipped unless `STRIPE_SANDBOX_CHECKS=run` is set (CI never sets it, so CI never reaches Stripe). It stops before any request unless both credentials are sandbox ones (`rk_test_`/`sk_test_`).
- **Credentials:** the platform's restricted credential from Martin's `.env.local` (account "Restro Sandbox", test mode), with `Stripe-Account`. The harness's own credential (`STRIPE_HARNESS_KEY`) only reads the balance, which the platform's may not.
- **Account:** a connected test account made earlier through the platform's own connect flow (`acct_1UUjd8H6CXJeKV2v`).
- **Card and versions:** test card `pm_card_amex_threeDSecureNotSupported` (the provider's hold with `request_three_d_secure: any`, confirmed server-side). stripe-node 23.0.1, API `2026-09-30.endive`.
- **Not used:** the Stripe CLI, a browser, a new account.

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
  - Payment: `pi_3UVgvyH6CXJeKV2v0KvEujLV`, charge `ch_3UVgvyH6CXJeKV2v0n35vAdD`.
  - Refused requests: `req_iLK1aUdYmbz7ul` (by payment), `req_NH6gkCYkr0tAmA` (by charge).
- **Create, capture and cancel with `Stripe-Account`.** All answered 200, every object `livemode` false.
  - Requests: create `req_GyWrcU9pacD9OA`, confirm `req_DVBZOscA233ybA`, capture `req_RLOV8DPiC6VFH8`, cancel `req_xUeVvB8QwmnyNp`.
  - Cancelled payment: `pi_3UVgw4H6CXJeKV2v0KaWJN8G`.
- **The provider's own code path.** `createHold`, `readPayment`, `capture` (600 of 1000) and `release` also worked against the sandbox.
  - Held and captured 600: `pi_3UVgw6H6CXJeKV2v1KNA4nJe`.
  - Released: `pi_3UVgw9H6CXJeKV2v18gLfyLP`.
- **`expand[]=latest_charge`.** `GET /v1/payment_intents/pi_3UVgvyH6CXJeKV2v0KvEujLV?expand[]=latest_charge` (`req_x0p9LTNy8m8BSz`) returned the charge as an object (`captured` false while held).

## Check 2: the hold, captured

- A 1000 EUR hold reached `requires_capture` (`amount_capturable` 1000, charge `captured` false, `capture_before` present on the held charge). Capture of 1000 → `succeeded`, `amount_received` 1000, `amount_captured` 1000; one balance transaction of type `charge`, 1000 (`req_L8BnsBo3pNAwLR`).
- **Partial:** `pi_3UVgw2H6CXJeKV2v1W1enZOH`, capture 600 of 1000 (`req_FhsPX3LC5Qzhd4`) → `succeeded`, `amount_received` 600, `amount_capturable` 0, `amount_captured` 600; one `charge` balance transaction, 600 (`req_Bu1MzN3BxiRHwV`, charge `ch_3UVgw2H6CXJeKV2v1ku2b6GB`). The other 400 never moved.

## Check 3: the hold, released

- `pi_3UVgw4H6CXJeKV2v0KaWJN8G`, confirmed to `requires_capture`, then cancelled (`req_xUeVvB8QwmnyNp`) → `canceled`, `amount_received` 0. Its charge `ch_3UVgw4H6CXJeKV2v0PJ5D7VV`: `captured` false, `amount_captured` 0, `balance_transaction` null. Balance transactions listed by that charge: none (`req_ij7W1oKlhZ8df5`, count 0). A capture afterwards → 400 `payment_intent_unexpected_state` (`req_BF1Ys23QpKXaJB`). The released hold cost nothing in the balance.

## Checks 4 and 5: waiting for Martin

Both need a staging deploy at a public HTTPS address (Martin's OK) and, for 5, a real phone. Not attempted.
- 4: a test connected account's events reach the notice route with valid signatures; the live/test check holds.
- 5: Apple Pay and Google Pay show on a real phone with the domain registered through the API; `capture_before` read on a wallet payment.

## Check 6: waiting for the card form

Stripe's 3-D Secure test cards completing inside the page with no redirect needs the card form of PR #195 on `or/foundation`. To be run and added here after it merges.

## Failures

None in checks 1–3, so no bug ticket.
