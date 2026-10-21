Made by: lead session (Opus), 10-21. For: Martin, and D122. Follows `2026-10-21-board-review-answers.md`, which it amends only where marked.

# Board review: Martin's second answers

The lead explained the points Martin had not followed and gave the two questions still his. Martin answered:

| Row in answers 1 | Martin | What it settles |
|---|---|---|
| T4 · the waiter's "did this sent order land?" alert | Makes sense | **Decided** as written |
| TS3 · staff knowing Restro's POS login | Don't think about it now; it isn't a technical matter | **Dropped.** Club management. Mistral question 34 (blocking the API user from the terminal) is dropped too |
| TS4 · a cash close while the card is held | Add another quick check after the guest has confirmed the payment, as a last step | **Decided:** after the provider approves and before Restro closes and captures, Restro reads the payment table once more. The lines must be exactly the confirmed ones and the table must still be open. Otherwise the hold is released, the lines go back and staff are alerted. This joins SS1's line-exact check |
| TS5 · payment tables arriving as guest tables | Makes sense | **Decided** as written |
| TS7 · the Telegram group outliving staff | Club management | **Dropped** as a design point. The ordinary rule stays: "Done" counts only from a Telegram user linked to an active Restro account |
| GF3 · booths with two codes | Just print the code twice | **Changed:** no "several codes onto one table" feature. A table has one code, and the venue may print it on as many stickers as it likes |
| Open 1 · pay-first per item, or per table, area or venue? | Per item stays the thing you choose. Table, group and venue are a layer above: to whom the rules apply | **Decided:** an item's payment mode (on the bill / pay first) stays per item, as D113 says. Whether pay-first rules apply is set at three levels, venue, group (a bar, a hall) and table, and the most specific setting wins. This widens D113's single table switch "Disable prepayments" |
| Open 2 · choices A and B | No context | The lead re-explains them in chat. Still **open** |

Also from this answer:
- **Mistral's consent.** Restro's link to Mistral needs Mistral's written authorisation (Н-18 чл. 52з, ал. 5). It is question 21 in the single Mistral list, `2026-10-21-mistral-questions.md`, with the law cited.
- **The rest of the law points are later.** The lead reminds Martin of them: the lawyer and accountant questions of `2026-10-21-receipt-and-payment-law.md`, the allergen points, and whether Mistral is on the NRA list.
- **The staff screen prototype.** The direction is right, but the design is not what Martin imagined:
  - it is hard to take in at first sight;
  - it is cluttered;
  - it uses several neon-bright colours that confuse further;
  - it drifts away from even the temporary design system.

  Next comes a redesign, after D122 and the handover.

## Addendum, later on 10-21: choices A and B

After the lead re-explained them, Martin answered:

| Choice | Martin | What it settles |
|---|---|---|
| A · open the pilot with ordering only, paying in the app as phase 2 | "Pilot is pilot and has to work with the full workflow functionality. Demo or staging environments work with sandboxes if available. If we exclude payment processing on the pilot I will let you know, but I don't want you to design around a decision that limits the functionality." | **Declined.** The pilot gets ordering and paying in the app. Demo and staging run the same workflow on the provider's sandbox and a POS test installation or training mode. Nothing is designed for a pilot without paying unless Martin says so (D122) |
| B · the order of steps when a guest pays their own lines | OK | **The reviewers' order.** The guest confirms from a fresh reading of the real table, the card is held, then Restro moves the lines, reads them back (the last check), closes and captures within seconds (D122 §8) |
