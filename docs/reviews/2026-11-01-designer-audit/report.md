# Designer audit: report for Martin (2026-11-01)

**What was audited:** the menu designer wave on `st/foundation` at `7dccd3a4` (spec #168, tickets #169-#178, #239, #258), on this PC only: our own test databases, the simulated POS and the simulated payment provider. Seven of the plan's eight steps are done; step 6 (behaviour as people use it) waits for your walk notes. Every finding below was confirmed by a red test, a reproduction, or two independent checkers. The ledger is `findings.md` in this folder.

**Correction to the plan:** the wave has **48** design options on 14 pages, as decision 130 says, not 60.

## The count

| | High | Medium | Low | Observations |
|---|---|---|---|---|
| Confirmed | 8 | 11 | 12 | 17 |

Nothing critical: no money lost or taken twice, no other organisation's data reachable, no POS write outside a waiter's acts.

## The eight highs, one line each
1. **Send with pay first (DA-1):** a refused pay-first part blocks the bill lines too. Your answer (11-01) sets the fix: the bill lines go; below the card limit, a greyed part with Pay cash that calls a waiter with the bill; while another payment runs, "try again in a moment".
2. **Call a waiter (DA-2):** a lost answer shows "Request sent".
3. **A bill with a discount line (DA-8):** a negative line from the POS crashes Bill and Pay, and the whole menu turns into the load-failure notice.
4. **Stop the location check (DA-9):** with ordering on and Bill off, no way to stop it after the first round.
5. **An open call (DA-10):** can't add a kind, and Cancel always fails.
6. **The Paid screen (DA-11):** the payment number isn't large, so staff can't read it across the bar.
7. **A future design-option change (DA-15):** adding, removing or renaming one option would break every published menu, admin reads and republish, with no way out but a code fix. Not live today; it must be fixed before the first such change.
8. **Send stalls up to two minutes (DA-34):** the job library skips a table that was busy at its last once-a-minute snapshot, so a table's next round can wait 30-120 s on Sending, and every busy table waits after a restart. Nothing lost or doubled. This is ordering code (or/foundation), found through its tests; payments may stall the same way (untested).

## What held
Two saves at once (one wins, no half-merge); a save during a publish; Style names; tenancy and every lesser role on the new actions; logos and Styles never cross venues or organisations; hostile values never reach the guest page; no POS ids or internal fields in published files; the old menus' data survives the migrations, and all 34 old snapshots still draw. Five of nine deliberate breakages were caught by the tests.

## Things to know
- **On deploy day every venue moves to the Basic look** (the Editorial Market template is retired, DA-O4); owners pick a Style again.
- **Tests that miss things:** the venue's look reaching Stripe's card form, two My styles cases, the section rail following a scroll, the save-refusal messages (DA-35 to DA-38). Each gets a test in the fix wave.
- **Not covered:** the Stripe sandbox (not OK'd for this audit), the slower test-quality mutations M5-M8, and payments under the stall.
- **A Next.js notice** in the build output asks the reader to run an upgrade; treated as data, logged as DA-O12 for a later Upkeep look.

## Next
1. Your walk notes, then step 6.
2. Fix tickets labelled `designer-audit`: the highs first, the mediums and the missing tests with them; DA-34 as its own ticket on or/foundation.
3. Fixes merge once #285 (split CI) lands and you OK the Design lead's fixers working into st/foundation.
