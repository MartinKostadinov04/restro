# Board review: research on twelve open points

Made by: research agent (Opus), 10-21. For: Martin and the lead, before D122 is written. Answers the open points from the three board reviews of 10-21 (guest, staff, system).

How to read: each section says what others do (with links), what we recommend, and what is still unsure. "Not documented" means the vendor publishes nothing on it; we did not guess.

---

## 1. Ending a table session when the table turns over

**What others do.**
- None of the vendors we checked publishes how a guest who has left is stopped from ordering onto the next group's bill. Not Toast, Sunday or me&u. This is an unknown, not a "no".
- Toast: the QR code names the table, not a check. Guests who scan can add to a check the waiter opened, and each split check gets its own QR code ([Toast FAQ](https://support.toasttab.com/en/article/Toast-Mobile-Order-and-Pay-FAQs?lang=en_US)). Toast tabs are tied to a guest account and stored card, not to the device.
- Sunday and me&u describe pay-and-leave and group tabs, but say nothing about turnover ([Sunday help](https://intercom.help/sundayapp-help/fr/articles/10058165-paiement-a-table-via-qr-codes)).
- General security practice: a session must end when the thing it protects ends. OWASP's guidance has an absolute timeout plus ending the session on any change of privilege ([OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)).

**Recommendation.** Give each table a "sitting" counter. It goes up by one when all of the table's bills are closed, or when staff press "Table cleared". A location pass records the counter value at the moment it is granted. The pass works only while the counter is unchanged **and** it is under 2 hours old. When the group pays and leaves, every pass on that table stops working at once.
- Signing the pass with HMAC is good, but it only stops tampering. It does not end the pass, so it is not an answer on its own. Keep the pass on the server, or sign it; either is fine.
- Changing the table code each time is not possible, because the code is printed on the QR sticker.

**Unsure.** The rule needs Restro to see "all bills closed" in time. With Mistral that depends on how often we read closed bills (checker capability "read closed bills"). If that read is slow, a leaver has a short window. The "Table cleared" button covers that.

## 2. Shared staff device at a bar

**What others do.**
- Toast: the device is signed in once with an email and password. Each person then uses their own 6–8 digit POS code. What they can do depends on that code, not on who signed in the device ([Toast login](https://support.toasttab.com/article/Log-in-to-a-Toast-Product-or-Device)).
- Square: each team member has a 4-digit passcode. The owner picks which tasks need it, and sets how long the till stays unlocked after the last tap ([Square passcodes](https://squareup.com/help/us/en/article/8357-require-passcodes-at-point-of-sale)).
- Lightspeed Retail has two settings: one for how long the device session stays open, one for how long until the PIN is asked again ([Lightspeed](https://retail-support.lightspeedhq.com/hc/en-us/articles/360036550873)). We did not find the K-Series (restaurant) equivalent.
- OWASP: idle timeouts of 2–5 minutes for high-value apps and 15–30 minutes for low-risk ones. A work-day absolute limit of 4–8 hours. Ask for the password again before sensitive changes.

**Recommendation.**
- **Bar device:** a "bar device" login with the staff role only. It can never hold manager or owner rights. It stays signed in for the service day and is signed out at the end of it (07:00 by default), with 12 hours at most. Don't lock it when idle, because the alert screen must stay visible. The two money actions (acknowledge a money alert, resume a table) ask for the person's own 4-digit PIN, as at Toast. The audit log then shows a name, not "bar device".
- **Manager's or owner's own phone:** a personal login that stays signed in for up to 30 days. It asks for the password again before any settings change if the last sign-in was over 15 minutes ago.

**Unsure.** The 30-day and 15-minute figures are our choice from common practice. No vendor states them for this case.

## 3. Roles

**What others do.**
- Toast groups rights in levels ([Toast permissions](https://support.toasttab.com/article/Access-Permissions-Reference)):
  - Manager access: voids, refunds, discounts, slowing online orders.
  - Restaurant admin: reports and the check audit, staff.
  - Web setup: online-ordering settings, notifications, dining room setup.
  - Account admin: permissions, financial accounts, integrations.
- Square: "full access" staff get everything except bank accounts, legal representatives and API sign-ins, which stay with the owner ([Square permissions](https://squareup.com/help/us/en/article/5822-employee-permissions)).

**Recommendation.** Three roles:

| Action | Staff | Manager | Owner |
|---|---|---|---|
| Pause ordering (table or venue) | yes | yes | yes |
| Resume a paused table | yes, with PIN | yes | yes |
| Resume the whole venue | – | yes | yes |
| Acknowledge money alerts | yes, with PIN | yes | yes |
| Read the audit log | – | yes | yes |
| Safety settings (location check, spend cap) | – | – | yes |
| Map tables to bars | – | yes | yes |
| Manage alert recipients | – | – | yes |

Why:
- Pausing makes the menu more cautious (rule 5), so anyone may do it.
- Safety settings and alert recipients decide who hears about money problems. Square and Toast keep things like that with the owner or account admin, so we do too.

**Unsure.** Whether the pilot venue wants bar staff to resume tables, or only the manager. Ask the venue.

## 4. Acknowledging alerts through Telegram

**What others do.**
- PagerDuty lets people acknowledge from Slack only after they link their Slack account to their PagerDuty account. It applies that person's PagerDuty rights to the action ([PagerDuty Slack](https://docs.pagerduty.com/integrations/slack-integration-guide)). Whether the action shows in the incident timeline is not stated on that page. We did not check Opsgenie.
- Telegram: pressing an inline button sends the bot a callback that names the Telegram user who pressed it ([Bot API](https://core.telegram.org/bots/api#callbackquery)). The bot can link a person through a one-time "start" link of up to 64 characters ([deep linking](https://core.telegram.org/bots/features#deep-linking)). Telegram tells bots to check that a user is allowed before acting on a command. The bot's webhook can require a secret header (`secret_token` in [setWebhook](https://core.telegram.org/bots/api#setwebhook)).

**Recommendation.** Yes, allow a "Done" button, but only under the PagerDuty rules:
1. The person links their Telegram once from the admin, through a one-time start link.
2. A press counts only if that Telegram user is linked to a staff account whose role may acknowledge (see 3). Anyone else gets the reply "Open the admin to do this".
3. The audit log records the person, the time and "via Telegram".
4. The bot edits the message for everyone in the group: "Done by Maria, 02:14".

Resuming tables or the venue and any settings stay in the admin. Telegram gets a link button for those.

**Unsure.** Telegram does not prove that the person holding the phone is the account owner. The risk is the same as with PagerDuty in Slack, and we accept it for acknowledging only.

## 5. Rate limits per phone without identifying it

**What others do.**
- An IP address is personal data (CJEU *Breyer*, C-582/14). GDPR Recital 49 names network security, including stopping unauthorised access, as a legitimate interest.
- Cloudflare's free plan gives one rate-limit rule. It counts per IP over a 10-second window and blocks ([rate limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/)).
- In a club, many guests share one IP: the venue Wi-Fi, or the mobile network's shared addresses. Per-IP limits must therefore be loose.

**Recommendation.** Use both kinds of limit.
- **Per page load:** the phone makes a random 128-bit value when the page loads. It is kept only in memory, never stored on the phone, and sent with each request. Limits per value:
  - adding to the bag: 30 a minute;
  - sending a round: 1 every 15 seconds and 10 every 10 minutes;
  - location-pass tries: 5 every 10 minutes.
  
  Reloading gives a new value, so this only slows down careless or playful guests. The location pass already limits ordering to people inside the venue.
- **Per table:** never freeze a table. Above 6 rounds in 10 minutes, further rounds wait for staff approval and staff get an alert.
- **Per IP, at Cloudflare:** a flood guard only, 100 requests per 10 seconds on the guest API. A lower limit would lock out a whole Wi-Fi.
- Keep counters in memory for at most an hour. Never store raw IPs in our own logs, only a salted hash.

**Unsure.** Whether a value kept only in memory counts as "storage" under the ePrivacy Directive Art. 5(3). Even if it does, the "strictly necessary" exemption should apply. The location-check law research should confirm this.

## 6. Undo before an order is sent

**What others do.**
- Gmail's Undo Send holds a message for 5, 10, 20 or 30 seconds ([Google](https://support.google.com/mail/answer/2819488)).
- We found no ordering app that publishes a cancel timer after "Order". Cancelling usually depends on the kitchen's status. The closest case is Domino's "Zero Click", which counts down 10 seconds before ordering ([TechRadar](https://www.techradar.com/news/world-of-tech/domino-s-new-zero-click-app-will-order-a-pizza-for-you-in-10-seconds-1328549)).
- Nielsen Norman Group: confirmation dialogs never catch every mistake, so undo is needed as well ([NN/g](https://www.nngroup.com/articles/confirmation-dialog/)).

**Recommendation.** Yes, a **5-second** "Sending… Stop" window.
- The server keeps the round for 5 seconds before writing it to the POS. If the guest closes the phone, the round still goes.
- Once the bar ticket prints, a mistake costs a poured drink and a staff correction. 5 seconds is short enough not to slow a busy bar.

**Unsure.** Whether 5 seconds is enough at a loud bar. Measure "Stop" taps in the pilot before changing it.

## 7. Line notes and modifiers the POS may not print

**What others do.**
- Toast's online ordering has one on/off switch for "special requests" for the whole menu. It suggests required modifier groups where a choice matters ([Toast](https://support.toasttab.com/article/Getting-Started-Online-Ordering)).
- Losing notes is a known failure. A Square seller reported that QR-order notes never reached the kitchen, and Square's support confirmed the bug ([Square community](https://community.squareup.com/t5/Payments-Troubleshooting/Self-Serve-orders-not-showing-customer-notes/m-p/707211)).
- Law: EU Reg. 1169/2011 Art. 44 makes allergen information mandatory for food that is not prepacked, which includes bars and restaurants. It lets each country set *how* the information is given ([Reg. 1169/2011](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011R1169)). Bulgaria set its national rules in the Ordinance on food information for consumers (Decree 97 of 19.03.2021, ДВ бр. 25/2021). We could not read its text on catering.
- The law obliges the venue to *give* allergen information. It does not say a free-text note must reach the bar. The risk is a guest who believes "no nuts, allergy" was passed on when it was not.

**Recommendation.** Hide the note field whenever the connector reports that the POS cannot print notes. Show a fixed line in its place: "Allergies or special requests? Tell the staff." Show modifiers only where the POS can carry them; otherwise show the item without them. This follows Toast's single switch, and it never makes a promise we cannot keep. The allergen display itself is unchanged (D42).

**Unsure.** What the 2021 Bulgarian ordinance says about written versus spoken allergen information in catering. A research agent can read it; this does not need the lawyer.

## 8. Accessibility of status screens

**What the standard says** (WCAG 2.2):
- **4.1.3 Status messages (AA):** "Sending", "Sent" or "Not sent" must be announced to screen readers without moving focus.
  - Use `role="status"` for progress and success.
  - Use `role="alert"` for errors ([W3C](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)).
- **1.4.1 Use of colour (A):** a state can never be shown by colour alone. Always add a word and an icon.
- **1.4.3 Contrast (AA):** at least 4.5:1, or 3:1 for large text (24 px, or about 19 px bold). **1.4.6 (AAA):** 7:1, or 4.5:1 for large text. **1.4.11:** at least 3:1 for icons and button edges.
- **2.3.1:** nothing may flash more than 3 times a second.
- **2.5.8:** tap targets at least 24 × 24 px.
- WCAG says nothing about a screen held up for a third person in a dark, loud room.

**Recommendation** for "show this to your waiter":
- Aim for 7:1 contrast.
- The table and round reference at 40 px or more, bold. No text under 18 px.
- Light text on a dark background, so it does not dazzle in the dark.
- No flashing; at most one slow pulse.
- Keep the screen awake with the Screen Wake Lock API while it shows.
- Pair every state with a word and an icon.

**Unsure.** The text sizes are our judgement for reading at arm's length. They are not a WCAG number.

## 9. Venue connectivity

**What others do.**
- Guests order on their own mobile data. A weak venue Wi-Fi does not matter unless the guest has no signal ([HungryHungry](https://www.hungryhungry.com/en/blogs/qr-code-ordering-without-reliable-wifi)).
- Captive portals, the Wi-Fi login pages, fake DNS or plain-HTTP answers. Some even intercept HTTPS, which breaks TLS. The newer standard (RFC 8908/8910) tells the phone about the portal instead ([RFC 8952](https://www.rfc-editor.org/rfc/rfc8952.html)).
- Our earlier research covers what to show on weak signal ([weak signal](2026-10-20-weak-signal-in-ordering-apps.md)).

**Recommendation.**
- **How the app detects a portal.** Our site is HTTPS only (with HSTS), so a portal cannot answer in our name. It can only cause a network or certificate error. Every API answer must also carry a fixed header and a valid JSON shape. Anything else counts as "no connection", never as an answer.
- **What the guest sees.** If the phone says it is online but our requests fail, show: "If you are on the venue Wi-Fi, open any web page to log in, or switch to mobile data."
- **What to ask the venue before the pilot:**
  1. Signal on A1, Yettel and Vivacom at each table zone on a full night. Test it ourselves.
  2. Is there guest Wi-Fi, and is it open or behind a login page?
  3. Can our domain be allowed before the Wi-Fi login? This is the portal's "walled garden" setting.
  4. How many phones can the Wi-Fi carry at once?
  5. Are the POS and bar printers on their own wired network?

**Unsure.** No vendor states a signal minimum. The pilot club's basement signal is unknown until measured.

## 10. Secrets in requests at Cloudflare

**What Cloudflare does.**
- **HTTP request logs:** the default fields include the client IP, user agent, referer, and the full URL with its query string. Request headers are logged only if someone adds them as "custom fields", one by one ([fields](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/zone/http_requests/), [custom fields](https://developers.cloudflare.com/logs/reference/custom-fields/)). Logpush is in any case an Enterprise feature. We use the free plan.
- **WAF payload logging:** Enterprise only, off until set up, and encrypted with the customer's key ([payload logging](https://developers.cloudflare.com/waf/managed-rules/payload-logging/)).
- **Turnstile:** we did not find what it logs. It only sees its own widget's traffic, not our API headers. That is our inference.

**OWASP:**
- At least 64 bits of entropy; 128 bits for codes you make yourself.
- Never log the raw value, only a salted hash ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)).

**Recommendation.**
- **The code itself.** 128-bit random table codes, 22 characters. The database stores only their SHA-256 hash and looks codes up by hash. That avoids timing leaks, and a database leak exposes no codes. If raw values are ever compared, use a constant-time compare (`crypto.timingSafeEqual`).
- **Keep it out of URLs and logs:**
  - Never put the code in a query string.
  - If the QR link carries it in the path, swap it straight away and send `Referrer-Policy: no-referrer`.
  - Never add the header as a custom field.
  - Strip it from our own pino logs.
- **Wrong codes, per network:**
  - after 20 wrong codes from one IP in 10 minutes, show a Turnstile check;
  - after 50, refuse code checks from that IP for 15 minutes and alert the Restro team.
  
  At 128 bits, guessing cannot work, so these limits are about noise, not safety. A soft check first avoids locking out a whole club Wi-Fi.

**Unsure.** Whether Railway's own request logs record headers. Check before the pilot.

## 11. Fiscal payment type for an online card payment

**What the rules say** (Наредба Н-18, as in force in 2026):
- The receipt and the sales software record the "вид на плащането — съгласно номенклатурата в софтуера": the payment type from the sales software's own list. Приложение № 29 makes the software keep that list with a code and a name for each type ([Н-18 text](https://kik-info.com/normativna-baza/naredbi/h-18/)).
- Card payments appear as "дебитна/кредитна карта". We found no separate fiscal code for a card paid online through a payment provider rather than on the venue's terminal.
- Art. 3(17) and 52о let **e-shops** taking card-not-present payments issue another document instead of a fiscal receipt. Payments through a "виртуален ПОС" must reach an account declared to the NRA.
- Amounts are in euro since 01.01.2026 (ДВ бр. 42/2025).

**Recommendation (to confirm).**
- Close the bill in the POS on the card payment type. Then add a separate entry in the POS's own payment-type list, for example "Card online (provider)", which counts as card on the fiscal device.
- That lets the venue match the POS's "online card" total against the provider's payouts, and keeps the terminal card total apart.
- Ask Mistral whether a second card-type payment method can be set up.

**Needs the lawyer or the venue's accountant:**
- (a) Is a guest in the venue paying on their phone a "неприсъствено плащане" under the VAT Act definition?
- (b) If yes, does the e-shop route apply to a restaurant? We think not, because the sale happens in the venue.
- (c) Must the provider's account be declared to the NRA as a virtual POS?
- (d) Does the fiscal device have only one card register?

## 12. Last orders and service hours

**What others do.**
- Toast keeps online-ordering hours apart from the restaurant's opening hours, with per-service schedules and date overrides.
- Toast stops taking ASAP orders either at closing time or at closing time minus prep time.
- Toast's business day ends at a "closeout hour", and ordering must end 15 minutes before it ([Toast hours](https://doc.toasttab.com/doc/platformguide/adminConfigureOnlineOrderingHoursOverview.html), [time slots](https://doc.toasttab.com/doc/platformguide/adminManageOrderTimeSlots.html)).
- Square has no built-in "last orders" switch. Sellers set an earlier online closing time instead ([Square community](https://community.squareup.com/t5/Online-Store/Can-you-have-online-orders-placed-up-until-close-Even-with-a/m-p/165516)).

**Recommendation.** A minimal model in the venue's time zone:
- For each weekday: open or closed. If open, an opening time, a last-orders time and a closing time. Times may run past midnight, for example open 22:00, last orders 04:30, close 05:00.
- The service day still ends at 07:00. Last orders must be at least 15 minutes before that, as at Toast.
- One closing message in BG and EN, for example "Ordering is closed. See you tonight."
- Ten minutes before last orders, the guest sees "Last orders at 04:30".
- Date overrides for holidays come later.

**Unsure.** Whether clubs want a different message per weekday. We assume one is enough.
