# Repair-review of `or/foundation`: report to Martin

10-31. The full record is [findings.md](findings.md). Your 35 minutes are in [hands-on.md](hands-on.md).

## Verdict
The ordering and paying work is now sound enough for you to test by hand. It isn't ready for a pilot: a real venue can't order on the real guest template until the Design lead's branch lands, and nothing has run on staging, a real phone or a real POS.

## The numbers
93 items were raised and judged: 1 critical, 20 high, 32 medium, 40 low.
- **Fixed: 67** (the critical, 16 high, 28 medium, 22 low). All were re-checked on the merged code, by tests; 20 of them were also walked on screen. Phone alerts are checked only as far as a local browser goes, and one low item is fixed only in part.
- **Not real, or closed by a test: 11. Downgraded to observations: 6.**
- **Left: 9.** Two are high: one needs a fact from staging (item 1 below), and one is the guest template on the Design lead's branch. The other seven are low or medium: accepted risks, deploy-list items or your calls below.
- 48 smaller observations are listed in the ledger for you to pick from.

Final check on the merged code: 312 browser tests passed, none flaky, 135 skipped. Organisation-isolation checks: 1,243 passed, 19 known and expected to fail, 3 skipped.

## The worst we found (all fixed)
- **Critical:** a line stuck in an unconfirmed payment could be paid a second time, so a guest could be charged twice.
- **Phone alerts did not exist.** No staff phone could ever buzz for a paused bar or a failed payment.
- **A lost connection** replaced Tonight with the browser's error page until someone reloaded.
- **The bar tablet could reach owner writes,** such as editing and publishing the menu. A waiter at two venues could answer one venue's order through the other.
- **Bad states on the money path:** a table move during a payment, and lost provider access, weren't handled safely.

## Why it happened
Mostly two things: work closed without anyone looking at the screen, and gaps between tickets that each looked done alone. The walk of the fixes still raised 12 more points, so a walk on screen should stay part of closing work.

## Not proved
Real phone alerts, Apple and Google Pay, Stripe's signed notices, any real POS, and ordering on the real template.

## Yours to decide
Each has my recommendation; a plain "yes" takes it.

| # | Question | Recommendation |
|---|---|---|
| 1 | One read-only query on staging. If the hosted database owner can't bypass row security, **every QR scan fails** (RR-43) | Yes, first: it is the biggest unknown |
| 2 | Staging for a real-phone test of alerts on Chrome, Samsung and Safari | Yes, after your hands-on |
| 3 | Two Stripe sandbox checks: reading refunds with our key, and an abandoned account | Yes |
| 4 | Which account signs in on the bar tablet? An owner's would ring with money alerts and show tips | A staff-only account |
| 5 | Who may edit the menu? A plain member could, though no one can create one today (RR-70) | Owner and admin, before invites return |
| 6 | Money alerts after closing: D120 and D122 disagree. I followed D122, so they keep repeating | Keep D122 |
| 7 | A guest can't pay by phone after closing and pays the waiter. This follows D122 | Keep |
| 8 | Must a venue set a privacy link before ordering goes on? | Yes, confirm with the lawyer |
| 9 | Wording to tidy in decisions: "never resend" (D112, D116), the payment address clean-up and "refunds stay none" (D127) | Let the lead word them |

I made one guard call myself under D67: turning alerts on is allowed on the tablet without a PIN.

## Accepted risk
On a POS with no reference, one identical waiter round can be counted as Restro's. The alternative sends every hung order to staff.

## Questions for Lukanet and Mistral
Does a line keep its id when moved? Can a tip go on the receipt? What is the rate limit? Do discounts come as lines? What do the fiscal-memory fields carry? Until a POS states a limit, Restro stays at a cautious 5 calls per second.

## For deploy day
Set Turnstile, `PAYMENTS_ENV` and the three alert keys. Add the Cloudflare rules (RR-7, RR-75). Upgrade `next` and clear 14 known vulnerabilities (PR #203).

## Smaller things
- Copilot review is out of quota, so my reviews stood in for it. Please check the quota.
- Decide whether the 135 skipped browser tests should run nightly.
- A CI job should replay migrations with an owner that can't bypass row security.
