Made by: the part 1 ordering lead, 10-27, for #86. For: Martin, then the #86 build.

# Tonight, screen 3: the Log (screen plan, #86)

Prototype beside it: `2026-10-27-tonight-log-and-night-prototype.html` (the same file as the end-of-night page; its bar switches tablet or phone, the screen, the night, BG or EN, light or dark). It is throwaway: it answers "can a manager find out what happened to a table or an order last night, in a glance and few taps?"

**Scope.** The third tab of Tonight, "Log" (`tab_log`, «Дневник»): the venue's Log (D120, D122 §7), one line per entry, newest first, for any service day the Log still holds. It follows screen 1's plan (`2026-10-21-tonight-screen-1-plan.md`) and the sent-orders plan (`2026-10-27-tonight-sent-orders-plan.md`) for everything it does not say. Who answered what is part 1's; the payment entries' words are part 2's (#115), in the place §8 leaves for them.

**What it is for.** The next morning a guest or the owner asks "what happened at table 7 at 01:30?" or "who paused ordering?". A manager finds the steps, who took them and why, without asking anyone. The Log only reads; nothing is answered here.

## 1. Stories and taps

Counted from Tonight being open on its first tab (tablet; the phone adds 1 for the tab dropdown). Comparables: Shopify's order timeline and Stripe's events list (an append-only list of what happened, filterable, newest first; design `2026-10-20-service-log-design.md`, "What comparable software does").

