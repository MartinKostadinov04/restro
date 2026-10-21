# Pilot law: working answers on sales software, tips, privacy and payment terms

Made by: Opus research agent for #52, 10-21. For: the ordering lead and Martin.

Builds on `2026-10-21-receipt-and-payment-law.md` (the receipt file), `2026-10-17-fiscal-rules-in-app-payments.md` (L1–L12), `2026-10-20-location-check-law-deep-research.md` (the location file) and `2026-10-18-records-and-bill-closing.md`. It does not repeat them.

**Marks.** **[TEXT]** = settled by the text. **[READING]** = our reading. **[LAWYER]** / **[ACCOUNTANT]** = interpretation only. **[UNKNOWN]** = not found.

**Texts read on 10-21** (lex.bg consolidations, whole text searched): Н-18 to ДВ 42/2025; ЗДДС to ДВ 69/2026; ЗЗП to ДВ 58/2026 (incl. ДВ 87/2026 changes in force 24–27.09.2026); ЗДДФЛ to ДВ 54/2025; КСО to ДВ 68/2026; ЗЕТ to ДВ 55/2026; the КЗЛД DPIA list (2019); the NRA's 2025 letter on tips; Stripe's DPA (28.09.2026). EUR-Lex refused automated access on 10-21, so the EU articles below are cited from the Official Journal without a fresh read; the lawyer should check the wording.

## Summary

Restro probably is "sales software" in the legal sense (ЗДДС § 1, т. 84), but listing is voluntary, so Restro has no duty. The risk is the venue's: on a listed POS it may use no unlisted module to manage sales (fine BGN 5,000–10,000, sealing up to 30 days). Restro is safe only as a module Mistral authorises in writing, with every round, line move and payment recorded in Mistral. That authorisation becomes a pilot gate. A card tip is the venue's income, outside VAT if voluntary, and goes on the same fiscal receipt in group А, department "БАКШИШ". Passed to staff, it is taxed and insured as pay. The venue is the controller, Restro its processor (joint controller for the location check), and Stripe a controller for its own purposes. Extend the DPIA to payments; write the DPA, the notice, and an export before erasure. A guest ordering at the table is very probably not under a distance contract: no withdrawal right, and the general duty of ЗЗП чл. 4 applies. The venue, as trader, shows its legal identity, the final price and an optional tip, in Bulgarian.

## 1. Q63: is Restro "sales software", and what follows

**The definition.** [TEXT] Sales software is "всеки софтуер или модул от софтуер … използван за обработка на информация за извършване на продажби … в търговски обект, за които е налице задължение за издаване на фискален бон" (ЗДДС § 1, т. 84). [READING] Restro writes rounds, moves lines to payment tables and closes bills, so it processes sale information. It fits, as a module.

**What that alone triggers for Restro: nothing.**
- [TEXT] A producer "може да декларира" its software to the NRA (ЗДДС чл. 118, ал. 14). Listing is a choice, and no text puts a duty on an unlisted producer.
- [TEXT] The only producer sanction is for false data in a declaration (чл. 185а: BGN 5,000–10,000 for a company).

**What it triggers for the venue.**
- [TEXT] A venue that chose listed software "е длъжно да ползва само този софтуер" (ЗДДС чл. 118, ал. 18).
- [TEXT] Penalty if that venue "за управление на продажбите … използва друг софтуер/модул от софтуер, невключен в списъка": BGN 5,000–10,000 for a company (≈ €2,556–5,113), double if repeated (чл. 185б). Sealing for up to 30 days (чл. 186, ал. 1, т. 5).
- [TEXT] But the ordinance opens a door. With the producer's authorisation the venue may "добавят външни модули" (Н-18 чл. 52з, ал. 5). It may also import sales "от други източници и софтуери" under Annex 42 (чл. 52з, ал. 10):
  - in full and unchanged;
  - with the УНП generated at import or at confirmation;
  - with the source (ЕИК and name), the external id and the method ("API") stored;
  - with refused requests kept;
  - and, for a change to an unclosed sale, traceability before and after (Прил. 42, т. 2.1–2.5).
- [TEXT] In listed software, entering a payment makes the software itself command the fiscal device to print a receipt carrying the УНП (Прил. 29, т. 10).
- [TEXT] "Управление на продажби" means tracking a sale from the order to payment. Data kept "единствено" for later tax documents or accounting registers is excluded (Н-18 § 1, т. 19).

