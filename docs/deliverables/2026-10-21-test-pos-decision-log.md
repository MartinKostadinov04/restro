# Decision log: "A simulated test POS and payment provider, so the pilot's workflow is built and tested before Mistral answers" (#51)

Made by: the ordering lead session (Opus), 10-21, from the Opus design agent's proposal (`2026-10-21-test-pos-design.md`). For: anyone who needs #51's decisions at a glance, and the spec and tickets of map #29 "Ordering from the menu".

#51 is a technical grilling: the lead decides and reports, while a conflict between two binding texts goes to Martin. Each row has a **status**:
- **firm:** decided;
- **later:** decided to come later;
- **on request:** built only when a venue asks;
- **out:** out of scope;
- **open:** waits on a fact or a ticket.

**Recorded in** names the binding text. The design file holds the detail behind each row (its §8 numbers the same rows).

## 1. The simulated POS

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | **The simulated POS is `packages/connectors/sim-pos`** (kind `sim`), imported only by `apps/worker`. The dependency rule becomes `connectors-only-from-worker` over `packages/connectors/`. | The three layers; a neutral name; the guard only tightens (D67). | firm | D122 §9 |
| 1.2 | **The connector interface is eight operations:** probe, read the floor, read a table, add lines, and D122's four payment steps (`isolateLines`, `readIsolated`, `payAndClose`, `undoIsolate`). A timeout answers `unknown`, and a reading with any failed part answers "not complete". | The order of steps stays in the platform; rule 6 and D115 are enforced at the seam. | firm | D122 §9 |
| 1.3 | **The simulator is a pure engine behind a POS-shaped wire,** served both by a standalone server and by MSW handlers, with its state in memory and an optional JSON snapshot. It never touches Postgres. | Two transports keep the seam real; no second database writer. | firm | D122 §9 |
| 1.4 | **Switches with cautious defaults** (design §2.4), each tied to a Mistral question, and two profiles: `cautious` and `pilot` (adds moving lines and closing with a payment type). Anything the switches don't state throws. A new switch needs a Mistral question number. | Invent no POS behaviour; the simulator must not grow into a product (risk 2). | firm | D122 §9 |
| 1.5 | **Fault plans are deterministic,** with seeded random faults. | Failures a test can reproduce. | firm | D122 §9 |
| 1.6 | **The waiter's side is simulated by engine calls, a CLI and the simulator's own page,** never in `apps/web`. | No POS-shaped code in the platform. | firm | D122 §9 |
| 1.7 | **Guarding against overfitting:** the simulator varies its id shapes; barsy's mapping of the four payment steps is written on paper before the interface is frozen; timings come from #47's measurements; when Mistral answers, a `mistral-as-answered` profile runs the whole suite and each difference becomes a ticket. | The main risk (design §7.1). | firm | D122 §9 |

## 2. The simulated payment provider

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 2.1 | **The simulated provider is `packages/payments/sim-pay`,** with the flags and cautious defaults of design §3.3. Where its package sits follows #53. | D98; myPOS's unknowns (Q76). | firm | D122 §9 |
| 2.2 | **Test card numbers exist only on `sim-pay`'s own page, on its own origin.** Service tables keep no card digits, and a test checks it. | As on a real provider (D111). | firm | D122 §9 |
| 2.3 | **Without partial capture, a voided line means release, return and pay again.** | D122 §8 assumes a lower capture, which myPOS may not offer. | firm | D122 §8 |
| 2.4 | **D98's capability flags gain** `checkout` (redirect or embedded), embedded hold, refund notice, dispute notice, signed notices, "Restro's key can refund" and "the provider emails the guest", each with its verified status. | Facts §11 and D122 §8 use them; D98 lists only three. | firm | #49 (written into D98 with #49's technical choices) |

## 3. Kind `sim`, environments and the demo

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 3.1 | **Add the source kind `sim`** (core's connector maps, the kind check, a migration). The worker refuses it in production, the source picker hides it there, and a test pins both. | The demo venue needs a source; a `sim` instance must never reach production (risk 3). | firm | D122 §9 |
| 3.2 | **Environments:** CI unit, integration and e2e on the simulators; `pnpm sim:serve` locally; the staging demo on `sim-pos`, with the myPOS sandbox if it can hold, otherwise `sim-pay`; barsy's test installation for #47; a Mistral test installation later. | Each layer tested where it can be. | firm | D122 §9 |
| 3.3 | **The conformance suites** (connector and provider) live in the integration layer's test kit, partly un-parking CF-06. The D110 waiter-action guard is built there. | The same checks run on the simulator, barsy and Mistral. | firm | D122 §9 |
| 3.4 | **The dev seed gets "Demo Bar" on a `sim` instance.** #26 is unchanged. | Ordering needs a POS that takes writes. | firm | D122 §9 |
| 3.5 | **Writes to barsy (#47) go only to the test installation from Lukanet.** The public demo stays read-only. | Rule 7. | firm | D122 §9 |
| 3.6 | **`sim-pos` runs on staging as its own service behind a token,** with no guest data on its page. Deploying it needs Martin's OK, as any deploy does. | The staging demo; risk 4. | later | D122 §9 |
| 3.7 | **The staging demo's state may be lost on a redeploy.** A vanished bill reads as a closed bill; the JSON snapshot covers longer demos. | Accepted risk 6. | firm | D122 §9 |

## 4. Changes to D122 the design asked for

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 4.1 | **A reading taken while the table's lines sit on a payment table doesn't end the sitting.** The sitting ends after the close and capture, or on the first complete reading after `undoIsolate`. | Paying the whole bill moves every line off the table, so the reading in mid-payment would end the sitting and `undoIsolate` would return lines to a dead one (risk 7). | firm | D122 §4 |
| 4.2 | **D122 §3's list gains "Restro's own reference on a line" and "a repeated add creates nothing"** (connector questions C21, C20). | D115's "did it land" and "never resend" depend on them; a connector must be able to declare them. | firm | D122 §3 |
| 4.3 | **If the POS can't report which bar a table belongs to** (Mistral question 16), how bars and payment queues are known is unknown. Not designed now. It may change D122 §7's "read from the POS, never edited in Restro". | No answer exists yet. | later | #48 |

## 5. For Martin

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 5.1 | **Training mode on the pilot venue's own Mistral installation.** D122 allows "a POS test installation or training mode" for the demo and staging, but rule 7 and D110 say tests never run on a live venue's POS (Н-18 Annex 29 т. 20). The lead recommends a separate Mistral test installation only (Mistral question 27); training mode on the venue's live installation only if Mistral confirms in writing that it never reaches the fiscal device, the fiscal memory or the day's reports, and Martin then approves it. | A conflict between two binding texts, with a legal side. | open | #51 |
