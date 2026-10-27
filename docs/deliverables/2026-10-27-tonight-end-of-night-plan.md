Made by: the part 1 ordering lead, 10-27, for #86. For: Martin, the part 2 lead (its sections), then the #86 build.

# Tonight, screen 4: the end of the night (screen plan, #86)

Prototype beside it: `2026-10-27-tonight-log-and-night-prototype.html` (the same file as the Log). It is throwaway: it answers "at closing, can the manager see in one look what still needs fixing, and the night in numbers?"

**Scope.** The fourth tab of Tonight, "End of night" (`tab_night`, «Край на вечерта»): one page per service day, also as a CSV, and the message the Telegram group gets when the day ends. The contents and their order are settled (D122 §7; refunds-disputes decision log §3.1–3.4). Part 1 fills the problems that are about sent orders, the sent orders section and part 1's totals. **Part 2 fills sections 3–6** (payments, money alerts, refunds and stornos, disputes), the money problems and the money totals, in the places §3 marks "part 2". It follows screen 1's and screen 2's plans for everything it does not say.

**What it is for.** At closing a manager checks that nothing is left open (a sent order nobody answered, a payment not captured) and fixes it while the staff are still there. The next day the owner reads the night in numbers or downloads it.

## 1. Stories and taps

Counted from Tonight being open on its first tab (tablet; the phone adds 1). Comparables: a POS's end-of-day ("Z") report and close-out checklist (Toast's end-of-day and Square's close-of-day reports list unclosed checks and unpaid items first, then the totals; known behaviour).

| # | Story (persona, device) | Target taps | Comparable |
|---|---|---|---|
| N1 | **See what still needs fixing tonight.** Manager at closing; staff see the same section. | **1** (the tab). The problems are first. | A close-out checklist: open checks first. |
| N2 | **Fix a problem from the page** (answer an Unconfirmed sent order). | **2 + PIN** (the tab, the answer) on the bar tablet; 2 on a manager's own phone. | As screen 1's S8. |
| N3 | **Read the night in numbers.** Owner, the next day. | **1** (the tab), totals at the bottom; on a phone the "Totals" jump link at the top is +1. | A Z report. |
| N4 | **Download the night as a CSV.** Manager or owner. | **2** (the tab, "Download CSV"). | Every POS's report export. |
| N5 | **See an earlier night.** | **3** (the tab, the day, the date). | A date filter on reports. |

## 2. Place

A new row for `docs/guides/admin-map.md`, under the Log's row:

| Screen (BG / EN) | Route | What it is for | Reached by | Taps | Taps (phone) |
|---|---|---|---|---|---|
| Тази вечер › Край на вечерта / Tonight › End of night | `/venues/{venue}?tab=tonight&view=night` (`&day=YYYY-MM-DD`) | One service day: what still needs fixing, the sent orders, the payments, the money follow-ups, and the totals; also as CSV. | Tonight, the "End of night" tab; roles holding `night.view` (staff: sections 1–3 without tips) or `night.view_full` (managers and owners: all, and the CSV). | 3 (1 from Tonight) | 4 (2 from Tonight) |

## 3. The layout, top to bottom

One column (max 840 px on the tablet, centred), sections with a heading and a count, in the settled order. A row reuses screen 2's sent-order row and screen 1's alert row; nothing new is drawn.