| # | Story (persona, device) | Target taps | Comparable |
|---|---|---|---|
| L1 | **See tonight's Log as it comes.** Manager or owner, tablet or phone. | **1** (the tab). | Stripe's events list: the list is the view. |
| L2 | **Find everything about one sent order** by the guest's reference. | **2 + typing** (the tab, the search field); the entries of that order stay, newest first. | Shopify: search by order number, open its timeline. |
| L3 | **Find what happened at one table.** | **2 + typing** (the table's number). | As L2. |
| L4 | **See only one kind** (orders, money, pauses and alerts, settings and staff). | **3** (the tab, the Kind menu, the kind). | Stripe's filter by event type. |
| L5 | **See an earlier night.** | **3** (the tab, the day, the date). | A date filter. |
| L6 | **Open the sent order or payment an entry is about.** | **+1** (the entry): screen 2's sheet, or the payment's page (part 2). | Stripe: an event links to its object. |

## 2. Place

A new row for `docs/guides/admin-map.md`, under the sent-orders row:

| Screen (BG / EN) | Route | What it is for | Reached by | Taps | Taps (phone) |
|---|---|---|---|---|---|
| Тази вечер › Дневник / Tonight › Log | `/venues/{venue}?tab=tonight&view=log` (`&day=YYYY-MM-DD` for an earlier night) | Everything that happened in service, newest first, by day; find by reference or table; filter by kind. | Tonight, the "Log" tab; only for roles holding `log.view` (managers and owners by default). | 3 (1 from Tonight) | 4 (2 from Tonight) |

## 3. The pattern for each job

| Job | Pattern | Note |
|---|---|---|
| The day's entries | **A list of records**: newest first; one line each: the time, what happened in one sentence, the table and the reference where there is one, and who. | No state colours: the Log reports, nothing in it waits for a person. |
| Find by reference or table | The search field, as on screen 2. | The same matching: a reference from its first character, or a table's number. |
| Kind | **Pick one of a few**, as a menu from a button ("Kind: All"), because five choices don't fit the phone's width as a segmented control. | All · Orders and tables · Money · Pauses and alerts · Settings and staff. |
| Day | A button "Tonight" that opens a date picker; the chosen date shows on the button. | Days with no entry are greyed in the picker. |
| An entry about a sent order or payment | **Everything about one thing**: the same sheet as screen 2 (sent order) or the payment's page (part 2). | Tapping any other entry does nothing; it carries no chevron. |
| New entries while the list is read | The sent-orders plan's "{k} new · show" line. | Same proposed Patterns row. |
| Nothing logged | **Nothing here yet**: "Nothing logged on this night." No button. | |
| Gone after 31 days | A line above the list on an older day: "Night details are kept 31 days. Settings and staff changes are kept 18 months." | Retention, D122 §9 (`night` and `record` classes). |

## 4. The one primary action

**The search field**, as on screen 2. The Kind and Day buttons are outline.

## 5. States

| State | What the screen does |
|---|---|
| **Empty** | "Nothing logged on this night." |
| **Loading** | Skeleton rows, `aria-busy`. |
| **Failed to load** | "Couldn't load the Log. Check the connection; it tries again by itself." in place of the list. |
| **Tonight, live** | New entries join at the top only while the list is at the top; otherwise the "{k} new · show" line. |
| **An earlier night** | The day on the button; no live updates; the 31-day line where it applies. |
| **Many** (a 50-table club: 1,000–2,500 entries) | The newest 100, then "Show earlier". Search and Kind filter the whole day, not only what is loaded. |
| **The longest Bulgarian text** | A sentence wraps to a second line; the time and "who" never truncate. |
| **Who did it** | A person's name (own sign-in or PIN); the shared device's account name ("Bar tablet") for the no-PIN actions (D122 §7); "Restro" for what Restro did; "A guest's phone" for a guest's step; " · via Telegram" when the answer came from Telegram. |
| **A role that may not see it** | The tab is not shown (staff by default). A link to it opens Tonight's first tab. |
| **Entries the venue never sees** | `lease.taken_over` and the Restro team's POS call log stay off this screen (D120: only the Restro team sees the POS calls). |
| **A code with no sentence** | "Something happened ({kind})" is never shown: the build maps every kind on `LOG_KINDS` and a test fails when a kind has no sentence. |

## 6. Screen read and wayfinding

Where am I: "Tonight", the venue, the tab "Log" marked, the day on its button. What is here: the list, newest first. How do I get out: the tabs; the sheet closes with Close or Esc. The eye lands on the search field, then on the newest line.

## 7. Questions for Martin

None of his: D120 and D122 §7 settle what the Log holds and who sees it. The sentences in §8 are his to accept with the strings.

## 8. Strings (BG and EN)

Under `copy-rules.md`; GLOSSARY terms ("Log", "sent order", "table", "pause", "service day"). Reused: screen 2's search, the state and reason words (`st_*`, `rs_*`), `so_new`, `so_earlier`, the sheet.

| Key | Bulgarian | English |
|---|---|---|
| `lg_search` | Търси по номер или маса | Search by reference or table |
| `lg_kind` | Вид: {kind} | Kind: {kind} |
| `lg_k_all` | Всичко | All |
| `lg_k_orders` | Поръчки и маси | Orders and tables |
| `lg_k_money` | Плащания | Money |
| `lg_k_pauses` | Паузи и известия | Pauses and alerts |
| `lg_k_settings` | Настройки и персонал | Settings and staff |
| `lg_tonight` | Тази вечер | Tonight |
| `lg_empty` | Няма записи за тази вечер. | Nothing logged on this night. |
| `lg_fail` | Дневникът не се зареди. Проверете връзката; ще опита отново сам. | Couldn't load the Log. Check the connection; it tries again by itself. |
| `lg_kept` | Подробностите за вечерта се пазят 31 дни. Промените в настройките и персонала се пазят 18 месеца. | Night details are kept 31 days. Settings and staff changes are kept 18 months. |
| `lg_restro` | Restro | Restro |
| `lg_guest` | Телефон на гост | A guest's phone |
| `lg_via_tg` | {who} · през Telegram | {who} · via Telegram |
| `lg_opened` | {table} е отворена за телефони | {table} opened for phones |
| `lg_ended` | {table} е затворена за телефони | {table} closed for phones |
| `lg_so_state` | Поръчка {ref}: {state} | Sent order {ref}: {state} |
| `lg_so_late` | Поръчка {ref} е открита в сметката | Sent order {ref} found on the bill |
| `lg_so_answer` | Поръчка {ref}: {answer} | Sent order {ref}: {answer} |
| `lg_paused` | Поръчките са спрени: {scope} | Ordering paused: {scope} |
| `lg_lifted` | Поръчките са пуснати: {scope} | Ordering back on: {scope} |
| `lg_alert` | Известие: {alert} | Alert: {alert} |
| `lg_alert_done` | Известието е прието: {alert} | Alert done: {alert} |
| `lg_call` | {table} повика сервитьор | {table} called a waiter |
| `lg_call_done` | Повикването от {table} е прието | Waiter call at {table} handled |
| `lg_call_lapsed` | Повикването от {table} изтече | Waiter call at {table} ran out |
| `lg_day_closed` | Вечерта приключи: {n} поръчки | The night closed: {n} sent orders |
| `lg_guard` | Защита спря {what} | A guard stopped {what} |
| `lg_settings` | Променени настройки: {what} | Settings changed: {what} |
| `lg_role` | Променена роля: {role} | Role changed: {role} |
| `lg_staff` | Променен персонал: {who} | Staff changed: {who} |
| `lg_pin` | Сменен ПИН: {who} | PIN changed: {who} |
| `lg_pin_seen` | Показан ПИН: {who} | PIN shown: {who} |
| `lg_device` | Променено устройство: {device} | Device changed: {device} |
| `lg_code_new` | Нов код за {table} | New code for {table} |
| `lg_code_seen` | Показан код за {table} | Code shown for {table} |

`{scope}` is "all bars", "{bar}", "{table}" or "the connection to {source}"; a pause's cause follows as its reason word ("{source} didn't answer", "3 orders couldn't be confirmed", "by {who}"). `{alert}` is the alert's own title from screen 1's strings. Payment entries take part 2's sentences (part 2 lead 10-27), below; `{amount}` never includes the tip. Part 2's state words come with #115; until then the build shows the kind word and the state word. A payment entry taps through to the payment's page (#115).

| Key | Bulgarian | English |
|---|---|---|
| `lg_pay_state` | Плащане за {table}, {amount}: {state} | Payment for {table}, {amount}: {state} |
| `lg_pay_answer` | Плащане за {table}: {answer} | Payment for {table}: {answer} |
| `lg_pay_refund` | Върнати {amount} по плащане за {table} | {amount} refunded on the payment for {table} |

`{answer}` is «Бележката е отпечатана» / "Receipt printed" or «Няма бележка» / "No receipt"; #153's second question uses the same two words.

**Martin 10-27:** confirmed the Log as drafted, its sentences included.
