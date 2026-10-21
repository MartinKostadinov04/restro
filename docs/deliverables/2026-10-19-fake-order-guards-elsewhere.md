# How other products guard against fake orders from a table code
Made by: research subagent (Sonnet), 10-19, for ticket #38 "Guarding against fake orders on the bill" of map #29.

Scope: facts only, no decision. Approval of every order at the bar is out of scope (already decided). Each fact is marked [DOC] (official docs or help centre), [VENDOR PAGE] (marketing), [ARTICLE] (third-party write-up), [READING] (my inference) or [NOT FOUND]. Sources are numbered at the end.

## Summary

- **A fixed table QR is known to be weak.** One vendor rates a fixed ("static") code as "higher" prank risk because anyone with the code can order, and a time-limited ("dynamic") code as lower [DOC, 1]. No product claims a fixed code is safe.
- **The most common cheap guard is a short code printed on the back of the table card** (Papaya, up to 4 digits). The vendor says it stops people who scan a photo of the card, and admits it does not stop someone who photographs both sides [DOC, 2].
- **Staff-opened table plus a PIN for the first order exists** (GonnaOrder: staff open the tab, tell the guest the PIN, PIN is needed only for the first order of that tab) [VENDOR PAGE, 9]. This is the closest match to Restro's "an order opens the bill" worry.
- **Expiring or rotating codes exist:** StoreHub's dynamic QR (vendor suggests 2-4 hours) [DOC, 1]; DiKaS can renew every table's QR at each end-of-day report, which invalidates old ones, but then codes must be shown digitally, not printed [DOC, 8].
- **Products where the check is opened by staff first and the phone only joins it do exist** (storekit with Toast: the check is opened in Toast, the guest scans to view and pay) [DOC, 6]. But that is pay-at-table, not ordering. Most ordering products let the guest's scan start the tab (Toast, Arryved) [DOC, 5, 10].
- **A card on file before ordering on a tab is a real option** (Toast "pre-authorize a card to start a tab", US only, not UK/Ireland/Canada/Australia) [DOC, 5]. Nobody frames it as an anti-prank tool, but it makes a fake order traceable to a card [READING].
- **Staff review of each order is the guard used by one POS** (Petpooja: a code shows on the guest's phone, staff match it to the POS before the kitchen fires) [ARTICLE, 3]. That is the thing already ruled out for Restro, so it is only listed for completeness.
- **The one well-documented incident:** a table's QR code left in a photo posted on WeChat in China led to orders worth about 430,000 yuan (~60,000 USD) on one hot-pot table in 2023; the restaurant could not stop them and moved the guests to a new table [ARTICLE, 12].
- **Many vendors say nothing public** about abuse (Square, Lightspeed, Sunday, Flipdish, Zonal, me&u, barsy and others below). Absence of docs is not proof of absence of controls.
- **Cloudflare Free gives very little rate limiting** (1 rule, per IP only, 10-second window) [DOC, 13]; per-IP limits hurt in a club, where many phones share one IP.

## Does any product accept orders only on a table staff already opened? (question 2)

- **Yes, for paying:** storekit with Toast. Staff (or a storekit dine-in order) open the check; the guest scans, sees it and pays [DOC, 6].
- **Yes, for ordering:** GonnaOrder open tab: staff open the tab, then give the guest the PIN [VENDOR PAGE, 9].
- **Lightspeed pay-at-table (third party):** the phone pulls the open check for the table number, so one must exist [READING, from 7].
- **No (guest's scan starts the tab):** Toast Mobile Order & Pay [DOC, 5] and Arryved OpenTab [DOC, 10]. What Toast does when no check exists is [NOT FOUND].
- **StoreHub, Petpooja:** the order must map to a table; neither says the table must be open. Petpooja tells staff to reject an order if the table is empty [DOC, 1; ARTICLE, 3].
- [READING] An "already open" rule exists in pay-at-table products and one ordering product; most ordering products let the guest start the tab.

## Per product

**Toast.** Table-specific QR; tab or pay-as-you-go; optional group ordering; optional "pre-authorise a card to start a tab" (US only). No documented code rotation, expiry, order limits, order approval or "source" label [DOC, 5]. Alcohol needs a staff ID check [DOC, 4].

**Square.** QR code maps to one table; orders from a table merge into one ticket. Public pages say nothing on prank orders [VENDOR PAGE, 14].

**Lightspeed, me&u, Sunday, Bbot, Ready, Zonal, Wi-Q, Yoello, OrderPay, Qerko, Ordermentum.** Nothing public on prank-order defences [NOT FOUND]. me&u's venue tool shows live orders, alerts and unconfirmed orders and can delay printing drinks by seconds; a failure handler, not an abuse guard [DOC, 11]. me&u tabs start from the table QR and others can join [VENDOR PAGE, 15]. Sunday ties the code to the live check [VENDOR PAGE, 16]. Zonal pre-fills venue and table from the QR [VENDOR PAGE, 17].

**Flipdish.** Table QR pre-fills the table number, passed to the POS only as a note. Customers mostly pay in advance (card-only can be enforced). No anti-prank feature, no location enforcement [DOC, 18].

**Papaya (Thailand).** Table code of up to 4 digits entered after scanning; printed on the back of the card; only for dine-in "pay at the end" orders. Staff can verify unusually large orders. Vendor "hasn't received reports of truly malicious attempts". It does not recommend changing codes often (staff work and guest confusion) [DOC, 2].

**StoreHub.** Static sticker versus dynamic QR created by the cashier for a chosen table, with a validity period (2-4 hours recommended) [DOC, 1].

**Petpooja.** After a phone order, a code appears on the guest's screen; staff match it at the table; reject if no match or the table is empty. Warns that skipping this during rushes defeats it [ARTICLE, 3].

**DiKaS (Germany).** Regenerate a table's QR at any time (old code dies instantly) or auto-renew all at end-of-day; venue can require staff to accept/reject orders, or "pre-pay only"; waiter-call has a 60-second cooldown [DOC, 8].

**GonnaOrder.** Staff open a tab, give the table PIN, first order needs the PIN [VENDOR PAGE, 9]. QR includes the table number so staff see which table the order came from [DOC, 19].

**Arryved OpenTab.** Guest scans an active, table-specific code; tabs can be switched off by schedule (scanning outside it shows a message); venue can stop ordering by removing the physical codes; guests must close out digitally [DOC, 10].

**Sapaad, Appropo, Slerp.** Fixed one-QR-per-table codes; Sapaad flags a tab idle too long ("walkout risk") [VENDOR PAGE, 20]; Appropo has an alcohol age check [DOC, 21]; Slerp documents no controls [DOC, 22].

**barsy's own QR menu.** The public docs index (docs.lukanet.com) lists only barsy::help, barsy::eshop and barsy::api; no public page on QR or table ordering was found [NOT FOUND, 23].

## What staff see (question 4)

- A table-bound QR puts the table number on the ticket (GonnaOrder, Arryved, Square, Appropo) [DOC, 10, 21; VENDOR PAGE, 14, 19].
- me&u shows alerts and unconfirmed orders; Sapaad flags idle tabs; Petpooja raises a new-order notification staff must check [DOC, 11; VENDOR PAGE, 20; ARTICLE, 3].
- A "first order from this table" mark, a sound, or a "source: phone" label as an anti-fraud signal: [NOT FOUND] in public documentation.

## Cloudflare: rate limits and Turnstile (question 3)

**Rate limiting rules, Free plan [DOC, 13]:** 1 rule, counting by IP address only, 10-second window, 10-second block, counting requests, matching on path (and "verified bot"). Pro has 2 rules, Business 5, Enterprise 100 [DOC, 24]. Free also has 5 ordinary custom rules [DOC, 25]. [READING] One rule means one path and one threshold for all venues; "no more than N orders per table per hour" must be done in our own server code.

**Limits of IP-based limiting in a club:** Cloudflare's research says one IPv4 address can stand for hundreds or thousands of users (carrier-grade NAT, VPNs); shared addresses get rate limited about three times more often, and one bad user can get everyone on the address blocked [DOC, 26]. Mobile operators put thousands of devices behind one IP [DOC, 27]. [READING] On venue Wi-Fi every guest looks like one IP, so a limit low enough to stop one prankster also blocks a busy night's real guests; on mobile data, unrelated guests may share an IP. IP limits must be generous (floods only). Limits per table or session in our own code avoid the problem.

**Turnstile, Free plan [DOC, 28, 29]:**
- Free: up to 20 widgets per account, 10 hostnames per widget, unlimited challenges, all widget types, 7 days of analytics. Not on Free: ephemeral IDs, removing Cloudflare branding.
- Three modes: Managed (checkbox only when risk is high), Non-interactive (visible spinner, no interaction), Invisible (nothing shown). Needs a current browser; unsupported browsers see an error. Hosted at challenges.cloudflare.com, so a content-security policy must allow it [DOC, 29].
- iOS Safari: Cloudflare has a supported-browsers page that lists Safari and iOS, but I could not read its table [NOT FOUND for versions].
- Privacy: Cloudflare's cookie page lists `cf_clearance` as "strictly necessary" and encourages customers to disclose cookies; Turnstile only sets it when pre-clearance is switched on, otherwise it issues a one-time token [DOC, 30, 31]. Invisible mode requires referencing Cloudflare's Turnstile Privacy Addendum in our privacy policy [DOC, 29]. Third-party articles disagree on whether a consent banner is needed; one site's scan flagged a `cf.turnstile.u` cookie loading before consent [ARTICLE, 32]. Cloudflare's cookie page does not list it [DOC, 30]. Whether a banner is required in the EU is a legal reading, not a fact; this is for the lawyer-for-interpretation list [READING].
- A token proves "a browser ran a challenge", not "this phone is at table 7". It stops scripts, not a human with a photo [READING].

## Incidents (question 5)

- 2023, Kunming, China: a hot-pot guest posted a photo with the table's order-and-pay QR visible, shared only with her WeChat contacts. Many scanned it and ordered; the total reached about 430,000 yuan; staff queried a first 6,000 yuan order, could not stop the rest, and moved her group to a new table. Reports say she was not made to pay [ARTICLE, 12; secondary reports, the original is SCMP].
- Stickers over real codes to steal card data are a different threat (tampering) [ARTICLE, 33].
- One vendor article mentions a photographed code used for large orders until the code was blacklisted; I could not open its source, so unverified [ARTICLE, 3].
- No other incident reports of prank orders in bars or clubs found [NOT FOUND].

## What this means for Restro (options and costs, no decision)

The facts above suggest four layers. They stack; each costs something.

1. **Open-table rule: orders accepted only when the table already has an open POS bill (staff opened it).**
   - Kills: a photographed code used at a table nobody is sitting at, and fake bills opened from nothing. Matches GonnaOrder and the pay-at-table products.
   - Cost: a waiter must open every table first; guests at a table nobody has opened cannot order. Contradicts the "order opens the bill" idea. Does not help when the table has a real open bill (the Kunming case).
2. **Short code on the back of the card, or told by the waiter (PIN).** Optionally only for the first order of a bill (GonnaOrder).
   - Kills: casual and remote misuse from a photo of the front. Does not stop someone who photographs both sides. Papaya reports no malicious attempts with it.
   - Cost: print/design work; one more step for the guest; a waiter has to say the code if the PIN is per visit. If changed per visit it gets staff work (Papaya advises against).
3. **Codes that expire (rotating QR or per-visit code).** Cost: printed codes go stale, so staff must hand out or display new ones; StoreHub's idea is a cashier creating a short-lived code, DiKaS's is end-of-day rotation on a screen. More staff work or hardware, strongest in a club with shifts.
4. **Limits and flood guards.** Per order and per table per hour (item count, total value), a short cool-down per phone/session, Turnstile on the order button.
   - Cost: legitimate big rounds in a club (bottle service) may hit limits, so values need tuning per venue. Turnstile adds a third-party script and a privacy-policy line; it stops scripts, not photographers. Cloudflare Free rate limiting is one IP-based rule; keep it generous and do the real limits in our own code.
5. **Card on file / pre-authorisation before ordering** (Toast option, not in UK/Ireland/Canada/Australia). Cost: payment-provider work; belongs to the payment scenarios in map #29.
6. **Staff-visible marks** (phone source, first order for the table, large value). No public example exists, so it would be our own design. Cost: needs a place on the POS ticket; what barsy allows is unchecked here.

Open facts I could not settle: how barsy's own QR product behaves; whether iOS Safari needs any special setting for Turnstile; Cloudflare's legal position on EU consent for Turnstile.

## Sources

1. StoreHub, "How to set up tables and QR codes" https://care.storehub.com/en/articles/9684912-how-to-set-up-tables-and-qr-codes [DOC]
2. Papaya, "Table codes" https://help.papaya.co.th/en/articles/9215241-table-codes [DOC]
3. Petpooja, "Set up QR code ordering" https://blog.petpooja.com/industry-business-guides/set-up-qr-code-ordering-restaurant-guide/ [ARTICLE]
4. Toast Mobile Order & Pay FAQs https://support.toasttab.com/article/Toast-Mobile-Order-and-Pay-FAQs [DOC]
5. Toast, "Setting Up Toast Mobile Order & Pay" https://support.toasttab.com/en/article/Setting-Up-Toast-Mobile-Order-and-Pay [DOC]
6. storekit, Toast pay-at-table https://storekit.com/docs/guides/integrations/pos/toast/pay-at-table [DOC]
7. storekit, Lightspeed pay-at-table https://storekit.com/docs/guides/integrations/pos/lightspeed/pay-at-table.md [DOC; seen via search summary only]
8. DiKaS, table self-ordering https://doku.dikas.de/en/benutzerhandbuch/module/tisch-selbstbestellung/ [DOC]
9. GonnaOrder, open tab ordering https://www.gonnaorder.com/?p=33752 [VENDOR PAGE]
10. Arryved, OpenTab considerations https://support.arryved.com/portal/en/kb/articles/opentab-service-model-considerations [DOC]
11. me&u help, live and past orders https://meandu.helpjuice.com/how-to-see-live-and-past-orders-in-venue-manager- [DOC]
12. UNN, citing South China Morning Post, 4 Dec 2023 https://unn.ua/en/news/a-customer-of-a-chinese-restaurant-was-shocked-by-the-bill-for-his-order-after-accidentally-posting-his-qr-code-online [ARTICLE]
13. Cloudflare, Rate limiting rules https://developers.cloudflare.com/waf/rate-limiting-rules/ [DOC]
14. Square, QR code ordering https://squareup.com/us/en/online-ordering/qr-code-ordering [VENDOR PAGE]
15. Square, me&u integration https://squareup.com/au/en/townsquare/mr-yum-integration-au [VENDOR PAGE]
16. Sunday, Pay at Table https://sundayapp.com/?p=40643 [VENDOR PAGE]
17. Zonal, Order and pay https://zonal.co.uk/?p=1451 [VENDOR PAGE]
18. Flipdish, table ordering and QR code FAQ https://help.flipdish.com/en/articles/9585439-table-ordering-and-qr-code-faq [DOC]
19. GonnaOrder tables https://www.gonnaorder.com/?p=22157 [VENDOR PAGE; search summary only]
20. Sapaad, One QR one table https://www.sapaad.com/us/one-qr-one-table/ [VENDOR PAGE]
21. Appropo, order at table https://appropo.io/docs/ordering/checkouts/table/ [DOC]
22. Slerp, order at table https://support.slerp.com/knowledge/order-at-table [DOC]
23. Lukanet docs index https://docs.lukanet.com [DOC; index only]
24. Cloudflare, rate limiting features https://developers.cloudflare.com/learning-paths/application-security/rate-limiting/features/ [DOC; search summary only]
25. Cloudflare, WAF custom rules https://developers.cloudflare.com/waf/custom-rules/ [DOC]
26. Cloudflare blog, "One IP address, many users" https://blog.cloudflare.com/detecting-cgn-to-reduce-collateral-damage/ [DOC; via search summary and The Register, https://www.theregister.com/2025/11/03/cloudflare_cgnat_bias_research/]
27. Cloudflare blog, "Introducing Advanced Rate Limiting" https://blog.cloudflare.com/advanced-rate-limiting/ [DOC; search summary only]
28. Cloudflare Turnstile plans https://developers.cloudflare.com/turnstile/plans/ [DOC]
29. Cloudflare Turnstile widget modes https://developers.cloudflare.com/turnstile/concepts/widget/ [DOC]
30. Cloudflare cookies https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/ [DOC]
31. Cloudflare, Turnstile CSP and pre-clearance https://developers.cloudflare.com/turnstile/reference/content-security-policy/ [DOC; search summary only]
32. Webflow forum, "cf.turnstile.u cookie loading before consent" https://discourse.webflow.com/t/cookie-consent-compliance-cf-turnstile-u-cookie-loading-before-consent/326947 [ARTICLE]
33. Modern Restaurant Management, QR code fraud https://modernrestaurantmanagement.com/how-restaurants-can-protect-their-business-and-customers-from-qr-code-fraud/ [ARTICLE; search summary only]
