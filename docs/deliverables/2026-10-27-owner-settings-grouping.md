Made by: the part 1 ordering lead, 10-27, for #61 and #87 (part 2's places for #116). For: Martin, the part 2 lead, then the build tickets.

# The owner's settings for ordering and paying: where each lives (#61)

**Martin 10-27:** "Yes: group the owner's settings as drafted (Q1–Q4 as recommended)." The part 2 lead agreed the same day, with the notes in §3.

Each setting sits where an owner already goes to set up that thing: the venue's own setup in the venue's Settings tab, a table's setup on its card, the night's records on Tonight. Comparables (D115): Toast and Square keep hours, ordering rules and payment setup per location, and staff once per account with a role per location (known behaviour).

## 1. Where each setting lives

| Setting | Place | Route | Permission | Who builds it |
|---|---|---|---|---|
| Service hours per weekday; the check before opening | Venue › Settings › **Hours** («Работно време») | `?tab=settings&section=hours` | `settings.guards` | #87 |
| Only at tables a waiter has opened; the location check (spot, radius, pass); the cap per sent order; the pace limit; when a waiter call runs out | Venue › Settings › **Ordering** («Поръчки») | `?tab=settings&section=ordering` | `settings.guards` | #87 |
| The venue's payment account (connect, what's missing, Reconnect, Disconnect); the smallest card payment; tips; pay-first for the whole venue | Venue › Settings › **Paying** («Плащане») | `?tab=settings&section=paying` | "connect payments" for all of it: the account (connect, Reconnect, Disconnect) also needs a sign-in within the last 15 minutes (#109); the smallest card payment, tips and venue pay-first shape the money taken. #109 adds the permission; until then the section is read-only | #116 (part 2) |
| The venue's people (role, PIN show and reset, add, remove from the venue); roles (the three defaults and copies); shared devices | Venue › Settings › **Staff and roles** («Персонал и роли») | `?tab=settings&section=staff` | `settings.roles` | #87 |
| Who gets alerts on their devices; the Telegram group | Venue › Settings › **Alerts** («Известия») | `?tab=settings&section=alerts` | `settings.alerts` | #87 |
| A payment table (per bar; marking it also hides the table and retires its code); pay-first for a table (its payment mode); the table code (show, new) | Venue › **Tables & QR**, on each table's card | `?tab=tables` | `settings.payment_tables` (payment table, pay-first); `settings.codes` (code) | payment table and pay-first: part 2 (#116); code: #87 |
| Pay-first for a group of items; call a waiter on or off | Venue › Composer (as today: the group's payment mode, Guest features) | `?tab=composer` | as today | already built (D113, D71) |
| Export of sent orders and the Log for a date range (story 59) | Venue › Tonight › **Log**, "Export" | `?tab=tonight&view=log` | `log.view` and `night.view_full` | #87 |
| The POS connection | Organisation › Settings › **Integrations** (as today), with #59's overflow fix and the trial's stray scrollbar | `/settings/integrations` | as today | #87 |

The venue's Settings tab then reads: General · Hours · Ordering · Paying · Staff and roles · Alerts · Publish · Versioning. A section a role may not change shows its values read-only with one line saying who can; a section with nothing to show for the venue (Paying where no provider is offered) is left out (D122 §3).

## 2. Decisions behind it (Martin 10-27)

- **Q1.** The five new sections in the venue's Settings tab, in that order.
- **Q2.** Staff are added once for the organisation (`staff_members` is per organisation) and listed in each venue they work at, with that venue's role (`staff_assignments`, `venue_roles` are per venue).
- **Q3.** Connecting the payment account is under the venue's Paying, not on the organisation's Integrations page as #61 first said: the payment account is one per venue (`payment_accounts.venue_id`; GLOSSARY, D125). Integrations stays POS only.
- **Q4.** The export of a date range sits in Tonight › Log, beside the records it exports.

## 3. Part 2's notes for its places (part 2 lead, 10-27)

1. **Paying, who sees what.** Connect, Reconnect and Disconnect need "connect payments" and a sign-in within the last 15 minutes (#109). Without the permission a person sees the connection state and what's missing, read-only. The smallest card payment never goes below the provider's minimum (€0.50). Tips show as on only where the venue's connector declares `recordTipOnClose`; elsewhere a plain line says why not.
2. **What's still missing** (D125 2.3): each missing check links to where it's fixed: the provider's onboarding (Reconnect); "Choose the card payment type in the till" (a plain line: it is done at the POS); "Mark payment tables" (Tables & QR); the provider's guest receipt emails off.
3. **A payment table** belongs to a bar and only Restro uses it (GLOSSARY): it gets no guest QR and no table code, never shows as a guest table on Tonight, and its card shows its bar.
4. **Pay-first** at three levels: the whole venue (Paying), a group (Composer), a table (Tables & QR); the most specific wins (GLOSSARY, Payment mode).

The part 2 lead checks the Paying states in the screen plan before #116 starts.

## 4. Screen plans that follow

1. **Hours and Ordering** (`2026-10-27-settings-hours-ordering-plan.md`, with its prototype): the one screen shown to Martin first.
2. Staff and roles; Alerts; the table card's code; the Log's export; Integrations' fixes: after Martin confirms the first.
3. Paying: part 2's plan, in the place above.
