# Taking card payments inside a venue: what we still need to know

**Purpose:** we are building a phone menu and ordering app for Bulgarian nightclubs. Before we can build the payment part, a few things must be confirmed by the payment company and by a Bulgarian lawyer. This list holds everything our research could not settle, and why.

**From:** Martin Kostadinov (Restro), **To:** Part A: the payment provider (myPOS first). Part B: a Bulgarian lawyer or tax adviser. Part C: the two POS vendors (Lukanet for barsy, Mistral Software). Part D: Martin himself. **How your answers will be used:** to decide which payment provider we build on first, and how the app must handle receipts, deposits, holds and refunds.

## Context

Restro lets a guest scan a QR code at a nightclub and see the menu on their phone. Next we want the guest to pay on the phone and to request songs from the DJ. For paid song requests the guest's card is **held** when they ask for the song (the money is reserved, not taken), **charged** only if the DJ accepts, and **given back** if the DJ skips it or the night ends. The same hold idea works for table deposits.

Four rules we have already decided (the fourth is Martin's architecture conclusion of 17 October): the venue's own sales system (POS) registers each sale, prints the fiscal receipt and issues any correction; the payment provider holds the money in the venue's own account; Restro sits between the two. For every app payment we plan: **reserve the money, then the POS registers the sale and prints the receipt, then the money is charged**. If the POS cannot print, the reservation is released.

Three rules we have already decided:
- The **venue** is the seller and has its own account at the payment provider. Restro never holds the venue's money.
- Restro charges the venue a fee separately (invoiced), unless a provider lets us take it inside the payment.
- Whether the venue must print a fiscal receipt for these payments is a legal question. That is Part B.

We researched five providers (myPOS, Stripe, Borica, ePay.bg, SumUp) from their own public developer pages. Full findings: `docs/deliverables/2026-10-17-payment-providers-feasibility.md` and `docs/deliverables/2026-10-17-fiscal-rules-in-app-payments.md`. Public documentation exists for all of them. The gaps below are details the pages do not state, or pages we could not read.

## How to answer

Part A is for the provider, about 20 minutes; Part B for the lawyer, about 1 hour; Part C points to the vendors' lists; Part D is for Martin, 5 minutes. Short answers are fine. "I don't know" or "ask X" is useful: please say who we should ask rather than skip. Under each question, "What we found" says what we already know and why we are still stuck.

---

# Part A. Payment provider (start with myPOS)

We chose myPOS as the first provider to approach. The same questions apply to any provider we approach later.

## Holds (the most important block)

### A1. Can a venue's account use holds (pre-authorisation) online, and what must the venue do to switch it on?

_Why this matters: song requests and deposits depend on it._

**What we found:** the documentation says holds are "not enabled by default" and that myPOS support must switch them on. It does not say on what conditions.

>

### A2. What is the longest a hold can last for a nightclub or bar?

**What we found:** "typically up to 30 days, depending on business type". We could not find the number for nightclubs. The help-centre article was blocked to our tool (access denied), so we have not read it.

>

### A3. Can we charge less than the held amount, and does the rest go back to the guest automatically?

_Why this matters: if a request price changes, or a tip is added, we must not charge the wrong amount._

**What we found:** the capture page says nothing about an amount different from the hold.

>

### A4. Can we charge more than the held amount, for example to add a tip afterwards?

>

### A5. If a hold is never charged or cancelled, what happens at the end of the period? Does the guest's money come back by itself, and when?

**What we found:** nothing written. Our night-time promise to clubs says unused holds "expire on their own", so we need to know this is true.

>

## Refunds

### A6. Can we refund part of a charged hold? Is there a time limit?

**What we found:** one page says a merchant can refund "any partial amount" up to 100%, but the technical page for the refund call is silent on partial amounts and on a deadline.

>

### A7. When we refund a charge that came from a hold, which transaction number do we refund?

**What we found:** not stated whether charging a hold creates its own refundable transaction.

>

## Messages from myPOS to our server

### A8. If our server does not answer a payment notification, how often and for how long does myPOS retry?

_Why this matters: if the guest closes the browser after paying, the notification is how we learn the payment happened._

**What we found:** no retry schedule is published. The page says any answer other than "200 OK" counts as an error.

>

### A9. How exactly is a notification signed? Which fields, in which order, with which key?

**What we found:** "SHA-256 of all fields, Base64, last field in the message". No key and no field order are given, so we cannot yet verify messages.

>

## Apple Pay and Google Pay

### A10. Are Apple Pay and Google Pay shown on the hosted payment page in production? Do they work together with a hold? Is there an extra fee?

**What we found:** a marketing page says Apple Pay is available on the hosted page. We found nothing on Google Pay, and nothing on wallets with holds. The developer notes say wallets cannot be tested in the sandbox.

>

## Test mode

### A11. Can holds, charges, refunds and wallets all be tested in the sandbox? If not, which only work live?

**What we found:** a sandbox with shared test keys and test cards exists. It does not say whether holds or wallets work there, and 3D Secure (card security check) is skipped there.

>

## How the venue connects, and the money

### A12. How should a software platform connect to a venue's myPOS account? The venue's own store keys, or the Partner Portal credentials? Who holds the private key?

**What we found:** both routes exist in the documentation. The partner credentials appear to cover accounting and banking; they are not described for payments.

>

### A13. The Partner Portal advertises "automatic commission splits and merchant payouts". How does it work, under which contract, and does it change our status (do we become a payment intermediary)?

_Why this matters: we have to decide whether Restro's fee is invoiced separately or taken inside the payment._

**What we found:** no parameter for a fee exists in the payment calls. The portal mentions splits with no detail.

>

### A14. What does a venue pay for card payments with holds, refunds and wallets? Is there any charge for a platform like ours?

**What we found:** the published rate for cards in Europe is 1.30% plus 0.10 EUR. No prices for holds, refunds, wallets or platforms.

>

### A15. Which payment methods on the hosted page are bank transfers (not cards), and does myPOS count them as "credit transfers"?

_Why this matters: Bulgarian fiscal rules exempt credit transfers from the fiscal receipt (see Part B, B6)._

**What we found:** the hosted page lists methods such as iDEAL, Satispay, TWINT and IRIS. We do not know which are bank transfers or how they are classified.

>

### A16. Does myPOS give the venue any document for a payment that the venue can use as a receipt?

**What we found:** nothing found in the pages we read. Needed only to cross-check Part B.

>

## Holds on every payment, and the venue's sales system (new)

These come from the architecture conclusion: every app payment, not only song requests, may start as a hold. Needed for the order "hold, then the sales system prints the receipt, then charge".

### A17. Can a hold be placed on an ordinary bill, including with Apple Pay and Google Pay?

**What we found:** the research looked at holds for song requests and deposits only. Nothing found on wallets with holds for any provider except Stripe (documented as supported).

>

### A18. What is the shortest hold you support, and how long after the hold can we charge? How fast does a charge go through, and how can a charge fail after the hold succeeded?

_Why this matters: if the charge fails after the receipt is printed, the venue must correct the receipt._

**What we found:** only the maximum hold length is published (about 30 days for myPOS, 7 days for Stripe). Nothing on the shortest hold, charge speed, or how a charge can fail afterwards.

>

### A19. What does a hold cost? Is there a fee when a hold is released without a charge?

**What we found:** no provider publishes a hold price; Stripe says refunds have no fee for most methods.

>

### A20. When we give money back, which reference do you return, when exactly is it executed, and how do you separate three cases: releasing an uncharged hold, cancelling before settlement, and refunding after settlement?

_Why this matters: the venue's sales system treats a refund after charging as a correction ("storno") but a released hold as nothing, so we must tell them apart._

**What we found:** myPOS has separate "reversal" and "refund" calls; Stripe separates cancel and refund; the references and timing are not described the same way anywhere.

>

### A21. Does your hosted payment page collect the guest's email and pass it to us?

_Why this matters: an electronic fiscal receipt can only be sent if we have a guest address (see Part B, B3 and B17)._

**What we found:** not stated for myPOS or for the other providers.

>

### A22. (myPOS) barsy documents payment links paid through the venue's own myPOS terminal. Can that link do a hold, and what does the myPOS and Zamboo partnership cover: online payments tied to Zamboo receipts?

**What we found:** barsy's documentation names the myPOS link; a myPOS news page announces the Zamboo partnership (not opened). We have not seen either detail.

>

## If we also approach other providers, add these

### A-Stripe. What does Stripe's review of a platform like Restro require? Do wallets on Stripe-hosted checkout need a domain set up for each venue's account?

**What we found:** Stripe documents everything else we need. These two points are unclear.

>

### A-Bank or Borica. Can a venue's bank enable holds and wallets on the venue's online terminal? May a software platform keep the venue's signing key? Does Borica offer push notifications?

**What we found:** the technical specification shows no push notifications, only the guest's browser returning and a status check for the last 24 hours. The signing key must not be shared, according to the specification.

>

### A-ePay.bg. Is there a way to refund through their interface? Are Apple Pay or Google Pay supported? Who switches on pre-authorisation?

**What we found:** holds are documented (30 days). Refunds appear to be done by hand in the venue's ePay account. The documentation is from 2023.

>

### A-SumUp. Is there any hold (reserve now, charge later) for online payments?

**What we found:** none in the whole documentation file (about 590 KB searched). Without it, SumUp could only do "charge on request, refund if skipped".

>

---

# Part B. Lawyer or tax adviser

The full lawyer list is L1 to L29 (final at commit b81bc16) with Bulgarian and English wording: L1 to L12 in `docs/deliverables/2026-10-17-fiscal-rules-in-app-payments.md`, L13 to L29 in `docs/deliverables/2026-10-17-pos-integration-requirements.md`. Plain-language versions follow; each carries its L-number and the article in brackets. **Send the Bulgarian wording from those files to the lawyer; this list is for understanding.**

**Why we are stuck on all of these:** the law (Наредба Н-18, ЗДДС) is written for shops with a cash register and for online shops. A guest paying on a phone while sitting in the club is neither, and no text answers it directly. We can quote the articles, but only a lawyer can say how they apply. We read the primary texts only, not law-firm summaries.

## Card payment at the table

### B1. A guest sits in the club, orders and pays by card on their phone. Is that a "remote card payment" (which can use an electronic document instead of a fiscal receipt), or must the venue's fiscal device issue a receipt for each payment? (L2)

_Why this matters: it decides the whole design of paying in the app._

**What we found:** our reading is that it needs a fiscal receipt, because the service is delivered at the venue's premises and the guest is present (ЗДДС § 1, т. 96 and т. 87; ЗЗП чл. 45; Н-18 чл. 3, ал. 17). This is only our reading.

>

### B2. The law exempts payments "through a payment service provider" from the fiscal receipt. Does that cover a card payment, or only a cash transfer? (L1)

**What we found:** the tax authority's page lists the provider as a separate exemption, but the text of the regulation can be read either way (Н-18 чл. 3, ал. 1).

>

### B3. May the electronic fiscal receipt be shown to a guest who has no account and gave no email, for example only on screen in their session? Under what conditions? (L3)

**What we found:** the regulation allows an electronic receipt sent to a customer address; it does not say what to do for an anonymous guest (Н-18 чл. 3, ал. 18–19; чл. 25, ал. 13).

>

### B4. Our app shows the guest the running total of the table's bill with a Pay button. Is that screen a "document with information on the current amount", which must follow the official sample and say "НЕ СЕ ДЪЛЖИ ПЛАЩАНЕ"? (L9)

**What we found:** the rule exists for such documents (Н-18 чл. 7а, чл. 26, ал. 6, приложение № 39). We cannot tell if an app screen is one.

>

## Deposits and no-shows

### B5. A guest pays a table deposit by card from home. Is it a remote payment, or must the venue register it with its fiscal device (and which device, if the payment arrives outside opening hours)? When the guest arrives, is the deposit taken off the final bill as a discount? (L4)

**What we found:** Н-18 has a mechanism for deposits counted against the bill (чл. 26а). VAT becomes due on receiving the deposit (ЗДДС чл. 25, ал. 7). Whether the "remote payment" route applies is unresolved.

>

### B6. If a guest pays by bank transfer through a payment provider ("pay by bank"), does that count as a credit transfer, so that no fiscal receipt is due? (L5)

**What we found:** credit transfers are exempt (Н-18 чл. 3, ал. 1). Whether a provider-run bank payment counts is not stated anywhere we could read.

>

### B7. If the guest does not show up and the venue keeps the deposit, is that taxable, or compensation outside VAT? Which document corrects the VAT already charged? (L6)

**What we found:** the EU Court has treated it as compensation (C-277/05). Bulgarian law has no text on it.

>

## Holds and song requests

### B8. Is a card hold (reserved, later charged or released) a "receipt of payment"? Is it right to issue the fiscal receipt only when the money is charged, and nothing when a hold is released? (L7)

**What we found:** VAT arises on receiving payment (ЗДДС чл. 25, ал. 7), so we read it as "only at charge". Not confirmed.

>

### B9. Is a paid song request a service of the venue at 20% VAT, even when the DJ is a separate business? If several guests chip in for one song, does each payment get its own receipt? (L8)

**What we found:** no text covers this case; we reasoned from the general rules (ЗДДС чл. 9, ал. 1; чл. 66, ал. 1).

>

## Refunds

### B10. A skipped song or a cancelled deposit is refunded to the guest's card. Can the venue's fiscal device document the refund (a "сторно"), and when: when ordered or when the money arrives? Is anything needed when the provider cancels before settlement? (L10)

**What we found:** the storno rules are written around cash. Only an ИАСУТД is expressly allowed to storno a refund paid back to a card (Н-18 чл. 31, ал. 3а, new in 2025).

>

## Restro itself

### B11. Is Restro "sales-management software" under the law? If the venue uses listed sales software, may Restro send orders in as an import without being a forbidden "external module"? Does Restro's fee, paid by the venue by card, need a fiscal receipt? (L11, L21)

**What we found:** the definition is broad (ЗДДС § 1, т. 84); the venue-side rule is the decisive one (ЗДДС чл. 118, ал. 18; Н-18 чл. 52з, ал. 5, 10–11, приложение № 42). Unclear how it applies to us.

>

### B12. Has an amendment to Н-18 been published or announced about communication between fiscal devices and information systems (in force 1 January 2026 under ЗДДС чл. 118, ал. 4, т. 10)? (L12)

**What we found:** the enabling provision exists. We found no published amendment.

>

### B13. Orders from Restro (L13, L14, L15). When an order or a paid song request reaches the venue's sales software from Restro, who is the "applicant" in the official import rules: Restro, the venue's channel or the guest? Is the DJ accepting a song request, or Restro accepting an order automatically, the "commitment" that must already be recorded in the listed software? May a technical "import operator" stand in for a person's two names?

**What we found:** the rules exist for imported orders (Н-18 приложение № 42 and № 29), but they were written for online shops with a human operator. We cannot map them to Restro.

>

### B14. Money and receipt in the wrong order (L16). Is it a breach to charge the card while the venue's fiscal device is offline and print the receipt when it returns? Which order is allowed: charge then print, or print then charge, with a correction if the charge fails?

_Why this matters: it decides whether we must check that the device is ready before charging a guest._

**What we found:** the regulation requires the receipt at the moment of payment (Н-18 чл. 25, ал. 6) and says nothing about an offline device in this case.

>

### B15. Deposits across days (L17, L18). How does one sale number link a deposit paid on booking day to the bill on the night? Does barsy's method (deposit sold as an item "Капаро", then a negative line on the final receipt) satisfy Н-18 чл. 26а, or is the "ЧАСТИЧНИ ПЛАЩАНИЯ" department with a value discount required?

**What we found:** the article describes the department method. barsy's own method differs and we could not verify it with them (see Part C).

>

### B16. Refund documents (L19, L20). Which reason in Н-18 чл. 31, ал. 1 applies when a paid, accepted song request is never played? barsy holds that a refund "by bank" needs no storno receipt; does a refund to the guest's card through the provider count as such a refund, and how is the original turnover corrected?

**What we found:** the storno rules are written around cash; see B10.

>

### B17. Is a page without a delivery address an "online shop"? (L22, L23, L24, L25) The law defines an e-shop by contact details, delivery address and payment method. Are these cumulative, so a page without an address field (song requests; a reservation with a deposit and an email) is not an e-shop? If it is an e-shop, must the venue file Annex 33 before the first payment, naming Restro as an "online platform" or as host and software? May the venue then send an electronic fiscal receipt from its device to an email the guest enters? Is a song request paid by a guest outside the club still a non-remote payment, because the song plays in the club?

**What we found:** the definition (ЗДДС § 1, т. 87) is not clear on whether the elements are cumulative, and the answer decides which regime applies.

>

### B18. Consumer law for song requests (L26, L27). Is the right to withdraw lost once the song is played, if the guest agreed in advance? Is a withdrawal button needed until then? Without an email, is a confirmation shown in the browser with a download option a "durable medium"?

**What we found:** we found the articles (ЗЗП чл. 57, чл. 52а, чл. 49, ал. 8) but not how they apply to a song played the same night.

>

### B19. Gambling (L28). Do you confirm that a paid song queue, ordered by the guests' amounts, where requests not played are released unpaid, is not gambling?

**What we found:** no text addresses it; we reasoned from the definition (ЗХ чл. 2, ал. 1).

>

### B20. A pending change in the VAT law, with a date (L29). Does the draft amendment of ЗДДС (public consultation 12733-K, open until **23 October 2026**) change чл. 118 or the duties of persons using listed sales software?

_Why this matters: the consultation closes within days of this list; the lawyer may want to comment._

**What we found:** the draft is published; we have not read its effect on чл. 118 line by line.

>

### B21. If a provider lets us take our fee inside the payment (one provider does), does Restro become a payment intermediary needing a licence? Or is invoicing the venue separately the only safe route?

_Why this matters: it decides whether taking a fee inside the payment is allowed at all._

**What we found:** the law is not our research scope here. Stripe documents the feature; myPOS advertises "commission splits" without detail.

>

### B22. Music rights (proposed L30, not yet in either research file). Does charging guests per requested song change the club's public-performance licences (Musicautor, Prophon)?

_Why this matters: if paid requests change the licence terms, the club may owe more, and that affects whether clubs accept paid song requests._

**What we found:** not researched. The fiscal session raised it with Martin in chat only, because the pull request was limited to the file move. The lawyer's list L1 to L29 is final; this one is an addition waiting for the lead to add it.

>

---

# Part C. POS vendors (Lukanet for barsy, Mistral Software)

These are not payment questions, but they decide whether a payment taken in the app can reach the venue's fiscal device. The lists are ready to send in `docs/deliverables/2026-10-17-pos-integration-requirements.md`: 13 questions for Lukanet (helpme@lukanet.com) and 9 for Mistral Software. The ones that touch payments most:

- Does closing an account through the API with a card payment print the fiscal receipt on the venue's device, and what if the device is offline? (Lukanet 3, Mistral 4)
- Can we ask, before taking the guest's money, whether the device is ready to print? (Lukanet 4, Mistral 4)
- How does barsy handle deposits and partial storno of card refunds? (Lukanet 6, 8, 9)
- Does barsy's payment link, paid through the venue's own myPOS, close the account and print the receipt, and can the guest be sent back to another page afterwards? (Lukanet 10)

**Why we are stuck:** barsy's API pages need Martin's signed-in reading (we never type passwords), and Mistral's documentation was not public.

---

# Part D. Martin (decisions only you can make)

### D1. Which sales system (barsy or Mistral) and which payment provider does your first pilot club already use?

_Why this matters: our research recommended Stripe first on documentation alone, before the sales-system angle. barsy documents payment links through the venue's own Borica or myPOS terminal, and we found no Bulgarian sales system that documents a Stripe link. A club's existing provider and sales system may outweigh the documentation ranking._

>

### D2. How should we charge the venue (Q77)? A fixed monthly fee, a percentage of song-request money we record, or both?

_Why this matters: "percentage inside the payment" needs a provider split (B21); "invoiced" does not._

>

### D3. Do you accept that if a provider lacks holds (SumUp), song requests run as "charge on request, refund on skip"?

>

---

## Anything else?

Anything we did not ask that we should know before building: requirements, deadlines, extra documents, or a person we should ask instead.

>
