Made by: independent reviewer (Opus), 10-21. For: Martin and the lead.

# Map #29 after the 10-21 redraw: an independent review of the open tickets

## Verdict

**Alignment: adequate.** The redrawn map takes Martin's 10-21 rule seriously: paying is in the pilot, and nothing plans around a pilot without it. Two tickets still re-ask settled points: #54 on refunds and #49 on the payment form. **Comprehensiveness: weak.** Ordering, paying and Tonight are well covered. But no ticket covers the guest template, the owner's setup screens, the service-data model, or the checks due before the pilot. As drawn, the map can't "clear" until Mistral answers, so the POS-neutral spec waits on an outside company for no reason.

## Coverage

| Workflow step | Where it stands |
|---|---|
| Connect the POS (Mistral) | #48 (answers), then fog ("the Mistral connector itself") |
| Connect the payment provider | #49 |
| Owner settings: service hours, guards, pay-first levels, payment tables, alert recipients, minimum card payment | Rules decided (D122 §4, §5, §7). Screens are a **gap**: only the composer's payment mode is in the fog |
| Open tables for phones, sittings | D122 §4; staff screen in #50 |
| Scan, consent, location pass | D119, D121, D122 §4 |
| Order, Send, "did it land" | D116, D117, D122 §4. On Mistral: #48 (Q15). On barsy: #47 |
| Pauses | D120, D122 §6 |
| Pay-first | D113, D122 §5; screens in #45, commands in #53. The **route at a one-bill POS is missing** from D122 §8 (see finding 6) |
| Pay your own lines, pay the whole bill | D122 §8; #45, #53 |
| Group payment, paying a share | Fog, deliberately later (D112) |
| The receipt | D122 §8; law in #52. **Gap:** how the paper receipt reaches the payer |
| Payment unconfirmed, a failed last check | Merged fix 1, D122 §8; #54 and #50 overlap |
| Refunds | D112 and merged fix 9 already decide them; #54 reopens them (finding 2) |
| Disputes | D122 §8 (evidence); #54 |
| Tonight | D122 §7; #50 |
| End of night | D122 §7, merged fix 27; #54 |
| Roles, PIN, Telegram | Policy in D122 §7. **Gap:** the permission list, and how it fits the existing organisation roles and D99's DJ role |
| Guest template and shell contract | **Gap** (finding 1) |
| Service-data model and retention | D122 §9 names it. **Gap:** no ticket (finding 5) |
| Demo and staging | #51 |
| Law | #52. **Gap:** privacy (T31) is not linked to the map |
| Checks before the pilot | Rehearsal and staff card are in the fog. Everything else is a **gap** (finding 12) |
| Tips | **Gap:** D112 "decided after ordering"; #45 only asks where a tip would go |
| Call a waiter | D122 §4 (still card); fog asks Martin |
| If Mistral says no | **Gap** (question 1) |

## Findings, most important first

**1. No ticket covers the guest template, and the template guide contradicts D122.**
- `docs/guides/menu-template-functionality.md`, sections Pay and Receipt, describes things D122 no longer has:
  - paying "a share", a promo code and a payment method choice;
  - a receipt "as the host issued it";
  - a note on every order;
  - "rounds from guests and staff" on the bill.
- The guest screens live in the face (D71) and draw the shell's service state (D72). D122 adds many new ones:
  - consent and the location pass;
  - "Show this to your waiter" (40 px, 7:1 contrast);
  - each sent order's state on every phone;
  - last orders;
  - "Send the other 4";
  - "Preparing your bill…";
  - the Paid screen.
- `build.md` Feature step 3 requires the guide to be revised in the same change.
- **Fix:** a new ticket, *"What the shell gives the template for ordering and paying, and what the template draws"* (task). It revises the guide and the services contract and ends in a `template-design` run. It is blocked by #45 and #53.

**2. #54 re-asks points that are already settled, and contradicts two decisions.**
- What is already decided:
  - "Refunds happen at the venue, in its payment provider's dashboard … not through Restro" (D112, Money);
  - Restro's key "can create, take and cancel payments only, never refund" (merged fix 9; D122 §8);
  - no refunds at night: Martin, "Not now" (board answers TF4);
  - what staff do with "payment unconfirmed": answer "Receipt printed" or "No receipt" (merged fix 1);
  - a capture that fails is retried, then reversed by a storno (merged fix 2);
  - what the reconciliation lists (merged fix 27).
- #54 still asks "who may refund", "during the night or afterwards" and the staff actions.
- **Fix:** shrink #54 to what is really open:
  - how a refund made in the provider's dashboard shows on Restro's records and on the night page ("Make the storno in the POS now");
  - how the venue gets the dispute evidence (F23: a PDF is a later nicety).

  Make it a task, not a grilling.

**3. The spec waits on Mistral for no reason.**
- The Notes run to-spec only "when the map clears". The map can't clear while the Mistral connector is fog, and #48 (not yet sent) has no date.
- **Fix:** split the end of the map:
  - a POS-neutral spec once #45, #49, #50, #51, #53, #54 and findings 1, 4 and 5 are done;
  - the Mistral connector's own spec after #48.
- #48 is the longest pole: Martin should send it now.
- Fold T69 (tracker) into #48, so the same request isn't tracked twice.

**4. No ticket for the owner's setup screens.**
- D123 says a screen plan is written in the planning, never by the implementer.
- D122 creates many settings, none with a screen plan:
  - service hours and the closing hour;
  - the guard box;
  - pay-first at three levels;
  - marking payment tables;
  - the card type in the POS list;
  - the minimum card payment;
  - the pre-opening check;
  - roles and the PIN;
  - Telegram linking;
  - connecting the provider.
