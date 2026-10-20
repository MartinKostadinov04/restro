Made by: independent agent (Opus), 10-21

# Payment numbers check (phase 2, paying in the app)

Five numbers behind the payment design, checked against primary sources. For each: is it right, how it varies between providers, and does the design step hold.

## 1. How long an authorisation stays valid

**Verdict: partly right.** "About 7 days" is the safe floor, but the card-scheme rules differ, and "myPOS 30 days" is not a safe number for us.

- **Visa:** 10 calendar days for an online payment the guest starts (card-not-present, cardholder-initiated), since 13 April 2024. Source: [Visa notice via TD](https://td.com/content/dam/tdct/document/pdf/business-banking/visa-authorization-changes-en.pdf); [Adyen's table](https://docs.adyen.com/online-payments/adjust-authorisation/) says the same.
- **Mastercard:** 7 calendar days for a final authorisation, 30 days for a pre-authorisation. Source: Mastercard Transaction Processing Rules, 9 June 2026, rules 2.5.1 and 2.7 (copy at the repo root, `transaction-processing-rules.pdf`).
- **Stripe:** applies 7 days to both. It also returns the exact deadline per payment (`capture_before`). Source: [Stripe](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method).
- **myPOS:** the 30 days is its own auto-cancel rule for terminal pre-authorisations. It is not stated for online payments, and Visa's 10 days still applies to a bar. Source: [myPOS help](https://help.mypos.com/hc/en-gb/articles/6882371009821-What-is-pre-authorization).
- **Viva:** says a debit card's issuer may drop the hold after 1–5 days. Source: [Viva](https://developer.viva.com/tutorials/payments/handle-pre-authorizations/).
- **Borica virtual POS:** completion within 30 days, but **only one completion attempt**, successful or not. If it fails, a new pre-authorisation is needed. The status check (TRTYPE 90) only covers the last 24 hours. Source: [BORICA CGI v7.0, §4.5](https://3dsgate-dev.borica.bg/P-OM-41_BORICA_eCommerce_CGI_interface_v%207.0_EN.pdf).

**Realistic range:** 7 days (Stripe, Mastercard final) to 10 days (Visa). Plan for 7.

**Design steps:**
- *Retry the capture with the same idempotency key through the service day:* **change.**
  - Stripe stores the first answer to a key and replays it, **including a 500 error**, and forgets keys after 24 hours ([Stripe](https://docs.stripe.com/api/idempotent_requests)). Adyen keeps keys 7–14 days ([Adyen](https://docs.adyen.com/development-resources/api-idempotency/)).
  - The service day is also the wrong clock: a payment at 06:30 would get 30 minutes of retries.
  - New rule: reuse the same key only while the outcome is unknown (timeout, dropped connection). After a clear error, read the payment's status first. If it can still be captured, try again with a new key (payment id + attempt number).
  - Count from the authorisation: retry at 1, 5, 15 and 30 minutes, then hourly up to 48 hours.
  - For Borica, never send a second completion. Read the status (TRTYPE 90) within 24 hours instead.
- *Alert the Restro team after 1 hour:* **holds.** Also alert at once on an error that will not go away: authorisation expired or cancelled, or a Borica completion that failed.
- *Storno after 4 days:* **the timing holds.** Day 4 is inside the 7-day floor. It also always falls before the 7th of the next month (see 5). Add a hard stop: no capture attempt within 12 hours of the provider's own deadline. Whether a storno is the right remedy at all is the open point in 5.

## 2. How late a chargeback can come

**Verdict: partly right.**
- The main limit is **120 days**, not "30–120". It counts from the processing date, or from the date the guest expected the service. That later date can push it to at most 540 days from processing. This is the same at Visa and Mastercard. Sources: [Visa disputes FAQ](https://usa.visa.com/dam/VCOM/global/support-legal/documents/faq-apr-disputes.pdf); [UK Ombudsman reading the Visa rule](https://www.financial-ombudsman.org.uk/decision/DRN-5881403.pdf).
- After that the merchant's reply, pre-arbitration and arbitration add roughly 1–3 months.
- A drink is served the same night, so our realistic worst case is about 120 days plus 3 months, under a year. The 540 days only matters for something paid now and delivered later, such as a table booked for a future night.

**Design steps:**
- *Evidence kept 18 months:* **holds.**
  - Count the 18 months from the service date.
  - Keep the record while a dispute is open, and for 6 months after it closes.
  - Add to the evidence:
    - the time the order was marked served, and by which staff account. "I never got it" (Visa 13.1) is the likeliest bar dispute;
    - the provider's payment id and authorisation code;
    - the card brand and last 4 digits;
    - the fiscal memory number next to the receipt number.
- *Log erased after 31 days:* **holds.** Copy the evidence onto the payment record when the payment is captured. A dispute arrives after the Log is gone.

## 3. Separate authorise and capture

**Verdict: right, with a real risk at myPOS.**

| Provider | Supports it | Catch |
|---|---|---|
| Stripe | Yes (`capture_method=manual`) | None found |
| Adyen | Yes (manual capture) | Usually onboards larger merchants |
| Viva | Yes, Smart Checkout with pre-auth on | An account setting must be ticked ("Allow recurring payments and pre-auth captures via API") |
| myPOS | Yes (`IPCPreAuthorization`, `IPCIAPreAuthorization`, completion, cancellation) | Support must switch it on, and grants it mainly to **hotels, car rentals and cruise lines**. A nightclub may be refused. |
| Borica bank POS | Yes (TRTYPE 12 / 21 / 22) | One completion only; the bank may add terms |

Sources: [Stripe](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method), [Adyen](https://docs.adyen.com/online-payments/capture/), [Viva](https://developer.viva.com/tutorials/payments/handle-pre-authorizations/), [myPOS API](https://developers.mypos.com/en/doc/online_payments/v1_4/20-api-reference), [myPOS activation](https://help.mypos.com/hc/en-bg/articles/6882468303517-How-can-I-use-the-pre-authorization-functionality), Borica CGI v7.0 §4.4–4.6.

**Design step (go/no-go):** **holds.** Make it a written answer from the provider, not a feature listed on its website. Ask four things:
1. Is it approved for a bar (MCC 5813)?
2. How many days is an online authorisation valid?
3. Can a failed capture be retried?
4. How do we read a payment's status?

## 4. pg-boss defaults (installed: 12.35.1)

**Verdict: the numbers are right. What they mean is partly wrong.** Source: `node_modules/.pnpm/pg-boss@12.35.1/node_modules/pg-boss/dist/plans.js` (`QUEUE_DEFAULTS`, `failJobsByTimeout`), `attorney.js`, `types.d.ts`.
- `retryLimit` 2 and `retryDelay` 0: verified.
- `expireInSeconds` 900: verified. But it is the longest a job may run (counted from its start), not a crash detector.
- A separate checker (`superviseIntervalSeconds`, default **60**) fails jobs that are over time. So a crashed job is noticed after 15–16 minutes.
- When the time runs out, pg-boss stops waiting but does not stop our code (it only fires `job.signal`). A POS call already sent can still land after the job is marked failed.
- This version has a real crash detector: `heartbeatSeconds` (minimum 10, off by default; pg-boss renews it on its own). It also has `deadLetter`, which moves failed jobs into a named queue.

**Design steps:**
- *No automatic retry* (`retryLimit: 0`): **holds.**
- *First step reads what already happened:* **holds.**
- *Expiry of about 2 minutes:* **holds as an upper limit**, if:
  - every POS or provider call has its own timeout of 30 seconds or less;
  - the handler checks `job.signal` before each write.
- *Recovery sweep every 15 seconds:* **change.** Our own sweep cannot see a dead job sooner than pg-boss's 60-second checker marks it. Use:
  - `heartbeatSeconds: 10` and `superviseIntervalSeconds: 15`. A crash is then noticed in about 10–25 seconds.
  - `deadLetter: 'payment-recover'`, whose handler is the read-first step.
  - Our own sweep every 60 seconds, only for payment records stuck with no job at all (for example, the web server died just after the provider approved).

## 5. Bulgarian storno deadline (Наредба Н-18, чл. 31)

**Verdict: right.**
- Current text on [lex.bg](https://lex.bg/laws/ldoc/2135540645), last amended ДВ бр. 42 / 2025.
- Ал. 3 lets a storno for "операторска грешка" go through even when the cash drawer is short, "включително по отношение начина на плащане" (including the payment method).
- Ал. 4 sets the deadline: by the 7th of the month after the error.
- Neither has changed since 2020.
- The 2025 change added ал. 3а: card refunds by storno without cash in the drawer. It applies only to approved ИАСУТД systems, not to an ordinary fiscal device.

**Does a payment that was never captured count as operator error? Plausible, not safe. Needs a lawyer.**
- Against: the guest got the drinks. The receipt was right when printed, because чл. 25 ал. 6 says the receipt is issued at payment, and the card had approved. A storno would remove turnover for goods that were actually consumed.
- For: the "payment method" wording in ал. 3.
- A secondary source on NAP's practice says that after the deadline the receipt stays as it is, and the fix is made in the books only ([kik-info](https://kik-info.com/stanovishta-na-nap/7db786449c1a03d6cbcc87f9fa719fb2)).

**Design step:** keep day 4. A 4-day wait always lands before the 7th of the next month. But make it the venue's decision, with the reason prefilled, not an automatic storno, until a lawyer answers two questions:
1. Does an uncaptured card payment allow a storno for "операторска грешка"?
2. If not, should the sale stay on the receipt and be written off in the books?

## What I'm unsure of

- **myPOS:**
  - Its online pre-authorisation validity is not published.
  - The help pages blocked my fetch (403). The activation terms come from search excerpts of myPOS's own pages.
- **Viva:** its pages timed out, so its figures come from search excerpts of Viva's own docs.
- **Chargeback limits:** come from Visa's FAQ and an ombudsman decision, not the Visa Core Rules text. I did not read Mastercard's Chargeback Guide.
- **Mastercard coding:** I do not know whether each provider codes manual capture as a pre-authorisation (30 days) or a final authorisation (7 days). Planning for 7 covers both.
- **Visa Compelling Evidence 3.0:** it would need device and IP data from earlier payments by the same card. I did not weigh that against keeping as little data as possible (data minimisation).
- **Borica:** I did not check whether it offers an embedded form or only a redirect to its own page.
