Made by: the part 1 ordering lead, 10-27, for #86. For: Martin, then the #86 build.

# Tonight, screen 2: tonight's sent orders (screen plan, #86)

Prototype beside it: `2026-10-27-tonight-sent-orders-prototype.html` (open it in a browser; the bar at the top switches tablet 1180×820 or phone 390, the night, BG or EN, light or dark). It is throwaway: it answers "can staff find a guest's order and see where it stands, in a glance and few taps?"

**Scope.** The second tab of Tonight, "Sent orders" (`tab_sent`, «Поръчки»): every sent order of the service day, newest first, and one sent order's details in a sheet. The Log and the end-of-night page are their own plans (#86, after this one). It follows screen 1's plan (`2026-10-21-tonight-screen-1-plan.md`) for everything it does not say: the tokens, the persona of the bar tablet, the PIN rule, the tab bar and where staff land.

**What it is for.** A guest at the bar says "I ordered from my phone, is it coming?" and shows the reference on the phone. Staff answer in seconds. A manager reads the night's flow. Answering what needs a person stays on screen 1; this tab never adds a second "Needs you".

## 1. Stories and taps

Counted from Tonight being open on its first tab (tablet; the phone adds 1 for the tab dropdown, `admin-map.md`'s rule). Comparables: a POS front end's order or check lookup by number, and a kitchen display's recall of a ticket by number (Toast, Square; known behaviour, not re-read).

| # | Story (persona, device) | Target taps | Comparable |
|---|---|---|---|
| O1 | **Find a guest's sent order by the reference on their phone** and say where it stands. Staff, tablet or phone. | **2 + typing** (the tab, the search field, then 3 characters); the state shows on the row, no further tap. Phone: 3 + typing. | Check lookup by number: open the list, type the number (known behaviour). |
| O2 | **See tonight's sent orders as they come.** Manager or staff. | **1** (the tab). Newest first, nothing to open. | An order list or KDS screen: the list is the view. |
| O3 | **See only the ones that did not reach the bill** (Not sent, Unconfirmed). | **2** (the tab, "Not added"). | A KDS's "recall" or a POS's filter by status: one tap. |
| O4 | **See everything about one sent order:** its items with options and notes, totals, times, the reason it was not sent, who answered it, and its steps from the Log. | **2** (the tab, the row). | A POS's check detail: tap the check. |
| O5 | **Find the sent orders of one table.** | **2 + typing** (as O1, typing the table's number), or from screen 1: the table's tile opens its sheet with its sent orders (1). | A POS floor plan: tap the table. |
| O6 | **Answer an Unconfirmed sent order from here** (the guest is in front of you, and you found it in the list). | **3 + own PIN** (the tab, the row, the answer); screen 1 stays the 1-tap way (S8). | As screen 1's S8. |

## 2. Place

A new row for `docs/guides/admin-map.md`, under screen 1's:

| Screen (BG / EN) | Route | What it is for | Reached by | Taps | Taps (phone) |
|---|---|---|---|---|---|
| Тази вечер › Поръчки / Tonight › Sent orders | `/venues/{venue}?tab=tonight&view=sent` | Every sent order of the service day, newest first; find one by reference or table; one sent order's details. | Tonight, the "Sent orders" tab. | 3 (1 from Tonight) | 4 (2 from Tonight) |

## 3. The pattern for each job

| Job | Pattern | Note |
|---|---|---|
| The night's sent orders | **A list of records**: newest first, each row with its state and its time in the venue's zone. | One row: the reference (16 px, mono, bold), the table, the item count and total, the state as icon and word, the time. |
| Find by reference or table | A search field above the list, filtering as you type; no Search button. | No Patterns row names a search field; it is the list's own filter (as the composer's item search). Matches the reference (any case, from the first character) or the table's name or number. |
| All or only the ones not added | **Pick one of a few**: a segmented control, "All · Not added", each with its count. | |
| One sent order | **Everything about one thing**: side sheet on the tablet, bottom drawer on the phone. | Tabs are not needed: one page. |
| Answer an Unconfirmed one | **An alert that needs an answer**: the same two answers as screen 1 (S8), in the sheet, with the PIN sheet on a shared device. | Same component, same strings. |
| New sent orders while the list is read | **No row today.** Lead's decision, proposed as a Patterns row: rows join at the top only while the list is scrolled to the top; otherwise a still line at the top says "{k} new" and one tap shows them. Nothing slides. | Frequency rule: data the owner reads never moves for style. |
| Nothing sent yet | **Nothing here yet**: the empty-state block with one button, "Go to Actions and tables". | |
| A list that cannot load | **What happened after a write** does not fit (it is a read); the block in place of the list says what to do: "Couldn't load the sent orders. Check the connection; the list tries again by itself." | |

## 4. The one primary action

**The search field.** It is the first control on the tab and takes focus when the tab opens on the tablet (not on the phone, where the keyboard would cover the list). Nothing on the list is a filled button: an Unconfirmed sent order's answers live in its sheet and on screen 1.

## 5. States

| State | What the screen does |
|---|---|
| **Empty** (no sent order this service day) | "No orders sent tonight yet. Orders from phones show up here as soon as they're sent." Button: "Go to Actions and tables". |
| **Loading** | Skeleton rows (as screen 1), `aria-busy`, no spinner. |
| **Failed to load** | The block above in place of the list; the search field stays. It tries again with the screen's normal refresh. |
| **In progress** (Waiting, Sending, Checking) | The word with a clock icon ("Sending"), neutral. No spinner, no motion: the row changes word when the state does. |
| **Added** | A check icon and "Added", neutral. The sheet shows the POS bill as staff know it ("Bill 1042"). |
| **Awaiting approval** (only where the POS declares it) | "Approve it in {source}", neutral, read-only (screen 1 §10, Q4). |
| **Not sent** | "Not sent" and the reason in plain words on the row ("sold out", "{source} refused it", "ordering was paused"), neutral: the guest was told on the phone and nothing waits for staff. |
| **Unconfirmed, not answered** | The one coloured row: the accent tint, icon and "Check the bill". The answers are in the sheet and on screen 1. |
| **Unconfirmed, then found on the bill by Restro** (#135) | As above, plus a line in the row and the sheet: "Restro found it on the bill at {time}." Staff still answer (Restro never decides alone, D116). |
| **Unconfirmed, answered** | Neutral; the answer and who gave it: "Found on the bill · Maria" or "Not on the bill · Maria". |
| **The longest Bulgarian text** | Long item and table names wrap in the sheet; on the row the item count stands for the items, so nothing truncates. Reason words wrap to a second line. |
| **Many** (300 sent orders in a night) | The newest 100, then "Show earlier" at the bottom (one tap loads 100 more). The search covers the whole service day, not only what is loaded. |
| **A role that may not act** | Everyone who sees Tonight sees this tab (D122 §7: staff see tonight's sent orders). An answer follows screen 1's PIN rule. Bill amounts are shown to staff (they work the bill); tips are not part of a sent order. |
| **A POS venue where the control is read-only** | n/a: nothing here edits the menu or an item; the POS's bill is read-only by construction. |
| **The POS unreachable** | Screen 1's banner shows on every tab of Tonight; the list keeps working from Restro's own records. |

## 6. Screen read and wayfinding

Where am I: "Tonight", the venue, and the tab "Sent orders" marked. Where can I go: the tabs, the rows. What is here: the counts on the segmented control ("All 84 · Not added 3"), each row's state word. How do I get out: the sheet closes with Close or Esc; leaving the tab loses nothing. The eye lands on the search field, then on the one tinted row if any.

## 7. Questions for Martin, each with a recommendation

- **Q1. Answers in the sheet as well as on screen 1?** Recommendation: yes. The guest is in front of you and you just found the order here; sending staff back to screen 1 costs a tab and a search.
- **Q2. Screen 1 too: show "Restro found it on the bill at {time}" on the Unconfirmed alert row** (#135 built the finding). Recommendation: yes, on both screens, as a meta line, so staff tap "Found on the bill" with confidence. It changes no behaviour, only what the row says.
- **Q3. The filter's words: "All · Not added".** Recommendation: yes. "Not added" covers Not sent and Unconfirmed, the two that never reached the bill, in the guest's own terms.

## 8. Strings (BG and EN)

Under `copy-rules.md`; GLOSSARY terms ("sent order", "table", "Tonight"); `{source}` names the POS (D82). Screen 1's strings are reused where they exist (`tab_sent`, `s_ok`, `s_no`, `s_ok_b`, `s_no_b`, `s_ok_toast`, `s_no_toast`, the PIN strings, `close`, `err`, `loading`).

| Key | Bulgarian | English |
|---|---|---|
| `so_search` | Търси по номер или маса | Search by reference or table |
| `so_all` | Всички {n} | All {n} |
| `so_notadded` | Недобавени {n} | Not added {n} |
| `so_items` | {n, plural, one {# артикул} other {# артикула}} | {n, plural, one {# item} other {# items}} |
| `so_new` | {k} нови · покажи | {k} new · show |
| `so_earlier` | Покажи по-ранните | Show earlier |
| `so_empty_t` | Още няма изпратени поръчки | No orders sent tonight yet |
| `so_empty_d` | Поръчките от телефоните се появяват тук веднага щом бъдат изпратени. | Orders from phones show up here as soon as they're sent. |
| `so_empty_b` | Към „Действия и маси“ | Go to Actions and tables |
| `so_fail` | Поръчките не се заредиха. Проверете връзката; списъкът ще опита отново сам. | Couldn't load the sent orders. Check the connection; the list tries again by itself. |
| `so_none` | Няма поръчка с „{q}“ тази вечер. | No sent order matches "{q}" tonight. |
| `st_waiting` | Чака | Waiting |
| `st_sending` | Изпраща се | Sending |
| `st_checking` | Проверява се | Checking |
| `st_added` | Добавена | Added |
| `st_approval` | Одобрете я в {source} | Approve it in {source} |
| `st_notsent` | Неизпратена | Not sent |
| `st_check` | Проверете сметката | Check the bill |
| `rs_soldout` | изчерпано | sold out |
| `rs_refused` | {source} я отказа | {source} refused it |
| `rs_paused` | поръчките бяха спрени | ordering was paused |
| `rs_closed` | масата беше затворена | the table was closed |
| `rs_hours` | след последните поръчки | after last orders |
| `rs_unreachable` | {source} не отговори | {source} didn't answer |
| `so_found` | Restro я откри в сметката в {time}. | Restro found it on the bill at {time}. |
| `so_answered` | {answer} · {who} | {answer} · {who} |
| `sh_ref` | Поръчка {ref} | Sent order {ref} |
| `sh_table` | {table} · {time} | {table} · {time} |
| `sh_bill` | Сметка {bill} в {source} | Bill {bill} in {source} |
| `sh_total` | Общо: {amt} | Total: {amt} |
| `sh_note` | Бележка: {note} | Note: {note} |
| `sh_steps` | Стъпки | Steps |

The reason words map the codes core writes on a sent order (`sent_orders.reason`; for example `ordering_paused`, `pos_refused`, `pos_unreachable`, `table_closed`, `staff_closed`, `closing_hour`, the out-of-stock flag): the build lists every code it finds and maps each to one of these. A code with no word shows "Not sent" alone and is reported, never a raw code on screen.

**Martin 10-27:** confirmed the screen, its stories and taps, and Q1–Q3 as recommended (Q2 goes to the #85 build).
