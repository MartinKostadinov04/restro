# Decision log: the POS-support review's open questions, and the demo's badges

Martin's question sitting of 2026-11-18, run in the session "Codebase structure and project architecture" and relayed to the lead the same day. The questions come from `docs/deliverables/2026-11-10-functionality-pos-support.md` §5 (M8, O6, G8, S12/R1, P13), from the walk's demo blemishes, and from three items waiting on his word (#311, #322, and the pick lists).

Martin's words are quoted exactly. Where a row says "the lead's reading", the wording is not his and he has not confirmed it; it is the lead's interpretation of the quote, open to correction.

## Sold out

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1 | Anyone who reviews orders may mark an item sold out, and it is sold out for everyone in the club for the rest of the night | "the moment that something is sold out a bartender or waitres or whoever is revieweing order can mark as sold out and this automatically brings it as sold out to everyone in the club for the night" | firm | [D147](../decisions/D147.md) |
| 2 | Where the POS reports stock, sold out is automatic | "The out of stock would be automatic if the POS communicates properly inventory" | firm | [D147](../decisions/D147.md) |
| 3 | A sold-out mark is allowed on a POS venue, which D124 §6 forbade | Rule 5 permits it: marking sold out makes the menu more cautious, never less | firm | [D147](../decisions/D147.md) |

## A paid line that cannot be served

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 4 | If a payment went through Restro and staff mark the line undeliverable, Restro sends the money back once staff confirm | "if payment passes through our platform and due to any reason the staff puts as undeliverable, money are sent back upon the staff confirming the execution of the refund" | firm | [D148](../decisions/D148.md) |
| 5 | The rule is general, not a fix for sold out | "that is not a one time fix. we should apply this as part of our execution framework" | firm | [D148](../decisions/D148.md) |
| 6 | Staff may also refund from the venue's own Stripe dashboard | "the staff should be able to reverse it through our platform or through stripes dashboard" | firm | [D148](../decisions/D148.md) |
| 7 | No nightly ceiling and no manager PIN as a condition of refunding | "I am not interested into imposing limits" | firm | [D148](../decisions/D148.md) |
| 8 | Narrowing `scripts/no-refunds.test.ts` and the provider guard | A guardrail may only tighten (D67), so the lead would not act on a yes relayed through another session. Martin said it himself, 11-18: "Yes, narrow it". The guard now allows the one refund path D148 describes and forbids every other refund call | firm | [D148](../decisions/D148.md), [#435](https://github.com/MartinKostadinov04/restro/issues/435) |
| 9 | A nightly alarm per venue, past 1% of the night's captured amount and three refunds, blocking nothing | Martin rejected limits on staff, and that stands. The exposure still needs a tripwire: with no cap one tap sends a guest's money back and the Log is the only control. A threshold is the lead's to set, not Martin's, so the lead set it from the benchmark (refunds average ~0.13% of sales) and the practice of measuring against the venue's own baseline. Recalibrated after the pilot's first month | firm | [D148](../decisions/D148.md), [#435](https://github.com/MartinKostadinov04/restro/issues/435) |
| 10 | A storno of a paid line is a POS capability under D110's "cancel within the POS's own rules" | The lead's reading, from the proposal Martin was shown | firm | [D148](../decisions/D148.md) |
| 11 | The order of storno and refund, and whether a storno may be issued through an API | Fiscal law; not an engineering question | open | [#52](https://github.com/MartinKostadinov04/restro/issues/52) |
| 12 | A provider whose key cannot be blocked from refunding is no longer a reason to reject it (P13, §5 Q3) | Follows from row 4: Restro's own key now refunds by design | firm | [D148](../decisions/D148.md) |

## Prices

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 13 | Where the POS's API shows a price, Restro keeps it right by refreshing prices often | "Wouldnt it be easier if we ask the POS about the prices frequently (like a refresh) that way we will reflect them accurately?" | firm | [D149](../decisions/D149.md) |
| 14 | How often is the lead's technical choice, not Martin's | Standing instruction: thresholds and timings are researched and decided by agents | firm | [D149](../decisions/D149.md) |
| 15 | Separate happy-hour items need nothing new | "they are seperate items that are preregistered like mojito happy hour which is 5 eur" — they are simply more items | firm | [D149](../decisions/D149.md) |
| 16 | A happy hour applied only at the till, invisible to the API, is not built now | "then we figure out how it will work when time comes" | later | [D149](../decisions/D149.md) |

## Connecting a POS

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 17 | No POS is connected without first being tested in a test environment | "We will connect no pos without prior testing in a testing environment" | firm | [D150](../decisions/D150.md) |
| 18 | This gates connecting a POS at all, not only ordering and paying | The lead's reading: Martin's words set no narrower scope | firm | [D150](../decisions/D150.md) |

## Not Restro's work

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 19 | Carrying a printed receipt from the till to the guest is not Restro's concern (S12/R1) | "No, it's not ours" | firm | [D151](../decisions/D151.md) |

## The menu's badges

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 20 | Restro never puts a badge on a menu item by itself; badges are the composer's to set | "We dont add badges on our own inside the menu - tags/badges work is on the person that sets up composer" | firm | [D152](../decisions/D152.md) |
| 21 | The computed 14-day "new" badge goes | The lead's reading: `resolve.ts:719` is Restro adding a badge by itself, which row 20 forbids | firm | [D152](../decisions/D152.md), [#434](https://github.com/MartinKostadinov04/restro/issues/434) |
| 22 | The four sim bottles showing "1 проблем" get public names in the demo data | Martin did not comment; D75's warning is correct, so only the demo data changes | firm | [#434](https://github.com/MartinKostadinov04/restro/issues/434) |

## The bar tablet

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 23 | A bar tablet is paired with a one-time code from Settings › Team, with no email and no person's account | "Pair with a code" | firm | [D153](../decisions/D153.md) |
| 24 | Removing the device signs that tablet out; people are still invited by email | The lead's reading of the mechanism Martin chose | firm | [D153](../decisions/D153.md) |

## Scheduling, not decisions

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 25 | Reservations part 2 starts now, in parallel: the booking page without money | "Start now, in parallel" | firm | [#322](https://github.com/MartinKostadinov04/restro/issues/322) |
| 26 | The money half of reservations still waits for the accountant | Unchanged from before the sitting | later | [#322](https://github.com/MartinKostadinov04/restro/issues/322) |
| 27 | Every live point on the three pick lists is fixed, including the bigger pattern work | "Fix everything" | firm | [#25](https://github.com/MartinKostadinov04/restro/issues/25), [#349](https://github.com/MartinKostadinov04/restro/issues/349), [#60](https://github.com/MartinKostadinov04/restro/issues/60) |
| 28 | Whether Restro ever stops offering the refund route on a bad night | The lead first set a second mark (route off past 5% of captured or fifteen refunds). A non-author review found that is a limit on staff, which Martin rejected: the sixteenth confirmed refund could not go through Restro. A threshold is the lead's; a cut-off existing at all is Martin's. Withdrawn pending his word; the alarm stands and blocks nothing | open | [D148](../decisions/D148.md), [#435](https://github.com/MartinKostadinov04/restro/issues/435) |