- **Fix:** a new ticket, *"How the owner sets up ordering and paying, and in how many taps"* (prototype with a screen plan). Move the fog's "the composer" line into it.

**5. No ticket for the service-data model.**
- D122 §9 names a second write path, but nobody has specified:
  - its tables (order, sent order, locks, readings, sittings, payments, the Log);
  - row-level security for them;
  - the retention matrix: the Log 31 days, payment records and guard changes 18 months, notes erased at 31 days by a column purge through `restro_purge` (open-items, #40 follow-up 2).
- The role model is missing too: custom roles per venue (D122 §7) next to the Better Auth organisation roles and D99's DJ role, which another owner runs.
- **Fix:** a new grilling with `codebase-design`, *"Service data: its tables, its write path, roles, and how long each record is kept"*. It feeds the architecture-doc update the Notes already plan.

**6. The capability list lacks the paying capabilities, and pay-first has no route.**
- D122 §3 lists twelve capabilities but none for paying:
  - "close a bill with a chosen card payment type";
  - "open, pay and close a sale in one call".
- So #48's test, "every capability of D122 §3 reads yes, no or unknown", would pass without Mistral questions 4 and 26.
- D122 §8's four steps cover lines already on the bill. The pay-first route that round 1 approved (6.10: enter the order on a payment table with "for Table 7", then pay and close) is in no decision or ticket.
- **Fix:**
  - #53 adds the pay-first route as a fifth neutral step, and the payment queue and deadlines from round 1 §8.1;
  - #48's resolution names the paying capabilities.

**7. #49 re-asks Martin and asks him technical things.**
- Martin already chose: "Restro opens the payment provider's embedded payment form" (round 1, 6.6). #49 asks "hosted checkout or an embedded card form" again.
- 3-D Secure, sandbox and test cards, and capability flags are technical. The lead decides and reports them (memory: technical tuning).
- #49 misses three points:
  - whether the venue agrees to open its own account, and which acquirer it already uses (Mistral Q9 mentions a myPOS partnership). This question belongs in #48's venue list;
  - whether the provider can limit Restro's key to create, capture and cancel (fix 9). Stripe's restricted keys fit (`2026-10-17-payment-providers-feasibility.md` line 90);
  - turning off the provider's own emailed "receipts", which could be mistaken for the venue's receipt.
- D98's condition, "chosen after the lawyer's Q74 and Q75", needs lifting explicitly: Q75 belongs to song requests, which are out of scope.

**8. Blocking edges are missing.**
- #49 → #45: the guest's steps depend on the payment form and on Apple Pay.
- #54 → #50: the money alerts on Tonight.
- #48 → the Mistral connector, when it becomes a ticket.
- #52 and T31 → the pilot.
- #45 still lists #36 (closed). That edge is harmless but stale.

**9. #45 is too wide and reopens D30.**
- Martin dropped the countdown and "someone is paying · 1:42" (round 1, 3.2 and 6.6), and paying a share is later. So "decide D30 here" has no case left. Record D30 as superseded instead.
- Tips are Martin's call (question 2), not a prototype's.

**10. #52's law list is incomplete.** It misses:
- Q63: does Restro count as sales software now that it writes and closes bills?
- Q67 and T31: GDPR roles, the DPIA, the venue agreement (DPA), and the payment provider's role;
- Q10: tips, if they come in;
- the guest's payment terms.

**11. Nothing says how the paper receipt finds the payer.**
- D122 §8 says "the waiter brings it". Board Q16's proposal was never adopted: the reference on the ticket, the reference on the Paid screen, and a staff-card line.
- #50 has no "receipt to bring" item (`2026-10-21-staff-screen-prototype.md` never mentions receipts).
- **Fix:** add it to #50 and #45.

**12. The checks due before the pilot are scattered.** None is ticketed:
- Martin's field test of the radius (D118);
- the Safari location re-prompt (open-items, #40 follow-up 1);
- whether Railway logs headers (D122 §9);
- the 600-phone load test (merged fix 20);
- the NRA list re-check;
- deploy windows;
- the rehearsal and the staff card.

**Fix:** a new task, *"The pilot readiness list"*.

**13. Smaller points.**
- **#51:** a simulated POS is a connector package that only the worker imports, not part of the integration layer (CLAUDE.md, three layers). Each unknown Mistral behaviour should be a switch that defaults to the cautious answer, for example Mistral question 30.
- **#53:** two CLAUDE.md rules will catch the spec writer.
  - "Only `apps/worker` imports a connector package", but Pay needs the provider's session while the guest waits.
  - The "no webhooks" lines are about POSs, but the provider's notices are webhooks.

  #53 should say where provider calls run. Any CLAUDE.md wording change needs Martin's OK.

## What is good

- The destination, the Notes and the pilot rules match D122 and Martin's answer A exactly.
- Every ticket is phrased as a question, with a "resolved when".
- The Mistral questions are in one list, with the authorisation first.
- #50 carries Martin's design criticism faithfully.
- #53 splits the work properly: the lead decides technical points, Martin decides behaviour.
- Group payment, hand-made venues and the DJ queue are out on purpose, with reasons.

## Questions only Martin can answer

1. **If Mistral refuses, or doesn't answer for weeks** (no authorisation, no API or no test installation), what does the pilot do? Wait, move to another club, or something else?
2. **Tips in the app at the pilot:** yes or no?
3. **"Call a waiter":** on 10-21 you decided it stays a still card at the pilot. Does "the pilot runs the whole workflow" change that? Building it means waiters' watches.
