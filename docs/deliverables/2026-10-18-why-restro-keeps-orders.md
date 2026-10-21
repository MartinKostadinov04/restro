# Why Restro keeps its own orders and payments: an independent opinion
Made by: Fable subagent for #35, 10-18

Short answer to "for what reason exactly": for the night, Restro has no choice; beyond the night, it keeps orders and payments for disputes and for its own invoice, and insights come from what is kept anyway. "For good" is more than any reason needs.

## The four reasons

1. **No double orders: sound, and the strongest.** barsy refuses a repeated new bill by our uuid but cannot look one up, so after a timeout the only way to know whether an order landed is Restro's own note of what it sent and what came back, compared with the table's POS bills read back. This needs the record only until the order is confirmed or given up, at most until the service day ends.
2. **Evidence: sound, for a bounded time.** "It never came" is settled the same night. "I paid twice" can arrive months later (card disputes run to about six months). Orders without a payment need weeks; payments need the dispute window.
3. **Money: sound, and the one that fixes the retention.** Restro's fee is computed from Restro's own record of captures (D98), refunds need the provider reference, and an invoice is a bookkeeping record Restro must keep for the legal period (the lawyer's number, Q67; years, not months). Note what this record is not: the fiscal truth stays the POS bill and its fiscal receipt. Restro's record only lets a venue or Restro reconcile.
4. **Insights (D32): true but not a reason on its own.** Insights need item, quantity, price, time and table, nothing more, and tolerate aggregation after a year. They ride on what reasons 2 and 3 keep; they do not justify keeping anything longer or finer.

## What is missing
- **Personal data.** A guest session is anonymous (no account, no email, D99), so an order line (item, table, time) is not personal data. A payment record with a provider reference or token is pseudonymous personal data: together with the provider's records it names a cardholder. That makes a retention period, the privacy notice and the processing agreement (Q67) a condition of keeping payments at all, not a nicety. Orders must never carry a session, device or IP identifier beyond the night; the only link a phone needs is its opaque `actionId`.
- **The purge (D83)** lists what is erased; orders and payments are venue data and must be on that list. But Restro's own fee records must survive a venue's purge, so the monthly totals per venue (or the invoices) live outside the venue's data.
- **Fiscal traceability** is not Restro's today. It becomes Restro's only if the lawyer puts the venue under the alternative regime (monthly audit file, Н-18 чл. 52т) or counts Restro as sales software (Q63, Q74); then the law sets the retention. Keep this open; design so the records can be exported, nothing more.
- **The POS exchange log** (what Restro sent, what the POS answered) is separate from the order record and short-lived (30 days): it is for debugging and for "the POS said yes", not for bookkeeping.

## What is unnecessary
Nothing in the proposed fields; "price shown" and "which POS bill" are both needed for disputes (and the POS bill id stays in the backend, rule 3). What is unnecessary is the duration "for good".

## Implications
- **Storage and cost: small.** A busy club at 500 orders a night is a few million rows a year, tens of megabytes; fifty clubs stay within a Supabase Pro plan. Retention is a privacy and tidiness matter, not a cost one.
- **What staff see.** Owners can see orders per table per night and payments by amount, time and receipt reference. Nobody ever sees a card or a person; Restro never has them.
- **Retention periods** (my proposal): orders 13 months, then aggregates only; payments for the bookkeeping period the lawyer names, never shorter than the card dispute window; POS exchange log 30 days; the bill reading minutes, as proposed; guest-session links gone at the end of the service day.

**Verdict: agree with changes.** (1) Replace "for good" with the periods above. (2) No session, device or IP identifier on an order or payment past the night. (3) Add orders and payments to D83's purge list, and keep Restro's monthly fee totals outside the purged data. (4) The fiscal record stays the POS's; Restro's retention is revisited only if the lawyer's answers to Q63 and Q74 put Restro under Н-18.