| # | Section | Who fills it | What it shows |
|---|---|---|---|
| — | The heading line | part 1 | The day ("Night of 26 October") and its state: "So far tonight · the night ends at 07:00" before the service day ends, "Closed at 07:00" after. "Download CSV" (outline) on the right, for `night.view_full`. |
| 1 | **To fix** (`nt_fix`) | part 1: a sent order still Unconfirmed; part 2: a payment captured with no receipt number, a capture pending or failed, a payment unconfirmed and unanswered (also #153's second question, "Items not back on the table": the same row and answer component with another question line), a refund with no storno done, a payment table left with lines, a hold that expired before it was taken (after a close was attempted), paying still paused (the provider's breaker or lost access; the owner gets "Reconnect", others see the row only) | One alert row per problem, with its answer where a tap fixes it (the same answer component and PIN rule as screen 1). Staff see part 2's rows too (#115: a waiter sees "Payment unconfirmed"), without the answer buttons and without the tip. With none: one line, "Nothing to fix.", with a check icon. This is the only section that can be tinted: a row that waits for a person carries the accent, as on screen 1. |
| 2 | **Sent orders** (`nt_sent`) | part 1 | One summary line ("84 sent · 79 added · 3 not sent · 2 unconfirmed"), then the ones not added, each as screen 2's row with its reason or its answer and who gave it; "Show all {n}" expands the full list in place. A row opens screen 2's sheet. |
| 3 | **Payments** | part 2 | Its rows (amount, tip, bar, real table, payment table, provider's reference, receipt number, captured / released / unconfirmed). Staff see it without tips. |
| 4 | **Money alerts and their answers** | part 2 | Who, what, when. Managers and owners only. |
| 5 | **Refunds and pending stornos** | part 2 | Refunds seen that day, and every storno still pending from earlier days. Managers and owners only. |
| 6 | **Disputes** | part 2 | Opened that day, and the count still open. Managers and owners only. |
| 7 | **Totals** (`nt_totals`) | part 1: tables opened for phones, sent orders and by state, the amount added to bills, waiter calls, pauses, alerts; part 2: payments (count), card payments captured (amount), tips (amount), all three `money.follow_up` only | A two-column list of label and number, numbers right-aligned in tabular figures. Before the day ends they are counted live; after, they are `service_days.totals`, written once. |

On the phone the sections stack the same way; a row of jump links under the heading ("To fix · Sent orders · Totals", plus part 2's) scrolls to each.

## 4. The one primary action

**None filled.** The page reads; its answers are the same outline pairs as screen 1, because neither answer is a default (screen 1 §4). "Download CSV" is outline.

## 5. States

| State | What the screen does |
|---|---|
| **Tonight, before the service day ends** | "So far tonight · the night ends at {time}"; live counts; problems leave the list when answered. |
| **After the service day ends** | "Closed at {time}"; totals from `service_days.totals`; a problem still open stays listed with its answer (a late answer is still useful, and it goes to the Log). |
| **Nothing to fix** | "Nothing to fix." with a check icon, neutral. |
| **No service that day** | "No service on this night." No sections. |
| **Loading** | Skeleton blocks per section, `aria-busy`. |
| **Failed to load** | "Couldn't load the end of the night. Check the connection; it tries again by itself." |
| **Many** | Sent orders: the not-added ones always show; "Show all {n}" adds the rest in pages of 100. |
| **The longest Bulgarian text** | Labels wrap; numbers never wrap or truncate. |
| **Roles** | Staff (`night.view`): sections 1–3 (part 2's rows without answers and without tips) and part 1's totals; never tips, no CSV (decision log 3.4). Managers and owners (`night.view_full`): everything and the CSV. A part 2 section a role may not see is not shown at all, never greyed. |
| **An earlier night** | Any service day with records (sent orders and payments are kept 18 months); an answered problem shows its answer and who gave it. |

## 6. The CSV

One file per service day, `restro-{venue}-{YYYY-MM-DD}.csv`, UTF-8 with a byte-order mark so Excel opens Cyrillic correctly, comma-separated, one header row. One row per item of the page, section by section, in the page's order. Columns: `section`, `time`, `table`, `reference`, `what`, `state`, `reason`, `answer`, `who`, `amount`, `tip`, `detail`. Amounts are decimals with a dot and two places in the venue's currency, from the money module (rule 8). Part 1 writes the rows of sections 1, 2 and 7; part 2 adds its sections' rows with the same columns. Amounts are positive; a refund says "refund" in `what`; `tip` is filled on payment rows only; a payment's `reference` is Restro's `pm_` id, never a POS or provider id. No POS id, no guest data (rule 3); the POS bill's number as staff know it may sit in `detail` (admin only, D120).

## 7. The Telegram message at the end of the service day

Sent once to the venue's group when the service day closes (decision log 3.3, D122 §7): the totals and the problems, nothing personal.

> **{venue} · night of {date}**
> Sent orders: {n} (added {a}, not sent {ns}, unconfirmed {u})
> *(part 2's money lines: "Payments: {n} taken, {k} to fix")*
> To fix ({k}):
> · Sent order {ref}, {table}: still unconfirmed
> *(part 2's problem lines: the table and what's wrong, no amounts)*

With nothing to fix the last block reads "Nothing to fix." **No money amounts and no tips go to the group** (part 2 lead 10-27, the cautious default, and part 1 follows it so there is one rule): the group may hold staff, and staff don't see tips (decision log 3.4). Counts only; Martin may change this.

## 8. Questions for Martin, each with a recommendation

- **Q1. A fourth tab, "End of night" («Край на вечерта»), with a day picker for earlier nights?** Recommendation: yes. It sits next to the Log, the night's other look back, and a manager closing up is already on Tonight.

## 9. Strings (BG and EN)

Part 1's strings; part 2 sends its own. Reused: screen 2's rows, states, reasons, answers and sheet; screen 1's alert rows and PIN sheet; the Log's day button.

| Key | Bulgarian | English |
|---|---|---|
| `tab_night` | Край на вечерта | End of night |
| `nt_day` | Вечерта на {date} | Night of {date} |
| `nt_live` | Досега тази вечер · вечерта приключва в {time} | So far tonight · the night ends at {time} |
| `nt_closed` | Приключи в {time} | Closed at {time} |
| `nt_csv` | Изтегли CSV | Download CSV |
| `nt_fix` | За оправяне | To fix |
| `nt_fix_none` | Няма нищо за оправяне. | Nothing to fix. |
| `nt_fix_so` | Поръчка {ref}, {table}: още непотвърдена | Sent order {ref}, {table}: still unconfirmed |
| `nt_sent` | Изпратени поръчки | Sent orders |
| `nt_sent_sum` | {n} изпратени · {a} добавени · {ns} неизпратени · {u} непотвърдени | {n} sent · {a} added · {ns} not sent · {u} unconfirmed |
| `nt_show_all` | Покажи всички {n} | Show all {n} |
| `nt_totals` | Общо | Totals |
| `nt_t_tables` | Отворени маси за телефони | Tables opened for phones |
| `nt_t_sent` | Изпратени поръчки | Sent orders |
| `nt_t_added` | Добавени в сметките | Added to bills |
| `nt_t_added_amt` | Сума, добавена в сметките | Amount added to bills |
| `nt_t_notsent` | Неизпратени | Not sent |
| `nt_t_unconf` | Непотвърдени | Unconfirmed |
| `nt_t_calls` | Повиквания на сервитьор | Waiter calls |
| `nt_t_pauses` | Паузи | Pauses |
| `nt_t_alerts` | Известия | Alerts |
| `nt_none` | Няма работа тази вечер. | No service on this night. |
| `nt_fail` | Краят на вечерта не се зареди. Проверете връзката; ще опита отново сам. | Couldn't load the end of the night. Check the connection; it tries again by itself. |
| `nt_tg_head` | {venue} · вечерта на {date} | {venue} · night of {date} |
| `nt_tg_sent` | Поръчки: {n} (добавени {a}, неизпратени {ns}, непотвърдени {u}) | Sent orders: {n} (added {a}, not sent {ns}, unconfirmed {u}) |
| `nt_tg_fix` | За оправяне ({k}): | To fix ({k}): |
| `nt_tg_none` | Няма нищо за оправяне. | Nothing to fix. |
