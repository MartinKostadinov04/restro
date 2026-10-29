Made by: an Opus agent from ship.md §1, the confirmed Tonight plans and the code on `or/foundation` (76833e4); reviewed by the part 2 lead. For: Martin. Confirmed by Martin 10-29 ("Yes to all eight recommendations (Q1–Q8)"); copied here from the comment on [#115](https://github.com/MartinKostadinov04/restro/issues/115) when the screens were built.

# Tonight, paying: the money rows, the paying banner, the end of the night and the Log (screen plan, #115)

## Status

Confirmed by Martin 10-29. Every recommendation below is the decision.

Drafted by an Opus agent from ship.md §1, the confirmed Tonight plans and the code on `or/foundation` (76833e4); reviewed by the part 2 lead. **Martin, 10-29: "Yes to all eight recommendations (Q1–Q8)."** Every recommendation below is the decision.

It extends the Tonight screens Martin confirmed (`2026-10-21-tonight-screen-1-plan.md`, `2026-10-27-tonight-end-of-night-plan.md`, `2026-10-27-tonight-log-plan.md`) and follows them for everything not said here: the alert row, the PIN sheet, the sound, the calm look with one accent colour. Colour stays where screen 1 put it: red only for money held on a guest's card, blue for "needs you", everything else neutral. The code already leaves slots for this ticket: `ROW_RANK` in `server/tonight/view.ts`, the `TileState` "money is part 2's", `night-slots-part2.ts`, `payment-state-words.ts` and `lg_pay_*`.

## Screen plan
- **Stories and taps** (tablet / manager's phone, counted from Tonight open; a PIN is typed, not a tap). Only the Tonight stories below exist on `admin-map.md` today; the rest are new, so their targets come from screen 1's comparables.
  - P1. As a manager I want to answer "Payment not confirmed" ("Receipt printed" / "No receipt") so that the card is charged or released correctly. **1 + a manager's PIN / 1.** Today: no screen. Target: screen 1's S1 (a POS manager override: Toast, Square, known behaviour).
  - P2. As a manager I want to answer a pay-first order whose entry is unknown ("On the till" / "Not on the till", `payment.answer` with `on_till` / `not_on_till`, #113). **1 + PIN / 1.** As P1.
  - P3. As a manager I want to answer the second question, "Items not back on the table" (#153), so that a hold isn't released while the bill may be closed. **1 + PIN / 1.** As P1.
  - P4. As a waiter I want to see that a payment is waiting on a manager, so that I can fetch one. **0.** No answer buttons.
  - P5. As staff I want to mark items stuck on a payment table as moved back once I've moved them in `{source}`. **1 + own PIN / 1.** Screen 1's S8 (a staff answer).
  - P6. As the owner I want to read a card that wasn't charged after the bill closed, with the storno step, and mark it sorted. Read: **0** on Tonight (1 from the push). Mark: **1 (+ a manager's PIN on the tablet)**. Screen 1's S6 (a checklist item).
  - P7. As anyone on Tonight I want to see that card payments in the app are paused, so that I take payments in `{source}`. **0** (the banner).
  - P8. As the owner I want to reconnect Stripe after lost access. **2** to Stripe's form (the banner's "Reconnect", then "Reconnect" on Settings › Paying), plus the password if the last sign-in is older than 15 minutes. Today: **3 / 5** by the alert's words ("Open Settings, Paying, and choose Reconnect"). Target: fewer than today.
  - P9. As a manager at closing I want to see which payments still need fixing. **1 / 2.** Today 1 / 2 ("See what still needs fixing tonight"). The money rows join the same list.
  - P10. Answer a payment from the end-of-night page. **2 + PIN / 3.** Today 2 + PIN / 3 ("Fix a problem from the end-of-night page").
  - P11. As the owner I want to read the night's money: payments, released ones with reasons, unconfirmed ones, totals. **1 / 2** (+1 for the phone's "Totals" jump link). End-of-night N3.
  - P12. As a manager I want to find what happened to one payment. Log, Kind: Money: **3 / 4**. By table: **2 + typing / 3 + typing**. Its sheet: **+1**. Today: the same counts for sent orders (Log L3–L6).
  - P13. Download the night as a CSV, payments included. **2 / 3**, unchanged.
- **Place:** Tonight › Actions and tables (money rows at the top of "Needs you", the paying banner, the red "Payment" tile). Tonight › End of night (To fix, sections 3–6, Totals). Tonight › Log (Money kind, payment sentences, the payment sheet). Two `admin-map.md` changes: the End of night row says "the payments and the money follow-ups" are built, and story rows P1–P8 and P12 are added under section 2.
- **Pattern:**
  - Each money question and money alert: **An alert that needs an answer.** Two answers at equal weight, both outline (screen 1 §4, Q9). An alert with one acknowledgement has one outline button.
  - Paying paused, and lost access: **A state of the whole page.** One banner, not dismissible, stacked under any ordering-pause banner. It is hidden while Restro's own connection pause shows, because a venue pause already stops paying (D120).
  - The table's tile: **The state of many things at a glance.** "Payment" (`w_pay`), red, while one of its payments waits for an answer.
  - The answer: **Who is acting on a shared device** (the PIN sheet names the consequence and is also the confirmation; no Undo toast for an answer that moves money, operational-screens persona rules). On a personal phone, 1 tap.
  - One payment's details, from the Log or the end-of-night list: **Everything about one thing** (side sheet; a bottom drawer on a phone).
  - End-of-night payments, the Log's payment lines: **A list of records.**
  - "Show all {n}" payments: as the sent orders' (pages of 100).
  - A refusal (someone answered first): **What happened after a write.**
- **Primary action:** unchanged from screen 1: the top row's answer. A money row has no filled button (its two answers are outline), so with a money question on top nothing is filled. End of night: none. Log: the search field.
- **States:** the table below.
- **Strings:** the table below. Screen 1's money strings (`m_t`, `m_tag`, `m_q`, `m_ok`, `m_no`, `m_ok_b`, `m_no_b`, `m_ok_toast`, `m_no_toast`, `w_pay`), already confirmed by Martin 10-26, are reused as written.

**Who sees and answers what** (the end-of-night page follows the same rows):

| Row | Raised with | Waiter, own phone | Bar tablet | Manager or owner, own phone |
|---|---|---|---|---|
| Payment not confirmed; items not back (P1–P3) | `money.follow_up` | Seen, no buttons, line `m_who` | Seen; a manager's PIN | 1 tap |
| Items stuck on a payment table; stopped before closing | `alerts.answer` | 1 tap | Own PIN | 1 tap |
| Card not charged after close; hold ran out; hold not released | `money.follow_up` (push to owners only) | Not shown | Seen; a manager's PIN (as screen 1 Q7) | 1 tap (Q2) |
| Paying paused; lost access | none (banner) | Banner | Banner | Banner; "Reconnect" only with `settings.connect_payments` on their own sign-in |

**Order in "Needs you"** (what costs most to leave): payment questions (by the hold's end, soonest first), then a card not charged after close, then items stuck, then part 1's rows, then "stopped before closing" under "Later".

### States

| State | What the screen does |
|---|---|
| Empty | No money rows: part 1's "Nothing is waiting". End of night with no payments: section 3 shows `nt_pay_none`; sections 4–6 are left out. |
| Loading / failed to load | Part 1's skeletons and failure lines. |
| A write fails | Part 1's error toast (`errors.failed`). Someone answered first (`payment_answered`): `m_err_answered` with that answer, and the row updates. The payment moved on (`payment_not_unconfirmed`): `m_err_moved` and a refresh. |
| After an answer | The worker is queued at once (`paymentWorkerJob(payment)`, #113, #115 comments). The row leaves when its alert closes. The Log gets `lg_pay_answer` with the real answer word. |
| A question from an earlier night | Day close leaves it open (`closesByAnswer`, #162). It stays at the top on the next night with `m_earlier`. |
| The hold running out | The meta line shows `m_hold_until` from the alert's `captureBefore`. Reminders are #112's pushes; nothing on screen moves. |
| The longest Bulgarian text | The capture-failed row (title, body, storno step, accountant line) wraps in place. Answer buttons wrap to two lines and never truncate. Amounts never wrap. Checked at 1180 × 820 and 390 px. |
| Many | 12 money rows: they stay on top and the column scrolls on its own. 300 payments in a night: end-of-night section 3 shows the ones to fix, then "Show all {n}". |
| A role that may not act | See the table above: never a disabled button. A staff PIN on a money answer: part 1's `pin.staff`. |
| A POS venue where the control is read-only | n/a: nothing here edits the menu. Answers are what a waiter checks at the till (rule 7). |
| A hand-made venue | n/a: no till, so no in-app paying and no money rows (the Paying section isn't offered, plan 2). |
| Restro's connection pause | Its banner alone; the paying banner is hidden under it. Money rows stay answerable. |
| Telegram | Unchanged from #111/#112: the group gets the questions and stuck items with no amounts and no Done button (`closesByAnswer`). A failed capture is never sent to the group. End of night adds `nt_tg_pay` and problem lines without amounts (Martin 10-27: counts only). |

### Strings (BG / EN), under `copy-rules.md`

`{amt}` is "38,00 €" / "€38.00" (screen 1). `{source}` is the POS (D82). Keys continue screen 1's `tonight` namespace.

| Key | Bulgarian | English |
|---|---|---|
| `m_q_till` | Поръчката в касата ли е? Проверете масата ѝ за плащане в {source}. | Is the order on the till? Check its payment table in {source}. |
| `m_till_ok` | В касата е | On the till |
| `m_till_no` | Не е в касата | Not on the till |
| `m_till_ok_b` | Restro я проверява още веднъж, приключва я и таксува картата с {amt}. Това не може да се върне. | Restro checks it once more, closes it and charges the card {amt}. This can't be undone. |
| `m_till_no_b` | Задържаните {amt} се освобождават. Нищо не се таксува. | The held {amt} is released. Nothing is charged. |
| `m_till_ok_toast` | Записано: в касата е · {who} | Saved: on the till · {who} |
| `m_pf_meta` | Платена предварително · поръчка {ref} | Paid first · order {ref} |
| `m_lnb_t` | Артикулите не са върнати на масата | Items not back on the table |
| `m_lnb_q` | Сметката може все пак да е приключила. Отпечатана ли е касовата бележка? | The bill may have closed after all. Was the receipt printed? |
| `m_lnb_no_b` | Задържаните {amt} се освобождават. Артикулите остават на масата за плащане в {source}; върнете ги на ръка. | The held {amt} is released. The items stay on the payment table in {source}; move them back by hand. |
| `m_who` | Отговаря мениджър или собственик. | A manager or owner answers this. |
| `m_hold_until` | Задържана до {date}, {time} | On hold until {date}, {time} |
| `m_earlier` | От вечерта на {date} | From the night of {date} |
| `m_err_answered` | Някой вече отговори: {answer}. | Someone already answered: {answer}. |
| `m_err_moved` | Това плащане вече продължи. Страницата ще се обнови. | This payment has moved on. The page will refresh. |
| `ms_t` | Артикули останаха на маса за плащане | Items stuck on a payment table |
| `ms_d` | {table}: върнете ги на масата в {source}. | {table}: move them back to the table in {source}. |
| `ms_ok` | Върнати са | Moved back |
| `ms_toast` | Артикулите са върнати · {who} | Items moved back · {who} |
| `mc_t` | Плащане с карта е спряно преди приключване | Card payment stopped before closing |
| `mc_d` | {table}: сметката се промени преди приключване. Картата не е таксувана; гостът може да плати отново или на сервитьор. | {table}: the bill changed before it closed. The card wasn't charged; the guest can pay again or pay a waiter. |
| `mc_ok` | Видяно | Seen |
| `mc_toast` | Видяно · {who} | Seen · {who} |
| `mf_t` | Картата не е таксувана след приключване на сметката | Card not charged after the bill closed |
| `mf_d` | {table}, {amt}: сметката е приключена в {source}, но картата не е таксувана. | {table}, {amt}: the bill is closed in {source}, but the card wasn't charged. |
| `mf_storno` | Ако гостът плати по друг начин: сторно за операторска грешка в начина на плащане (Н-18, чл. 31, ал. 3–4) до 7-о число на следващия месец, след това нова касова бележка. | If the guest pays another way: storno for operator error on the payment type (Н-18 чл. 31, ал. 3–4), by the 7th of next month, then a new receipt. |
| `mf_gone` | Ако гостът си е тръгнал: проверете със счетоводителя какво да направите. | If the guest has left: check with your accountant what to do. |
| `mf_ok` | Уредено | Sorted |
| `mf_toast` | Отбелязано като уредено · {who} | Marked sorted · {who} |
| `mh_t` | Задържаната сума изтече преди някой да отговори | A card hold ran out before anyone answered |
| `mh_d` | {table}, {amt}: нищо не е таксувано. Ако сметката е приключена в {source}, вземете плащането; ако не е, върнете артикулите от масата за плащане. | {table}, {amt}: nothing was charged. If the bill is closed in {source}, collect the payment; if not, move its items back from the payment table. |
| `mr_t` | Задържаната сума на отказано плащане не е освободена | A cancelled payment's hold wasn't released |
| `mr_d` | {table}: картата не е таксувана. Restro проверява, докато банката освободи сумата. | {table}: the card wasn't charged. Restro keeps checking until the bank drops the hold. |
| `mr_d_charged` | {table}: картата е таксувана с {amt}. Ако е нужно, върнете сумата на госта през {provider}. | {table}: the card was charged {amt}. Refund the guest through {provider} if needed. |
| `pb_paused` | Плащането с карта в приложението е спряно: доставчикът на плащания не отговаря. Поръчките продължават; приемайте плащания в {source}. Ще се пусне само. | Card payments in the app are paused: the payment provider isn't answering. Ordering goes on; take payments in {source}. They come back by themselves. |
| `pb_lost` | Плащането с карта в приложението е спряно: Restro загуби достъп до сметката на заведението в {provider}. Поръчките продължават; приемайте плащания в {source}. | Card payments in the app are paused: Restro lost access to the venue's {provider} account. Ordering goes on; take payments in {source}. |
| `pb_restricted` | Плащането с карта в приложението е спряно: {provider} не може да приема плащания с карта по сметката на заведението. Поръчките продължават; приемайте плащания в {source}. | Card payments in the app are paused: {provider} can't take card payments on the venue's account. Ordering goes on; take payments in {source}. |
| `pb_reconnect` | Свържи отново | Reconnect |
| `pb_who` | Човек с право да свързва плащанията го свързва отново в Настройки, Плащане. | Someone allowed to connect payments reconnects it in Settings, Paying. |
| `nt_pay` | Плащания | Payments |
| `nt_pay_sum` | {n} плащания · {c} таксувани · {r} освободени · {u} без потвърждение | {n} payments · {c} charged · {r} released · {u} not confirmed |
| `nt_pay_none` | Няма плащания с карта тази вечер. | No card payments on this night. |
| `nt_pay_meta` | {table} · платено на {payTable} · {bar} · бележка {rcpt} | {table} · paid at {payTable} · {bar} · receipt {rcpt} |
| `nt_pay_tip` | бакшиш {tip} | tip {tip} |
| `nt_malerts` | Известия за пари и отговори | Money alerts and answers |
| `nt_ma_row` | {alert} · {answer} · {who}, {time} | {alert} · {answer} · {who}, {time} |
| `nt_ma_open` | още без отговор | not answered yet |
| `nt_refunds` | Връщания и сторно | Refunds and stornos |
| `nt_disputes` | Спорове | Disputes |
| `nt_fix_pay` | Плащане, {table}: {what} | Payment, {table}: {what} |
| `nt_fix_norcpt` | таксувано, без номер на бележка | charged, no receipt number |
| `nt_fix_paused` | Плащането с карта в приложението още е спряно | Card payments in the app are still paused |
| `nt_t_payments` | Плащания | Payments |
| `nt_t_captured` | Таксувани плащания с карта | Card payments charged |
| `nt_t_tips` | Бакшиши | Tips |
| `nt_t_unconf_pay` | Плащания без потвърждение | Payments not confirmed |
| `nt_t_unconf_amt` | Задържано по плащания без потвърждение | Held on unconfirmed payments |
| `nt_tg_pay` | Плащания: {n} взети, {k} за оправяне | Payments: {n} taken, {k} to fix |
| `py_title` | Плащане за {table} | Payment for {table} |
| `py_number` | Номер на плащане {ref} | Payment number {ref} |
| `py_steps` | Стъпки | Steps |
| `py_lines` / `py_tip` / `py_total` | Артикули / Бакшиш / Общо | Items / Tip / Total |
| `lg_pay_till` / `lg_pay_notill` | В касата е / Не е в касата | On the till / Not on the till |

`{what}` in `nt_fix_pay` is a state or question word below (`ms_t`, `mf_t`, `m_lnb_t` in lower case where needed), never an amount, so the same line goes to Telegram. Totals rows are `money.follow_up` only; `nt_t_unconf_*` come from the `paymentsUnconfirmed` and `unconfirmedMinor` that #115 adds to `ServiceDayTotals`.

**Payment state words** (fills `PAYMENT_STATE_WORDS`, for `lg_pay_state`):

| State | Bulgarian | English |
|---|---|---|
| `requested` / `priced` / `awaiting_guest` | започнато / изчислено / чака госта | started / priced / waiting for the guest |
| `held` / `queued` | задържано / чака маса за плащане | on hold / waiting for a payment table |
| `isolated` / `entered` / `checked` | преместено на маса за плащане / въведено в касата / проверено | moved to a payment table / entered on the till / checked |
| `closed` / `cancelling` | сметката е приключена / отказва се | bill closed / being cancelled |
| `captured` / `released` / `unconfirmed` | таксувано / освободено / без потвърждение | charged / released / not confirmed |
| `stranded` / `capture_failed` | артикулите останаха на маса за плащане / картата не е таксувана | items stuck on a payment table / card not charged |

**Release reasons** (end of night, section 3): `cancelled` гостът се отказа / the guest cancelled; `busy` нямаше свободна маса за плащане навреме / no payment table free in time; `paying_paused` плащането с карта беше спряно / card payments were paused; `paying_not_offered` плащането с карта не беше включено / card payments weren't on; `check_failed` сметката се промени преди приключване / the bill changed before closing; `no_receipt` отговор: няма бележка / answered: no receipt; `not_on_till` отговор: не е в касата / answered: not on the till; `expired` задържането изтече / the hold ran out; `hold_refused` картата не беше одобрена / the card wasn't approved; `below_minimum` под най-малкото плащане с карта / below the smallest card payment. Added by the lead 10-29, **awaiting Martin 10-30**: `bill_changed` сметката се промени / the bill changed; `ask_waiter_to_split` трябва сервитьор за разделянето / a waiter has to split it; `item_unavailable` артикул свърши / an item ran out; `enter_refused` and `isolate_refused` касата не прие поръчката / the till didn't take the order. Any other reason code the build meets is a stop-and-ask; a test fails on a code with no word, as for the Log's kinds.

**Push and Telegram (core `alert-text.ts`, no amounts):** a pay-first question needs its own body, because today's asks about the receipt: BG «Проверете в {source} дали поръчката е на масата ѝ за плащане и отговорете в Restro.» EN "Check in {source} whether the order is on its payment table, then answer in Restro."

### Questions for Martin (plan 1), each with a recommendation
- **Q1. The words for a pay-first order's question.** "Is the order on the till? Check its payment table in {source}." with "On the till" / "Not on the till" (BG «В касата е» / «Не е в касата»). The title stays "Payment not confirmed", and the meta line says "Paid first · order {ref}". Recommendation: yes. It is the same check as a sent order ("Found on the bill"), worded for a till the waiter knows.
- **Q2. Who sees "Card not charged after the bill closed" on Tonight?** D127 3.14 says the owner is alerted, and the push goes to owners only. The alert itself is raised for "follow up payments", which managers also hold, and the same goes for "hold ran out" and "hold not released". Recommendation: show these rows to managers and owners, and on the bar tablet behind a manager's PIN, as screen 1 Q7 did for the storno to-do. Keep the push owners-only. At 03:00 it's the manager who is at the venue.
- **Q3. Words for the money alerts that only need acknowledging:** "Moved back" (items stuck on a payment table), "Seen" (stopped before closing), "Sorted" (the owners' three). Each asks a PIN on the bar tablet, since D122 §7 exempts only "Handled" and "Brought". Recommendation: yes. Each job keeps its own word, and "Done" stays Telegram's, as screen 1 Q14 settled.
- **Q4. A waiter's own phone.** Screen 1's matrix said a staff member's own phone asks for a manager's PIN. What was built since (lifting a pause; `admin-map.md`) shows no button on a personal phone without the right. Recommendation: no buttons on a waiter's own phone, just the line "A manager or owner answers this.", and the manager's PIN only on the shared tablet. It matches the built screens and #115's acceptance ("sees it but can't answer it").
- **Q5. The paying banner for everyone.** Card payments paused, or lost access: shown to every role on Tonight, with "Reconnect" only for those allowed to connect payments. Recommendation: yes. A waiter must know to take payments at the till, because the guest's phone already says "Ask your waiter".

### The lead's calls for the build (not Martin's)
- **In this ticket:** the Log fix (`server/tonight/night-view.ts` `CONFIRMING_ANSWERS` shows `on_till` / `not_on_till` as "Receipt printed" / "No receipt"; use `lg_pay_till` / `lg_pay_notill`); the pay-first push and Telegram body in core `alert-text.ts` (above); the payment sheet (Everything about one thing) and its `admin-map.md` row; `paymentsUnconfirmed` and `unconfirmedMinor` in `ServiceDayTotals`.
- **End of night sections 5–6 (refunds, stornos, disputes)** are drawn read-only from what `payment.observe` records; the commands wait for #54.
- **"Bring the receipt" / "Brought"** (screen 1 S7, D122 §7) has its own ticket, #200.

### Added during the build (lead, 10-29; awaiting Martin 10-30 where marked)
- **Toasts** carry no " · {who}" (`m_ok_toast`, `m_till_ok_toast`, `ms_toast`, `mc_toast`, `mf_toast`): the built screen-1 toasts omit it and the Log names the person. A deviation from the tables above.
- **Disputes** (end of night, section 6) use screen 1's strings: each row `d_t` «Спор по картово плащане» / "Card dispute" with `d_d` «Плащане от {amt} ({table}, {date}).» / "Payment of {amt} ({table}, {date})."; no open / won / lost word. `nt_disp_open` «{n} още отворени» / "{n} still open" shows the count still open (awaiting Martin 10-30). Managers and owners only; amounts never go to Telegram.
- `pb_provider_none` «доставчика на плащания» / "the payment provider": the fallback for `{provider}` when the venue's provider name is not known (awaiting Martin 10-30).