**Working answer.** [READING] Two readings meet here:
- **Safe reading.** Restro is an authorised external module and import source. Mistral still "manages" every sale: each round, line move and payment is entered in Mistral, gets its УНП there, and Mistral alone commands the fiscal device (`payAndClose` goes through Mistral's API, never to the device).
- **Risky reading.** Restro keeps its own orders and payments to track sales from order to payment (D111). Its purposes (retry, dispute evidence) are not on § 1, т. 19's exclusion list. So Restro "manages sales" itself, as an unlisted module.

The texts on authorised modules and imports favour the safe reading, but only if Mistral authorises Restro in writing. [LAWYER] which reading holds.

**If Restro chose to be listed** [TEXT]: a declaration with software data, manual and SaaS description (Н-18 чл. 52в, ал. 1–2; Прил. 30, 31); a new one within 7 days for every relevant version (ал. 3, 3а); full Annex 29 compliance: the УНП, a live link to the fiscal device, operator records, an audit log, an "auditor profile", **no test or training mode** (т. 1–20); NRA expert reviews and delisting (чл. 52е, 52е1). [READING] That is a full POS's burden, against the three layers. Not recommended.

**If Mistral is not listed:** ал. 18 and чл. 185б do not bite, and Restro needs nothing. But there is then no electronic receipt (ЗДДС чл. 118, ал. 21, т. 2; the receipt file).

**May change D122 §8 (and the pilot gate):** before the first live write, require:
1. Mistral's written authorisation of Restro as an external module (чл. 52з, ал. 5);
2. Mistral's confirmation that its API stores Restro's rounds and line moves as Annex 42 imports (source = Restro's ЕИК, method API);
3. the link declared in the venue's Прил. 32 (т. 17).

Recommendation: also ask the NRA for a written opinion on the safe reading. The NRA answers such questions in writing (ЗНАП чл. 10, ал. 1, т. 10), as its tips letter shows.

**Side finding, may change D122 §8 "Later":** [TEXT] listed software may have no training mode (Прил. 29, т. 20). Testing in a live venue needs the NRA notified the day before, a closed room and no printed documents (Н-18 чл. 52з, ал. 4). [READING] "The first write at a POS with no training mode" is therefore the normal case for Mistral. Tests belong on a separate Mistral instance, as rule 7 already says.

## 2. Tips paid by card in the app (Q10)

**Source.** The NRA Central Office's letter to its appeals directorate, signed by deputy director V. Petkova in 2025, reported as № ВК-30-14766/23.10.2025. It answers almost exactly our case: tips paid at a POS terminal into the venue's bank account, then handed to waiters. It is marked "Ограничено ползване – TLP-AMBER" and was found only in a copy republished by accountingnews.bg, not on nra.bg. It binds NRA practice, not courts. [TEXT] for what the letter says.

**Who owns the tip.** The venue.
- [TEXT] The tip "по своята същност" is extra pay from the employer, since the result of hired labour falls "пряко в патримониума на работодателя" (letter, p. 7).
- [READING] With direct charges on the venue's own Stripe account, the money lands with the venue, as in the letter. Restro never touches it (D98). Restro should not promise "100% goes to your waiter": distribution is the venue's decision (letter, p. 7).

**VAT.**
- [TEXT] A tip "доброволно … в размер, определен съобразно виждането на съответния клиент", and not set by the venue as due, is not part of the consideration and carries no VAT (letter, pp. 4–5; ЗДДС чл. 26, ал. 2; CJEU C-404/99 paras 39, 43).
- [TEXT] A service charge the venue adds to the bill is part of the price and carries VAT (same).
- [TEXT] Separately, the trader needs "изричното … съгласие" for any extra payment. If it presumed consent from a default the consumer did not reject, the consumer can claim the money back (ЗЗП чл. 62д, ал. 1–2).
- [READING] So the tip must start at zero, never pre-selected. Preset buttons (5% / 10% / custom) are fine if none is chosen by default.

**On the fiscal receipt.** It goes on the receipt, not outside it.
- [TEXT] A tip given before the receipt is issued "следва да се отрази във фискалния бон", in tax group "А" (no VAT). The letter recommends a department named "БАКШИШ" with the article "бакшиш". A separate receipt for the tip alone is also allowed (letter, p. 9).
- [TEXT] A tip after the receipt needs a second receipt. A daily summary receipt is tolerated only where the guest has gone (p. 10).
- [READING] In D122's flow the guest picks the tip before step 2, so it belongs on the same receipt as the lines. The receipt's card total then equals the capture.

**Income tax and social security for staff.**
- [TEXT] Employment income, not exempt under ЗДДФЛ чл. 24, ал. 2. Taxed at 10%, withheld by the employer monthly and yearly (ЗДДФЛ чл. 24, ал. 1, чл. 42, 49; letter, pp. 7–8).
- [TEXT] It is insurable income under КСО чл. 6, ал. 2, so contributions are due to all state social security funds, plus supplementary pension (КСО чл. 157, ал. 6) and health insurance (ЗЗО чл. 40) (letter, pp. 10–11).
- [TEXT] The payment method changes nothing (p. 11).
- [TEXT] For corporate tax, the venue books the tip as revenue and the payout as a deductible pay expense (p. 6).

**May change D122 §8.**
- `payAndClose` adds a tip line in Mistral, in group А, department "БАКШИШ", on the same receipt. This is a new connector capability and a Mistral question.
- The last check (exactly the confirmed lines) must expect that one tip line.
- The capture equals the lines plus the tip.
- The tip amount goes into the dispute evidence. A refund includes the tip's storno.
- No default tip.
- If Mistral cannot add the line, a second receipt for the tip alone, at the same moment.

## 3. Privacy (Q67, T31)

**Roles.**
- [READING, from the location file §5] The venue is the controller of guest orders, bills and payments: its customers, its sales. Restro is its processor (GDPR Art. 28). Restro and the venue are joint controllers of the location check (Art. 26). Restro alone controls its platform security (table-code limits, Turnstile).
- [TEXT] Stripe acts as processor for some services and as "sole" controller for its own purposes: choosing banks and payment methods, fraud, AML/KYC and product development (Stripe DPA §2). [READING] Toward the guest, Stripe is an independent controller of the card data. The venue's contract with Stripe is the venue's own. Restro, reading the venue's Stripe account through its platform key, does so as the venue's processor.
- [READING] Mistral is the venue's own processor, not Restro's sub-processor. Cloudflare, hosting, Sentry and Telegram are Restro's sub-processors. Cloudflare is also an independent controller for Turnstile (location file §4).
- [LAWYER] The 18-month dispute evidence and the 31-day Log serve the venue (disputes) and Restro (operating its service). If Restro uses either for its own purposes, it becomes a controller for that use (EDPB Guidelines 07/2020, paras 81–82).

**DPIA.**
- [TEXT] The КЗЛД list (2019) has eight items: biometrics, genetics, location "for profiling purposes" with legal effects, and others. Payments are not on it.
- [READING] So a DPIA is not mandatory by the list. But WP248's criteria now include location data, financial data (criterion 4) and denying a feature on refusal (criterion 9), and two criteria mean a DPIA "in most cases".
- Recommendation: extend the one short DPIA from the location file to cover payments (card tokens, payment records, dispute evidence). [LAWYER] the "not high risk" finding (location file Q5).

**The venue agreement (DPA) must contain** [TEXT, GDPR Art. 28(3)]: subject, duration, nature, purpose, data types and data subjects (guests and the venue's staff accounts); processing only on documented instructions; confidentiality and Art. 32 security; sub-processors (general authorisation, list, notice of changes, right to object, duties passed down); help with data-subject requests, breaches and DPIAs; deletion or return at the end; audits. The Commission's clauses (Decision 2021/915) can be the base. Add:
- the Art. 26 arrangement for the location check;
- the venue's instruction that Restro writes rounds and payments to its POS and captures on its payment account as a waiter would (rule 7, D110);
- US transfers (Cloudflare, under the EU-US Data Privacy Framework);
- the retention table below, with an export to the venue before erasure.

**The guest privacy notice** [TEXT, GDPR Art. 13; Art. 26(2)]:
- who: the venue (legal name, address, contact) as controller; Restro as its processor and as joint controller for the location check, with the essence of that arrangement and one contact point;
- purposes and legal bases: the order and payment (contract, Art. 6(1)(b)); the receipt and an optional email (legal obligation, 6(1)(c)); dispute evidence and fraud prevention (legitimate interest, 6(1)(f), with the interest named); the location check (consent);
- recipients: the POS provider, the payment provider (link its own notice), Cloudflare, hosting; US transfers and their safeguard;
- each retention period;
- the rights, withdrawal of consent, and a complaint to КЗЛД;
- no automated decisions with legal effect.

Plus the Turnstile and storage points from the location file, items 5 and 9.

**Retention.**
- [TEXT] The venue's own records sit elsewhere:
  - the fiscal device's memory and reports, 5 years (Н-18 чл. 42, ал. 7);
  - registers, 10 years (ЗСч чл. 12);
  - tax documents, until 5 years after limitation (ЗДДС чл. 121; ДОПК чл. 38);
  - the fiscal receipt is the sale's accounting document (ЗСч чл. 7, ал. 2).
  
  See the records file.
- [READING] Restro's payment record is no accounting document. 18 months plus disputes rests on GDPR Art. 5(1)(e) and Art. 17(3)(e) (legal claims), not on accounting law, and conflicts with none of it.
- [TEXT] One catch. A venue on listed software keeps "информацията, създавана чрез тези софтуери (модули …)" that its POS exchanges with, for the ДОПК чл. 38 periods (Н-18 чл. 52к, ал. 3). [LAWYER] whether that covers Restro's records and Log.
- **May change D111 / D122 §8:** before erasing a venue's orders, payments or Log, offer the venue an export, and state this in the DPA.
- The optional receipt email: keep it only until delivery is confirmed, never in the 18-month record.
- 31 days for the Log is fine under GDPR. No text sets a minimum.

**T31 status.** Not done. It needs four drafts: the DPA with the Art. 26 annex, the notice, the DPIA, and Restro's Art. 30 records. Recommendation: date them before the first live payment, and send them with the lawyer's questions in one batch.

## 4. The guest's payment terms

**Is it a distance contract?** Very probably not.
- [TEXT] A distance contract needs no "едновременното физическо присъствие на търговеца и потребителя" and "изключителното използване" of distance means up to conclusion (ЗЗП чл. 45; CRD Art. 2(7)). CRD recital 20 adds that a contract negotiated on the trader's premises is not a distance contract.
- [READING] The guest and the venue's staff are in the same room. The order is served at the table. The same answer runs through ЗДДС § 1, т. 96 (the receipt file §2).
- [LAWYER] one merged question with the allergen point (Reg. 1169/2011 Art. 2(2)(u)).

**So, which duties.**
- [TEXT] For a contract that is neither distance nor off-premises, the trader gives before the consumer is bound, "освен ако тя е ясна от контекста" (ЗЗП чл. 4, ал. 1):
  - the main characteristics;
  - its name, seat, address, phone and email;
  - the final price including all taxes;
  - payment terms and complaint handling.
- [TEXT] Written information must be in Bulgarian (ЗЗП чл. 5, ал. 1). English may be added.
- [TEXT] There is no withdrawal right outside distance and off-premises contracts. Even for a distance contract, food and drink fall under exceptions: goods that spoil quickly (чл. 57, т. 4), catering on a set date (т. 12), a service fully performed (т. 1). In that case the trader must say there is no withdrawal right (чл. 47, ал. 1, т. 11).
- [TEXT] The distance-only "button" rule (чл. 49, ал. 2) does not apply. [READING] Follow it anyway: a pay button that reads "Pay €X" / "Плати X €" is unambiguous and costs nothing.
- [TEXT] A trader's card surcharge may not exceed its cost (ЗЗП чл. 62в). [READING] Charge none.

**Who gives it.** The venue.
- [TEXT] "Търговец" includes "всяко лице, което действа от негово име и за негова сметка" (ЗЗП § 13, т. 2). [READING] Restro's screens speak for the venue, so the information must be the venue's: its legal entity, not only its brand.
- [READING] Restro also runs an information-society service: one "normally" paid, here by the venue (ЗЕТ чл. 1, ал. 3). So Restro shows its own identity under ЗЕТ чл. 4 in a footer ("Ordering by Restro" plus its details).
- [READING] ЗЕТ чл. 8 and 10 apply to consumer contracts "чрез електронни средства": state the steps, let the guest correct input before sending, and confirm receipt of the order. D72 (no local success) already confirms. [LAWYER] whether an in-venue service counts as "from a distance" at all.

**P2B, DSA, PSD2.**
- [READING] **P2B** (Reg. 2019/1150, Art. 2(2)) covers services that let businesses offer goods to consumers to facilitate direct transactions. Restro is one venue's own channel, with no marketplace. Arguably it is a tool, not intermediation. [LAWYER] If P2B applies, the venue terms need P2B's clarity, 15-day change notice and reasons for suspension. Cheap to write that way now.
- [READING] **DSA** (Reg. 2022/2065): Restro hosts the venues' menus, so it is at least a hosting service, which brings points of contact, terms, and notice and action (Arts. 11–12, 14, 16–17). As a micro or small enterprise, it is exempt from the online-platform and marketplace sections (Arts. 19, 29). [LAWYER] whether it is an "online platform" at all.
- [TEXT] **PSD2** (Dir. 2015/2366): payment-transaction information duties fall on the provider toward its own user (Arts. 44–49), and that user is the venue. The guest's terms with its card issuer are the issuer's. Technical service providers that never come "into possession of the funds" are excluded (Art. 3(j)). [READING] Restro fits, as D98 requires. [LAWYER] whether a Connect platform key that can create, capture and cancel payments on the venue's account keeps Restro within Art. 3(j).

**May change D122 §8: what the payment screen shows,** in Bulgarian (English optional):
1. the venue's legal name, ЕИК, address and contact. This is new: venue settings need these fields;
2. the lines, quantities and prices with VAT, and the total in euro;
3. an optional tip, default none, "goes to [venue]";
4. "Payment processed by [provider] for [venue]. Restro does not receive your money.";
5. the receipt: the venue's fiscal receipt on paper at the table, or by email where offered;
6. complaints and refunds: the venue, with its contact;
7. no withdrawal right for food and drink served;
8. a privacy link;
9. the button "Pay X €".

## For the lawyer and accountant

One list, merged with the receipt file, L1–L12 and the location file. Pilot-critical items come first. Each is the interpretation only.

**Lawyer: fiscal and sales software (pilot)**
1. (Q63 + L11a/b) With Mistral listed and chosen, does Restro "manage sales" (Н-18 § 1, т. 19), exposing the venue to ЗДДС чл. 185б/186, or is it an authorised module and Annex 42 source (чл. 52з, ал. 5, 10)?
2. (L2) Is an app card payment at the table not "неприсъствено", so the venue's device must issue the receipt at payment (чл. 25, ал. 6)?
3. (L7) Is a card hold not yet "receipt of payment", so the receipt is issued at capture and none at release?
4. (L3) Can an anonymous web session be the guest's "профил" for an electronic receipt (чл. 52з, ал. 17)?
5. (Receipt Q1) May the device's electronic receipt be emailed through Restro's web app on the venue's behalf, with paper only on request?
6. (Receipt Q2) Does a paper receipt printed at the bar but not collected, plus a PDF copy, meet чл. 25, ал. 6?
7. (L9) Is the app's bill screen with a Pay button a "document" under чл. 7а / чл. 26, ал. 6 and Annex 39?
8. (L10) May a fiscal device (not an ИАСУТД) storno a refund to card, and when; is a storno due on a pre-settlement reversal?
9. (L1) Does the чл. 3, ал. 1 exception cover any card payment through a payment provider, or only cash transfers?
10. (New) Does Н-18 чл. 52к, ал. 3 oblige the venue to keep Restro's order and payment records and Log for the ДОПК чл. 38 periods?
11. (L12) Is an Н-18 amendment under ЗДДС чл. 118, ал. 4, т. 10 published or pending that would affect Restro?

**Lawyer: tips, consumer, payments (pilot)**
12. (New) May the venue rely on the NRA's 2025 tips letter (TLP-AMBER, not on nra.bg) for in-app card tips on the same receipt, group А, "БАКШИШ"?
13. (Receipt Q3 + new) Is ordering and paying through the QR page at the table a distance contract (ЗЗП чл. 45) or "distance communication" (Reg. 1169/2011 Art. 14(2))?
14. (New) Is Restro's guest page an information-society service "from a distance" (ЗЕТ чл. 1, ал. 3), so ЗЕТ чл. 4, 8 and 10 apply to Restro?
15. (New) Is Restro an online intermediation service (P2B Art. 2(2)) or an online platform (DSA Art. 3(i)), or only a hosting tool for one venue's channel?
16. (New) Does a Stripe Connect platform key that creates, captures and cancels payments keep Restro within PSD2 Art. 3(j)?

**Lawyer: privacy (pilot)**
17. (New) Are the 18-month dispute evidence and the 31-day Log processed for the venue (processor) or for Restro's own purposes (controller)?
18. (Location Q4) Is the location check joint control under Art. 26, or Restro's own fraud prevention as an independent controller?
19. (Location Q5) Does the DPIA's "not high risk" finding hold, now that payments are added, so no Art. 36 consultation is needed?
20. (Location Q1) Is an unstored location read at each send to the bill "strictly necessary" under ЗЕТ чл. 4а(4)(2)?
21. (Location Q2) Would КЗЛД accept paying first or a waiter as an equivalent alternative in a loud club?
22. (Location Q3) Does Cloudflare's reuse of Turnstile signals, as a controller, take Turnstile outside the exemption?

**Lawyer: after the pilot**
23. (L4) Is a table deposit paid online from home "неприсъствено", and is the ЧАСТИЧНИ ПЛАЩАНИЯ route right?
24. (L5) Is a "pay by bank" payment through a provider a credit transfer exempt from the receipt?
25. (L6) Is a forfeited deposit compensation outside VAT (C-277/05), and which document corrects the VAT?
26. (L8) Is a paid song request the venue's service at 20%, with one receipt per backer?

**Accountant**
27. (Receipt Q4) May Mistral hold a "Card online" type counted as card on the device, and how is it reconciled with provider payouts?
28. (New, Q10) How should the venue pass in-app tips through payroll, and book the provider's fee on the tip part?
29. (L11c) Does Restro's fee, paid by the venue by card, need a fiscal receipt?

29 questions in all: 26 for the lawyer, 3 for the accountant. Seven are new; L11 and receipt Q3 are merged into new lines. The Mistral questions (listing, electronic receipts, two card types, authorisation) stay on the Mistral list, plus a new one: can the API add a tip line in group А, department "БАКШИШ"?

## Sources

- Н-18: https://lex.bg/bg/laws/ldoc/2135540645 (чл. 25, 42, 52а–52л, § 1, т. 19, прил. 29, 42)
- ЗДДС: https://lex.bg/laws/ldoc/2135533201 (чл. 26, 118, 185а, 185б, 186, § 1, т. 84–87, 96)
- ЗЗП: https://lex.bg/laws/ldoc/2135513678 (чл. 4, 5, 45–49, 57, 62в, 62д, § 13)
- ЗДДФЛ: https://lex.bg/laws/ldoc/2135538631 (чл. 24, 42, 49)
- КСО: https://lex.bg/laws/ldoc/1597824512 (чл. 6, 157)
- ЗЕТ: https://lex.bg/laws/ldoc/2135530547 (чл. 1, 4, 8, 10, 12)
- NRA letter on tips, 2025 (reported № ВК-30-14766/23.10.2025), as republished: https://accountingnews.bg/userfiles/ВК-30-14766+от+23_10_2025+г.pdf
- КЗЛД DPIA list, 2019: https://www.edpb.europa.eu/system/files_en?file=decisions%2Fbg_list_dpia_operations_bulgaria_final.pdf
- GDPR: https://eur-lex.europa.eu/eli/reg/2016/679/oj (Arts. 5, 6, 13, 17, 26, 28, 30, 32–36)
- Commission SCCs controller–processor, Decision 2021/915: https://eur-lex.europa.eu/eli/dec_impl/2021/915/oj
- EDPB Guidelines 07/2020: https://www.edpb.europa.eu/system/files/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf
- WP248 rev.01: https://ec.europa.eu/newsroom/article29/redirection/document/47711
- Consumer Rights Directive 2011/83/EU: https://eur-lex.europa.eu/eli/dir/2011/83/oj (Art. 2(7), recital 20)
- PSD2, Dir. 2015/2366: https://eur-lex.europa.eu/eli/dir/2015/2366/oj (Arts. 3(j), 44–49)
- P2B, Reg. 2019/1150: https://eur-lex.europa.eu/eli/reg/2019/1150/oj
- DSA, Reg. 2022/2065: https://eur-lex.europa.eu/eli/reg/2022/2065/oj (Arts. 3, 11–19, 29)
- CJEU C-404/99, Commission v France (service charges): https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:61999CJ0404
- Stripe DPA, updated 28.09.2026 [vendor]: https://stripe.com/legal/dpa
