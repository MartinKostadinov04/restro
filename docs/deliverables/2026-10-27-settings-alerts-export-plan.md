Made by: the part 1 ordering lead, 10-27, for #61 and #87. For: Martin, then the #87 build.

# Venue settings: Alerts; the Log's export; Integrations' fixes (screen plan, #87)

Prototype for Alerts: `2026-10-27-settings-staff-alerts-prototype.html` (with Staff and roles). The export and the Integrations fixes need none: one dialog and two layout fixes.

Placed by the confirmed grouping (`2026-10-27-owner-settings-grouping.md`). **The table code** (show, new, off) is already on each table's card in Tables & QR (#70, `apps/web/src/tables/table-card.tsx`); #87 adds nothing there.

## A. Alerts («Известия»)

`?tab=settings&section=alerts`, for `settings.alerts`. It writes `alertRecipientUserIds` and `telegramChatId` in `venues.settings.ordering` (`ordering-settings.ts`), and `staff_members.telegram_user_id` for who may press Done in Telegram; each change is a `settings.changed` or `staff.changed` Log entry. What is sent, to whom and when is settled (D120, D122 §7, #83's alert rules); this plan places who gets it.

**What it is for.** The owner chooses whose phones ring at night (push to installed devices) and links the venue's Telegram group (supplementary: pauses and "back", unconfirmed sent orders, money alerts, the end of the night).

### A1. Stories and taps

Comparables: Toast's and Square's notification settings (a list of people, a switch each); Telegram bots that join a group from a link (`t.me/<bot>?startgroup=<code>`, Telegram's documented deep linking, core.telegram.org/bots/features#deep-linking) (known behaviour).

| # | Story (spec #64, 56) | Target taps (desktop / phone) | Comparable |
|---|---|---|---|
| A1 | **Choose who gets alerts on their phone.** | **3 / 5** per person: the section, the person's switch; undo toast. | A switch per person. |
| A2 | **Link the venue's Telegram group.** | **4 / 6** in Restro and Telegram: the section, "Link a Telegram group" (Telegram opens), pick the group, "Add"; Restro shows "Linked to {group}" by itself. | A bot added from a link. |
| A3 | **Let a bartender press Done in Telegram.** | **4 / 6**: the section, "Link" on their row (a QR shows), they scan it and press Start in Telegram; the row turns "Linked". | The same, in a private chat. |
| A4 | **Check the group gets messages.** | **3 / 5**: "Send a test message". | — |
| A5 | **Unlink the group.** | **4 / 6**: "Unlink", confirm. | — |

### A2. The page, top to bottom

| Part | What it shows | Pattern |
|---|---|---|
| **On their phones** | One line: "Alerts ring on the phones and tablets where Restro is installed." Then each person of this venue who has their own account: the name, "{n} devices" or "No device yet: open Restro on the phone and install it", and a switch. People with only a PIN are not listed (no device to ring). | Single reversible write. |
| **Telegram group** | Not linked: one line "A Telegram group gets pauses, sent orders to check, money alerts and the end of the night." and "Link a Telegram group" (outline). Waiting: "Waiting for the bot to join… Pick the group in Telegram and add the bot." with "Cancel" (the link lasts 15 minutes). Linked: "Linked to {group}" with "Send a test message" and "…" → Unlink. | The one primary action of the section while unlinked. |
| **Done from Telegram** | Shown once a group is linked: "Who can press Done in the group. They need a role here that may answer the alert." Each person: "Linked" or "Link" (opens a dialog with a QR and the link to send them; it lasts 15 minutes) and "…" → Unlink. | A list; the secondary actions of a row. |

### A3. States

| State | What the screen does |
|---|---|
| **No one with a device** | The first part shows the people with "No device yet" and the switches still work (they ring once a device is installed). |
| **No staff here** | "Add people first, in Staff and roles." with the link. |
| **The bot removed from the group in Telegram** | The group shows "Restro's bot left {group}. Link it again." (the worker hears it); no alerts go to Telegram until linked. |
| **The link ran out** (15 minutes) | "The link ran out. Make a new one." |
| **A test message fails** | Error toast: "Couldn't reach the group. Check the bot is still in it." |
| **No `settings.alerts`** | Not in the list (as Staff and roles). |
| **Loading / failed / password again / shared device / long Bulgarian** | As Hours. |

### A4. What the build adds to the backend

No schema change and no new dependency. The worker's Telegram poller (`apps/worker/src/alerts/telegram-poller.ts`) also listens for the bot's start message and for its own removal (`allowed_updates` gains `message` and `my_chat_member`). The deep-link code is signed (venue or staff member, purpose, expiry: 15 minutes) with a key the worker already holds, so nothing new is stored; a code is used once, then the group's chat id or the person's Telegram user id is written through the service commands with a `record` Log entry. Telegram's start parameter is at most 64 characters of `A–Z a–z 0–9 _ -` (Telegram's deep-linking docs): the code fits.

## B. The Log's export (story 59)

In Tonight › Log, an "Export" button (outline) beside the day button, for roles holding `log.view` and `night.view_full` (owners and managers by default). It opens a dialog: **From** and **To** (dates; default the last 7 nights), and two buttons: "Download sent orders" and "Download the Log", each one CSV with the end-of-night CSV's format (UTF-8 with BOM, the same columns where they apply, amounts through the money module, no POS ids or guest data). One line: "Night details are kept 31 days; sent orders, settings and staff changes 18 months." A range wider than what is held downloads what is held. 3 taps (Log, Export, Download) plus the dates.

| Key | Bulgarian | English |
|---|---|---|
| `lg_export` | Изтегли | Export |
| `lg_from` / `lg_to` | От / До | From / To |
| `lg_dl_sent` | Изтегли поръчките | Download sent orders |
| `lg_dl_log` | Изтегли дневника | Download the Log |
| `lg_export_kept` | Подробностите за вечерта се пазят 31 дни; поръчките и промените в настройките и персонала – 18 месеца. | Night details are kept 31 days; sent orders, settings and staff changes 18 months. |

## C. Integrations' fixes (part of #87's Done-when; closes #59)

- **#59:** Integrations is 37 px wider than a 390 px phone in Bulgarian: the connector settings card's no-wrap select triggers sit in a grid without `min-w-0` (`apps/web/src/connectors/barsy/settings-card.tsx`, the allergen and locale `SelectTrigger`s). Fix: `min-w-0` on the grid's cells; checked at 390 px in BG, no sideways scroll.
- **The trial's finding 2.2:** a stray scrollbar on the one-tab strip (`apps/web/src/integration/integrations-screen.tsx`, the tab list; `2026-10-21-screen-read-trial.md`). Fix: no scrolling container when the tabs fit; checked with one connector and with several.

## D. Strings for Alerts (BG and EN)

| Key | Bulgarian | English |
|---|---|---|
| `al_title` | Известия | Alerts |
| `al_phones` | На телефоните | On their phones |
| `al_phones_line` | Известията звънят на телефоните и таблетите, където е инсталиран Restro. | Alerts ring on the phones and tablets where Restro is installed. |
| `al_devices` | {n} устройства | {n} devices |
| `al_no_device` | Още няма устройство: отворете Restro на телефона и го инсталирайте. | No device yet: open Restro on the phone and install it. |
| `al_tg` | Група в Telegram | Telegram group |
| `al_tg_line` | Групата получава паузите, поръчките за проверка, известията за плащания и края на вечерта. | A Telegram group gets pauses, sent orders to check, money alerts and the end of the night. |
| `al_tg_link` | Свържи група в Telegram | Link a Telegram group |
| `al_tg_wait` | Чака бота… Изберете групата в Telegram и добавете бота. | Waiting for the bot to join… Pick the group in Telegram and add the bot. |
| `al_tg_linked` | Свързано с {group} | Linked to {group} |
| `al_tg_test` | Изпрати пробно съобщение | Send a test message |
| `al_tg_test_text` | Restro: пробно съобщение от {venue}. Известията ще идват тук. | Restro: a test message from {venue}. Alerts will come here. |
| `al_tg_unlink` | Махни групата | Unlink the group |
| `al_tg_unlink_body` | Известията спират да идват в {group}. Ботът остава в групата, докато не го махнете там. | Alerts stop going to {group}. The bot stays in the group until you remove it there. |
| `al_tg_left` | Ботът на Restro напусна {group}. Свържете я отново. | Restro's bot left {group}. Link it again. |
| `al_tg_expired` | Връзката изтече. Направете нова. | The link ran out. Make a new one. |
| `al_tg_fail` | Групата не се достигна. Проверете дали ботът е още в нея. | Couldn't reach the group. Check the bot is still in it. |
| `al_done` | Кой може да натисне „Готово“ в групата | Done from Telegram |
| `al_done_line` | Трябва им роля тук, която може да отговаря на известието. | They need a role here that may answer the alert. |
| `al_linked` / `al_link` | Свързан / Свържи | Linked / Link |
| `al_link_body` | Нека {name} сканира кода с телефона си и натисне Start в Telegram. Връзката важи 15 минути. | Ask {name} to scan this with their phone and press Start in Telegram. The link lasts 15 minutes. |
| `al_no_staff` | Първо добавете хора в „Персонал и роли“. | Add people first, in Staff and roles. |
| `al_cancel` | Отказ | Cancel |

## E. Questions for Martin, each with a recommendation

- **Q1. Link Telegram from a button** (Restro opens Telegram, the owner picks the group, the bot joins and links itself; a bartender links by scanning a QR), rather than typing group ids or codes? It needs a small addition to the worker (the bot listens for its own start message), no new service and no new dependency. Recommendation: yes; it's how Telegram bots are usually added, and nobody has to find a chat id.
- **Q2. The export in two files** (sent orders, the Log), each for a date range, rather than one file mixing both? Recommendation: yes; each opens cleanly in Excel with its own columns.
