Made by: lead session (Opus), 10-21. For: Martin, to send to Mistral Software (office@mistral.bg; fiscal service fiskal@mistral.bg).

# Every question for Mistral Software, in one list

The questions were drafted across five files:
- 1–9: `2026-10-17-pos-integration-requirements.md`;
- 10–18: `2026-10-20-ordering-what-we-decided.md` §15;
- 19–23: `2026-10-20-mistral-api-checker.md`;
- 24–29: `2026-10-20-ordering-review-merged.md`;
- 30–37: `2026-10-21-board-review-final.md`.

The receipt-law check added four more, which are folded in here as 21, 36 and 38–39. The numbers are kept so every file still points to the right question. Martin's answers of 10-21 drop 32 and 34, and add 40. The ticket review of 10-21 (`2026-10-21-map-29-ticket-review.md`) adds 41 and a venue question about the payment account.

Not sent yet: Martin sends them and records the date here or in the tracker. When answers come, an agent fills the "Shown" and "Route" columns of the Mistral API checker.

## Send first: they decide whether and how Restro can connect

- **21. Authorisation (the law requires it).**
  - EN: Under Наредба Н-18 чл. 52з, ал. 5, a venue may not add outside modules to listed sales software without the producer's authorisation; Приложение 32, т. 17 asks the venue to declare links to other systems. Will you authorise Restro as a linked module for ordering and payments at your customers' venues? On what terms and at what price, and what does the venue write in its Приложение 32 filing?
  - BG: Съгласно Наредба Н-18, чл. 52з, ал. 5, обектът не може да добавя външни модули към регистриран СУПТО без разрешение на производителя, а Приложение 32, т. 17 изисква деклариране на връзките с други системи. Ще разрешите ли Restro като свързан модул за поръчки и плащания в обектите на ваши клиенти? При какви условия и цена, и какво вписва обектът в Приложение 32?
- **23.** Can Restro use the same interface your Zamboo Web Menu uses (menu, orders to a table, order status)? Is it documented?
- **2.** Is there an API for third parties (protocol, authentication, documentation, test installation, terms, cost)? What does the Back Office screen "Външни системи" do?
- **1.** Which product runs at the pilot venue, Zamboo or Мистрал v3, and which version? Is it on the NRA list under ЗДДС чл. 118, ал. 16 (type, version)?

## The menu

- **18.** Can an outside app read the menu: items, categories, prices, options and add-ons, and what is sold out?
- **42.** Right before sending an order, can an outside app ask whether each item is still available (in stock) at that moment? If an item has run out, does Zamboo refuse the line, and does it say which item? (Martin 10-21: stock lives in the POS.)
- **28.** What are the API's rate limits? Where does it run, on the venue's PC or a server? Can one call read every open bill in the venue?

## Ordering on the bill

- **3.** Can an outside app post an order to a table or a bill, as Zamboo Web Menu does? Does the order wait for approval in the POS?
- **40.** Can an outside app add the first items to a table that has no open bill, so the bill opens? Or must a waiter put the first item on? *(New, 10-21.)*
- **22.** Is a table "always live" (a closed bill leaves it waiting for the next first item), or does staff open a table? How can an outside app read which?
- **30.** When all lines are moved off a table, is its bill closed, or empty and still open? How does a read show the difference?
- **10.** Is one bill per table enforced? Can a table hold a second open bill?
- **15.** Does a read of a table's bill give each row with who entered it and when? Is a call all-or-nothing? Can an outside app put its own id on a row and read it back? Does a repeated call with the same id create nothing?
- **13.** What does a bar ticket print: the table, the operator (the POS user), a free-text note? In which language? Does a sale that is opened, paid and closed at once print a ticket?
- **31.** Can an order written by an outside app carry a free-text note per line and the chosen options? Do they print on the bar ticket?
- **14.** Is there approval of outside orders? Does the ticket print when the order is entered, or when it is approved?
- **16.** Can the API tell which bar a table belongs to?
- **19.** Does each bar log in to Mistral separately? Can one outside POS user act on the tables of all bars, or does it need one per bar?
- **33.** Which rights does an outside app's POS user need to add a round, move lines, take a card payment and close a bill?
- **27.** Is there a training mode or a test installation for a rehearsal at the venue?
- **8.** Are there webhooks, or polling, for order status, the УНП and the receipt number?
- **5.** Does Zamboo meet Приложение 42, т. 2 for imported orders (source, method, request id, declined requests kept, requested against confirmed)?

## Paying in the app (the pilot needs these too: Martin 10-21)

- **11.** Can the API move chosen lines, or part of a line's quantity, from one table's bill to another table? Does a move print a ticket again at any bar?
- **12.** How are virtual or buffer tables set up? Can each belong to a bar? Can an outside app order onto one, pay and close it?
- **4.** Can an outside app register a card payment taken online and make Zamboo print the fiscal receipt at that moment, with a chosen payment type? On which fiscal devices and drivers? Can it first check that the device is ready?
- **26.** Which payment type does a close from an outside app use? Can it be set to "card"?
- **36.** Can Restro's card payments use a payment type of their own ("Card online"), counted as card on the fiscal device, so the venue can tell them apart from its terminal? Can the pilot's fiscal device take two card payment types?
- **38.** Can the API register a sale as an **electronic** fiscal receipt and pass the guest's email (ЗДДС чл. 118, ал. 21–22; Н-18 чл. 52з, ал. 17)? Can the pilot's fiscal device issue electronic receipts?
- **39.** Can the API return the receipt's data (number, УНП, QR content), or the device's own electronic receipt file?
- **25.** Does a close return the fiscal receipt's number? Can a close succeed while the fiscal printer fails?
- **17.** Which fiscal device prints the receipt for a sale closed on a virtual table, and where does the paper come out?
- **35.** Can a close or the fiscal receipt carry a note, such as "for Table 7 · ref K7Q"?
- **37.** How does a discount on the whole bill show in a read, and what happens to it when some lines are moved?
- **24.** Can the API read today's **closed** bills on a table, with their payments?
- **29.** Can the day be closed while a virtual table still has an open bill?
- **20.** Can one close carry several card payments from several payers?
- **6.** Does Zamboo support a "ЧАСТИЧНИ ПЛАЩАНИЯ" department under Н-18 чл. 26а for deposits and part payments? Does "Продажба кредит" close with "резерв 2"?
- **7.** Can an outside system start a storno, full or partial, of a sale paid online? How does Zamboo document a refund to a card without cash in the drawer?
- **9.** Does the myPOS partnership include online payments tied to Zamboo receipts?
- **41.** How does a tip paid by card in the app go into Zamboo: as a line, as part of the card payment, or not at all? How does it show on the fiscal receipt and in the day's report? (Tips are in the pilot: Martin 10-21.)

## Dropped

- **32** (does a ticket print per table or per item): Martin, 10-21: the whole sent order prints at the table's bar.
- **34** (can the API user be blocked from the terminal): Martin, 10-21: club management, not a technical matter.

## To the pilot venue, still open

- Which Mistral product and version do you run? Which software manages your sales, and did you file Приложение 32?
- How many bars do you have, which tables belong to which, and how do the bars log in? Which virtual tables do you use today, and could Restro have its own few per bar?
- A photo of a bar ticket.
- How often do guests pay their own part, and how often is one bill paid with two or more cards?
- Which card acquirer or payment provider does the venue use today? Would it open its own account with the online payment provider Restro uses (the venue is the merchant, D98)?
- The opening, last-orders and closing times per weekday, and the closed nights (as defaults for the settings).
