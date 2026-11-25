Made by: an Opus agent for #116 (drafted from ship.md §1, the Hours and Ordering plan and the code on `or/foundation` at 76833e4), reviewed by the part 2 lead. **Confirmed by Martin on 10-29: "Yes to all eight recommendations (Q1–Q8)."** For: the #116 build. Copied from the plan comment on issue #116 as it stood on 10-29; the issue's comment is the same text.

## Screen plan for #116 (confirmed 10-29)

Drafted by an Opus agent from ship.md §1, the Hours and Ordering plan and the code on `or/foundation` (76833e4); reviewed by the part 2 lead. #198's legal details are on this screen. **Martin, 10-29: "Yes to all eight recommendations (Q1–Q8)."** Every recommendation below is the decision.

Built on #109's backend (`server/settings/paying-view.ts`, `paying-actions.ts`: connect, return, disconnect refused `payment_in_flight`, the owner's ticks) and #104's `setPayingSettings` (refuses below the provider's minimum). #198's legal details go on the same screen. Follows the Hours and Ordering plan for everything not said here: read-only line, password again, shared device, loading and failure.

## Screen plan
- **Stories and taps** (desktop / phone, counted from the venue's Settings tab as `admin-map.md` counts "Set the venue's spot": the section is the first tap; a phone adds 2 for the section menu). None exists today, so each target comes from a comparable or from the nearest built story.
  - S1. As the owner I want to connect Stripe so that guests can pay by card. **2 / 4** (the section, "Connect {provider}"), then Stripe's form, plus the password if the last sign-in is older than 15 minutes. Comparable: D125 2.1's one button; Stripe-hosted onboarding as in Shopify Payments and Squarespace (known behaviour).
  - S2. As the owner I want to see what's still missing and fix it. Read: **1 / 3**. Each item: **+1** (a tick that saves at once with Undo; "Go to Tables & QR"; "Continue in {provider}").
  - S3. As the owner I want to reconnect after lost access. **2 / 4**, then Stripe's form.
  - S4. As the owner I want to disconnect Stripe. **3 / 5** (the section, "Disconnect…", "Disconnect" in the dialog). Refused while a guest is paying.
  - S5. As the owner I want to raise the smallest card payment. **3 / 5 + typing** (the section, the pencil, Enter). Same as the built cap in Ordering (O2).
  - S6. As the owner I want to know whether guests can tip, and why not. **1 / 3** (a line).
  - S7. As the owner I want to enter the venue's legal details for the pay screen. **6 / 8 + typing** (the section, 4 fields, Save). The nearest built story is "Add a bartender with a PIN", which counts each field the same way.
  - S8. As a manager without the right, I want to see whether card payments are on and what's missing. **1 / 3**, read-only.
- **Place:** Venue › Settings › **Paying** («Плащане»), `?tab=settings&section=paying`, between Ordering and Staff and roles (grouping, Martin 10-27). It is listed only where the venue's connector can take payments (D122 §3), so never at a hand-made venue. Also reached from Tonight's lost-access banner and the push's words ("Open Settings, Paying, and choose Reconnect"). New `admin-map.md` row: Настройки › Плащане / Settings › Paying, 3 / 5. Story rows S1–S7 added to section 2.
- **Pattern:**
  - Connect, Continue, Reconnect: one button that leaves for the provider's hosted form and returns to this section (`?connection=return`, which reads the account back). **What happened after a write**: a toast on return.
  - Lost access, and "card payments are on": **A state of the whole page.** One banner at the top of the section. Lost access is not dismissible.
  - The missing list, the owner's two ticks (`cardTypeInTill`, `receiptEmailsOff`): **A single reversible write** (the tick saves at once, Undo toast).
  - The smallest card payment: **Rename** (a pencil opens the value in place; Enter saves, Escape cancels), as the Ordering cap.
  - Tips: a read-only line, no control (Q6).
  - The legal details (4 fields): **Add a thing**, more than three fields, so a form in its own card with Save, "Unsaved" and the leave-page warning.
  - Disconnect: **Remove a thing for good**, a dialog naming the consequence (`copy-rules.md` rule 11; Q8), reached from a "…" menu on the account row (**The secondary actions of a row**).
- **Primary action:** by state, one at a time: "Connect {provider}" (never connected or disconnected), "Continue in {provider}" (the form isn't finished), "Reconnect" (lost access). Otherwise none filled: every control saves at once, and the details card's Save is filled only while it has unsaved edits.
- **States:** the table below.
- **Strings:** the table below. `{provider}` names the payment provider ("Stripe") the way `{source}` names the POS (D82), which keeps the vendor name out of the code's strings.

**What the section shows, top to bottom:** the state banner; the account (state, "Connected: {name}", "…" → Disconnect); "Before card payments can start", the missing checks in D125's order plus #198's details; the smallest card payment; tips; the venue's details for guests.

### States

| State | What the screen does |
|---|---|
| Never connected (empty) | The lede and "Connect {provider}" (filled) with `pa_connect_d`. Missing list: the account first. The smallest card payment, tips and details already show and can be set. |
| Connecting (form not finished) | `pa_connecting` and "Continue in {provider}" (filled). |
| Back from the form (`connection=return`) | Read back. All done: toast `pa_back_ok`. More needed: toast `pa_back_more`, and the missing list says so. |
| The form's link expired (`connection=refresh`) | `pa_expired` and "Continue in {provider}". |
| Connected, something missing | "Connected: {name}" and the missing list, each item with its fix. The provider's own requirements show as one line (`pa_m_card`) with "Continue in {provider}". |
| On | Banner `pa_on`; the missing list is gone. |
| Lost access / restricted | Banner `pa_lost_access` or `pa_lost_restricted` with "Reconnect" (filled). Card payments paused (D125 2.4). |
| Disconnected | As never connected, with "Connect {provider}". The same account is used again unless access was removed (D125 2.5, #109). |
| Disconnect while a guest pays | Refused: error toast `pa_err_inflight`; nothing changes. |
| Loading / failed to load | Skeleton rows / `st_fail`. |
| A save fails | Error toast that stays and names the fix; the control returns to its saved value. Connect fails: `pa_err_connect`. |
| Below the minimum, above €1,000 | The value stays in the field with `pa_min_err_low` / `pa_min_err_high` under it; the server refuses it too (#104). |
| A detail missing or malformed | Under the field: `pa_req`, `pa_eik_err`, `pa_privacy_err`. The details count as one missing check until all four are filled. |
| The password again | As Hours and Ordering: a change after 15 minutes opens the existing sign-in check first (D125 2.2, D122 §7). |
| A role that may not change it | Everything read-only (state, missing list, values, details), with `pa_readonly` at the top. No buttons, never disabled ones. |
| A shared device | `st_own_signin` only (settings never open with a PIN). |
| A POS venue where a control is read-only | n/a: everything here is Restro's own (D64, D92). The card payment type is chosen at the till, so it is the owner's tick, never a write to the POS (rule 7). |
| A connector without the capability | Tips: `pa_tips_off`. Paying itself: the section isn't listed (D122 §3). |
| The longest Bulgarian text | Labels sit above their control on a phone; tick labels and the account name wrap; amounts never wrap; no sideways scroll at 390 px. |
| Many items | n/a: a fixed list of five checks. |

### Strings (BG / EN)

Reused: `st_save`, `st_saved`, `st_fail`, `st_own_signin`, the password check, `undo`. The section name «Плащане» / "Paying" and «Свържи отново» / "Reconnect" match the words the lost-access push already uses.

| Key | Bulgarian | English |
|---|---|---|
| `pa_title` | Плащане | Paying |
| `pa_lede` | Гостите плащат сметката си с карта от телефона. Парите отиват направо в сметката на заведението в {provider}. | Guests pay their bill by card from their phones. The money goes straight to the venue's own {provider} account. |
| `pa_connect` | Свържи {provider} | Connect {provider} |
| `pa_connect_d` | {provider} ще поиска данни за фирмата, банката и самоличността и ще ви покаже условията си. Restro никога не вижда парола или ключ. | {provider} asks for the business, bank and ID details, and shows its terms. Restro never sees a password or key. |
| `pa_continue` | Продължи в {provider} | Continue in {provider} |
| `pa_connecting` | Свързването още не е завършено в {provider}. | Connecting isn't finished in {provider} yet. |
| `pa_connected` | Свързано: {name} | Connected: {name} |
| `pa_on` | Плащането с карта е включено. | Card payments are on. |
| `pa_back_ok` | Свързано с {provider} | Connected to {provider} |
| `pa_back_more` | {provider} чака още малко данни. Продължете, когато сте готови. | {provider} still needs a few details. Continue when you're ready. |
| `pa_expired` | Формата на {provider} изтече. Продължете оттам, докъдето стигнахте. | The {provider} form timed out. Continue where you left off. |
| `pa_missing_t` | Преди да започне плащането с карта | Before card payments can start |
| `pa_m_account` | Свържете {provider} | Connect {provider} |
| `pa_m_card` | {provider} още чака данни от вас. | {provider} still needs details from you. |
| `pa_m_till` | Избрах начин на плащане „карта“ в {source} | I chose the card payment type in {source} |
| `pa_m_tables` | Маркирайте маса за плащане за всеки бар | Mark a payment table for each bar |
| `pa_m_tables_go` | Към „Маси и QR“ | Go to Tables & QR |
| `pa_m_emails` | Изключих имейлите от {provider} към гостите за успешни плащания | I turned off {provider}'s emails to guests about successful payments |
| `pa_m_details` | Попълнете данните на заведението по-долу | Fill in the venue's details below |
| `pa_lost_access` | Restro загуби достъп до сметката на заведението в {provider}. Плащането с карта е спряно. | Restro lost access to the venue's {provider} account. Card payments are paused. |
| `pa_lost_restricted` | {provider} не може да приема плащания с карта по сметката на заведението. Плащането с карта е спряно. | {provider} can't take card payments on the venue's account. Card payments are paused. |
| `pa_reconnect` | Свържи отново | Reconnect |
| `pa_disconnect` | Прекъсни… | Disconnect… |
| `pa_dc_t` | Да прекъсна ли {provider}? | Disconnect {provider}? |
| `pa_dc_b` | Гостите няма да могат да плащат с карта в приложението, докато не свържете отново през формата на {provider}. Сметката в {provider} и парите в нея остават на заведението. | Guests can't pay by card in the app until you connect again through {provider}'s form. The {provider} account and its money stay the venue's. |
| `pa_dc_ok` / `pa_dc_keep` | Прекъсни / Остави свързано | Disconnect / Keep connected |
| `pa_dc_toast` | {provider} е прекъснат | {provider} disconnected |
| `pa_err_inflight` | Гост плаща в момента. Прекъснете, щом плащането приключи, след няколко минути. | A guest is paying right now. Disconnect once the payment ends, in a few minutes. |
| `pa_err_connect` | {provider} не се отвори. Проверете връзката и натиснете отново. | Couldn't open {provider}. Check the connection and press it again. |
| `pa_min` | Най-малко плащане с карта | Smallest card payment |
| `pa_min_default` | {amt} (минимумът на {provider}) | {amt} ({provider}'s minimum) |
| `pa_min_d` | Под тази сума гостите не могат да платят с карта и виждат молба да добавят артикул или да повикат сервитьор. | Below it, guests can't pay by card and are asked to add an item or ask a waiter. |
| `pa_min_err_low` | Не може да е под {amt}, минимума на {provider}. | Can't be below {amt}, {provider}'s minimum. |
| `pa_min_err_high` | Не може да е над {amt}. | Can't be above {amt}. |
| `pa_min_reset` | Използвай минимума на {provider} | Use {provider}'s minimum |
| `pa_tips` | Бакшиш | Tips |
| `pa_tips_on` | Гостите могат да добавят бакшиш. Той влиза в същата сметка и касова бележка в {source} и отива за заведението. | Guests can add a tip. It goes on the same bill and receipt in {source}, and goes to the venue. |
| `pa_tips_off` | Бакшиш не се предлага: {source} още не може да го добави в същата касова бележка. | Tips aren't offered: {source} can't put a tip on the same receipt yet. |
| `pa_legal_t` | Данни за заведението за гостите | The venue's details for guests |
| `pa_legal_d` | Гостите ги виждат зад връзка на екрана за плащане. Попълнете ги както са в Търговския регистър. | Guests see these behind a link on the pay screen. Write them as in the Commercial Register. |
| `pa_legal_name` | Име на фирмата | Legal name |
| `pa_eik` | ЕИК | ЕИК (company number) |
| `pa_address` | Седалище и адрес на управление | Registered address |
| `pa_privacy` | Връзка към политиката за поверителност | Privacy notice link |
| `pa_req` | Попълнете го, за да включите плащането с карта. | Fill this in to turn card payments on. |
| `pa_eik_err` | ЕИК е от 9 или 13 цифри. | ЕИК is 9 or 13 digits. |
| `pa_privacy_err` | Въведете пълна връзка, която започва с https://. | Enter a full link starting with https://. |
| `pa_unsaved` | Незапазено | Unsaved |
| `pa_readonly` | Само човек с право да свързва плащанията може да ги промени. | Only someone allowed to connect payments can change these. |

### Questions for Martin (plan 2), each with a recommendation
- **Q6. Tips: a line, or a switch?** #116 says tips "show as on" where the connector can record them. No decision says whether an owner may switch them off where they're possible, and the stored settings hold no such switch. Recommendation: a plain line, no switch, for the pilot. Add a switch only if an owner asks; it would be a single reversible write.
- **Q7. A separate on/off switch for card payments?** D125 2.3 reads as automatic: card payments turn on once connected and every check passes. #198 says "switched on", and the guest design has a "paying off" state. Recommendation: no separate switch. On means connected with every check passed; Disconnect is the off. A one-night pause, if it's ever needed, belongs with Tonight's "Pause ordering", not here.
- **Q8. Disconnect: a dialog, not Undo?** Undo can't bring the connection back, because connecting again goes through Stripe's form. Recommendation: the dialog "Disconnect Stripe?" with "Disconnect" / "Keep connected", per copy rule 11.

### The lead's calls for the build (not Martin's)
- **When the section is listed:** the venue's connector declares `closeWithPaymentType` (and the payment-table route, D122 §3); never at a hand-made venue.
- **The provider's own missing items** (`providerMissing`) show as the one line `pa_m_card` with "Continue in {provider}", never raw requirement codes.
- **ЕИК:** 9 or 13 digits; add the check digit only from a cited official source (the Registry Agency's rule), never an invented one. No source found: length only, and say so in the report.
- **The receipt-emails tick's help line** (where the provider keeps that switch) is checked in the sandbox during #117 and added then.
- **Pay-first settings** (venue, table, item) are not on this screen; they get their own plan, #201.
