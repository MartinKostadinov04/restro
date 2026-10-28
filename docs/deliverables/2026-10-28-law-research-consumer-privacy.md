# Law research: allergens, consumer information and privacy (10 lawyer questions)

Made by: legal research agent (Opus), 10-28. For: the lead and Martin.

> **Not legal advice.** This is research for Martin, built so that only true interpretation goes to a lawyer. Every **[READING]** is our reasoning, not a fact.

**What this file does.** It takes the 10 pilot questions in this batch from the lawyer list in `2026-10-26-pilot-law-working-answers.md`: questions 1–4 there, and question 7, which points to questions 17–22 in `2026-10-21-pilot-law-working-answers.md`. It builds on those two files, `2026-10-21-receipt-and-payment-law.md` §4, `2026-10-20-location-check-law-deep-research.md`, `2026-10-19-location-check-eprivacy.md`, and D11, D42, D118, D119, D121, D125 and D127. It does not repeat what they settled.

**Marks.**
- **[TEXT]**: the rule itself, with its article and link.
- **[PRACTICE]**: official guidance, an authority's decision or a court ruling.
- **[READING]**: our reasoning.
- **[UNKNOWN]**: looked for and not found.

**Read on 2026-10-28** unless marked. The lex.bg texts were downloaded whole and searched. The EUR-Lex texts were read in the browser. Secondary sources (news, search results) were used only to find primary texts, and are marked where they appear.

## Summary

| # | Question | Answer | How sure | Lawyer? |
|---|---|---|---|---|
| 1 | Allergens on drinks | Drinks are "food" in law, and since 27.07.2025 no Bulgarian text lets a venue give allergens "on request". Drinks made in the venue need written allergen information. Putting it in the menu, the phone menu included, meets every reading. | High that "on request" is gone; medium on the channel | n |
| 2 | The phone menu as "the menu" | Where guests choose and order on the phone, show the allergens there. A paper menu at the table may meet the bare letter, but the safe reading, and the one the pilot already follows (V10), is allergens on the phone menu. | Medium | n |
| 3 | The legal entity before payment | Not needed on the pay screen. The law asks for the trader's identity "unless apparent from the context", and the Tourism Act already makes the venue post its company name and address at the entrance. A link to the full details is enough. | Medium-high | n |
| 4 | Restro's role toward Stripe | Processor for the venue. Stripe's word "controller" is a contract label in the venue's own Stripe terms; the GDPR goes by the facts, and Restro's access to the account exists on the venue's instruction. | Medium-high | n |
| 17 | Dispute evidence and the Log | Processor for both, as long as the venue agreement lists them as the venue's instructions. Restro is a controller only for its own uses, which should be named and kept apart. | Medium-high | n |
| 18 | The location check: joint or independent control | Joint control. The CJEU's tests (own purpose, converging decisions, settings chosen by the venue) all point there. Either way the paperwork is nearly the same. | Medium-high | n |
| 19 | DPIA still "not high risk" with payments | Yes. A DPIA is due, but with Restro's measures the remaining risk is not high, so no prior consultation of КЗЛД (Art. 36). | Medium-high | n |
| 20 | An unstored location read and "strictly necessary" | Still unsettled, and it no longer matters: D119 builds on consent, which meets both the Directive and ЗЕТ чл. 4а. | High that consent is compliant; low on the exemption | n |
| 21 | Paying first or a waiter as an equivalent alternative | Very probably yes. EDPB guidance accepts an equivalent service by the same controller, and the CJEU accepted one even for a fee. Here it costs nothing. | Medium-high | n |
| 22 | Turnstile's signal reuse | Under the strictest regulator's test (the CNIL, 29.04.2026), yes: a CAPTCHA provider that reuses data for its own account needs consent, and Cloudflare says it does. No authority has ruled on Turnstile. | Medium | y, only if Turnstile stays as is |

**Net result:** 9 of the 10 questions need no lawyer. The texts, guidance and case law settle them, or the product already sidesteps the open point. One question stays open (22), and only if Restro keeps Turnstile in its current form.

## 1. Allergens on drinks

**Answer.** Drinks are food in law, and the 2025 change removed the only text that allowed allergens "on request". Drinks prepared in the venue (cocktails, draft beer, wine by the glass) need their allergens in writing. Showing them in the menu, the phone menu included, satisfies every reading.

**Legal basis.**
- [TEXT] "‘Food’ includes drink" (Reg. 178/2002, Art. 2). Reg. 1169/2011 takes that definition (Art. 2(1)(a)), and the Bulgarian ordinance takes Reg. 1169/2011's definitions (ПМС 97/2021, § 1, ал. 2). So "храни" in the ordinance includes drinks.
- [TEXT] Allergen information is mandatory for all non-prepacked food (Reg. 1169/2011, Art. 44(1)(a)). Member states may set only "the means" by which it is given (Art. 44(2)).
- [TEXT] The alcohol exemption covers only the ingredients list and the nutrition declaration (Art. 16(4): points (b) and (l) of Art. 9(1)). It does not cover allergens (point (c)).
- [TEXT] ПМС 97/2021 чл. 5, ал. 1 requires the allergens for all food sold without prepacking. Чл. 6 then says how, "при спазване изискванията на чл. 13, параграф 1" of the Regulation:
  1. "в близост до храната – на мястото на предлагането и в обекти за търговия на дребно";
  2. on receipt, for food prepacked for direct sale and for delivery;
  3. "чрез посочване в менюто за предлаганите ястия – за храни, които се консумират в заведения за обществено хранене".
- [TEXT] Point 3 used to read "при поискване на клиента". ПМС № 31 of 22.04.2025 replaced those words (§ 7; ДВ 35/2025; in force 27.07.2025). The ПМС is the one adopting the jam ordinance. The amendment sat in its final provisions.
- [PRACTICE] Without a national measure on the means, the Regulation's prepacked rules apply. Information must be "easily visible, clearly legible … and be provided in a written form. Therefore, it is not possible to provide allergen information only upon request by the consumer." (Commission Notice 2017/C 428/01, para. 31). All means are allowed, "including modern technology tools" (para. 30).
- [TEXT] The draft's reasons (доклад and impact assessment, strategy.bg consultation #10800, 03.01.2025) say only that the change "прецизират[а] изискванията" for non-prepacked food. They don't mention drinks. The draft was not notified under Dir. 2015/1535.

**Reasoning.** [READING]
- **Reading A (broad).** Point 3's scope is "храни, които се консумират в заведения", and "храни" includes drinks. "The menu for the dishes offered" names the channel, not a limit on scope. A drinks list is part of the menu.
- **Reading B (narrow).** "Ястия" means dishes, so point 3 doesn't reach drinks. Drinks then fall under point 1 (written, near the food at the place of offer, such as the bar), or under no national measure at all. In that case, by the Commission's para. 31, the prepacked rules apply: written and easily visible.
- **Either way, "on request" is gone.** No text now allows a venue to tell a guest a drink's allergens only when asked. Only the written channel differs, and the menu works under both readings.
- **Which drinks carry what.** Annex II of Reg. 1169/2011 (read 10-26) gives typical cases:
  - beer: gluten;
  - wine above 10 mg/l: sulphites;
  - cocktails with cream, egg white or nut liqueur: milk, egg or nuts.

  Pure distillates are mostly exempt (cereals, whey and nuts "used for making alcoholic distillates"). A sealed bottle served as sold is prepacked, and its label covers it.

**How sure:** high that "on request" no longer exists for drinks. Medium on the exact channel under Reading B. That doesn't matter for Restro, because the phone menu shows the allergens.

**Lawyer:** no. The remaining point ("ястия") changes nothing Restro or the venue does.

**What it changes.** D42 stays as Martin set it on 10-28: missing allergens are a warning, not a block. The pilot readiness check V10 should say "every item, drinks included" in so many words.

## 2. The phone menu as "the menu"

**Answer.** Where guests choose and order on the phone, the allergens belong on the phone menu. A compliant paper menu on the table may satisfy the bare letter, but nothing in the law confirms that. The pilot already removes the question (V10: every item has allergens or "none").

**Legal basis.**
- [TEXT] Allergens are given "чрез посочване в менюто" (ПМС 97/2021, чл. 6, т. 3), subject to Art. 13(1) of Reg. 1169/2011:
  - "marked in a conspicuous place in such a way as to be easily visible";
  - and never "hidden, obscured, detracted from or interrupted by any other written or pictorial matter".
- [TEXT] The responsible operator is the one under whose name the food is sold, and it must "ensure the presence and accuracy" of the information (Art. 8(1)–(2)). That is the venue.
- [PRACTICE] Means may include "modern technology tools" (Commission Notice 2017/C 428/01, para. 30). Information must be written and easily visible (para. 31).
- [PRACTICE] The head of БАБХ told the press that the rules prescribe no particular way of showing allergens in a menu (dnes.bg, 2015, a secondary source). No current БАБХ guidance on menus was found [UNKNOWN].

**Reasoning.** [READING]
- The text says "the menu", not "every menu". A venue whose paper menu at the table shows allergens arguably complies, even if its phone menu doesn't.
- But Art. 13(1) and the Regulation's purpose (an informed choice before buying) are judged where the guest actually chooses. A guest who orders on the phone may never open the paper menu. An inspector would very likely treat the ordering screen as a menu.
- A phone menu without allergens, where food is ordered, is the weak spot. That isn't a lawyer question; the product can close it.

**How sure:** medium on the bare reading. High that showing allergens on the phone is compliant.

**Lawyer:** no. The pilot shows allergens on every item (V10).

**What it could change (for Martin).** For later venues that publish items without allergens (D42 allows that, with a warning), a fallback would close the gap: a venue-level "Алергени" link on the guest page, pointing to the venue's own allergen table. It is a proposal only.

## 3. The legal entity before payment

**Answer.** The company name, ЕИК and address need not be on the pay screen. The trading name is enough there, with the full details one tap away (terms, privacy notice, footer) and on the fiscal receipt.

**Legal basis.**
- [TEXT] The EU rule asks for "the identity of the trader, such as his trading name, the geographical address … and his telephone number", "if that information is not already apparent from the context" (Dir. 2011/83, Art. 5(1)(b)).
- [TEXT] Bulgaria's wording is "името/наименованието на търговеца, седалището и адреса на управление, неговия телефонен номер …", again "освен ако тя е ясна от контекста" (ЗЗП чл. 4, ал. 1, т. 2). The trader bears the burden of proof (ал. 3).
- [TEXT] Bulgaria did not use Art. 5(3)'s option to exempt day-to-day transactions: ЗЗП чл. 4 has no such paragraph.
- [TEXT] **New here: the venue's legal entity is posted at its door by law.** Anyone running "ресторантьорство" in a tourist site must post near the entrance:
  - "а) фирмата, седалището и адреса на управление на търговеца";
  - working hours;
  - the manager's name and phone.

  Source: Закон за туризма чл. 114, т. 3.
- [TEXT] Clubs are such sites. "Заведенията за хранене и развлечения … барове" are tourist sites (чл. 3, ал. 2, т. 2), and the kinds of bar include "дискотека" and "бар-клуб" (чл. 124, ал. 7, т. 6–7).
- [PRACTICE] The Commission's guidance says a restaurant's identity and address "could be considered as 'obvious or apparent from the context'" (2021/C 525/01, §3.1; read 10-26, not re-read).
- [TEXT] Restro's guest page is also an information-society service, and its provider must give "безпрепятствен, пряк и постоянен достъп" to its name, seat, contacts and register entry (ЗЕТ чл. 4, ал. 1). A link that is always visible meets "direct and permanent access"; the text doesn't require them on every screen.

**Reasoning.** [READING]
- The guest is inside the venue, whose company name and address hang by the entrance by law, and print on the fiscal receipt.
- The CRD's own example of "identity" is the trading name.
- So the brand on the pay screen, plus a link to the legal details, meets ЗЗП чл. 4. The Bulgarian "наименование … седалище" wording leans to the company, but the "apparent from the context" clause and the door sign cover it.
- Burden of proof: the venue should keep the door sign compliant. A venue without one would have a weaker case.

**How sure:** medium-high.

**Lawyer:** no.

**What it changes.**
- The 10-26 pay-screen list stands: legal name, ЕИК and address go behind a link.
- Add to pilot readiness: "the Tourism Act sign at the entrance names the company" (the venue confirms).
- Venue settings still need the legal name, ЕИК and address for that link.

## 4. Restro's role toward Stripe

**Answer.** Restro is the venue's processor. Stripe's word "controller" sits in the venue's own Stripe terms. It describes who may instruct Stripe on the account, and it doesn't fix GDPR roles toward the guest.

**Legal basis.**
- [TEXT] Stripe Connected Account Agreement (last modified 18.11.2025), §1: a Connect platform "may conduct Activity on User's behalf and act as a data controller" to instruct Stripe, "according to User's Platform Provider Agreement". §4.1(a): the venue (User) instructs Stripe to share its data with its platforms. https://stripe.com/legal/connect-account
- [TEXT] Stripe Privacy Policy (last updated 28.04.2026): Connect access exists because "a Business User instructs Stripe to provide another Business User with access to its Stripe account". "Business Users are responsible for ensuring that the privacy rights of their End Customers are respected." https://stripe.com/privacy
- [TEXT] Stripe DPA (28.09.2026) §2: Stripe is a processor "on behalf of User, the Data Controller", and sole controller for its own listed purposes. §4.3: the venue gives the notices. The DPA has no Connect clause. Stripe's Services Agreement (28.09.2026) general terms use no controller or processor label.
- [TEXT] A processor that determines purposes and means "shall be considered to be a controller in respect of that processing" (GDPR Art. 28(10)).
- [PRACTICE] EDPB Guidelines 07/2020, paras 28–29: a contract's label can be followed only "if there is no reason to doubt that this accurately reflects the reality", and "the terms of a contract are not decisive in all circumstances". Paras 80–84: a processor acts "on behalf of" the controller, may offer a predefined service and may set non-essential means, but may not pursue its own purposes.
- [PRACTICE] CJEU C-683/21, para. 30: the controller is whoever "exerts influence over the processing … for … its own purposes".

**Reasoning.** [READING]
- Restro's access to the venue's account exists only because the venue instructs Stripe to give it (§4.1(a)). It is used only to take the venue's payments: a restricted key that writes Payment Intents and reads Charges and Disputes (D125, D127).
- The purpose (the venue's sales) and the essential means (which data, who receives it, for how long) are fixed in the venue agreement, which the venue accepts by connecting. That is processing on the venue's behalf.
- Stripe's "data controller" wording, in context, gives the platform authority to instruct Stripe for the user. Toward Stripe, a processor instructing a provider for its controller is a normal set-up.
- **A naming trap.** Stripe's API calls the party that pays fees and bears losses on a connected account its "controller" (the Accounts v2 "controller properties" in D125). That is a Stripe API term, unrelated to the GDPR. The venue agreement and notices should not let the two meanings mix.
- Restro would become a controller if it used Stripe data for its own ends, such as benchmarking venues or marketing. The venue agreement should rule that out (as the 10-26 file proposed).

**How sure:** medium-high.

**Lawyer:** no. The 10-26 drafting points for T31 settle it:
- Restro uses the Stripe connection only on the venue's documented instructions;
- it makes no own use of the data;
- the venue's notice links Stripe's policy.

## 7. Privacy (questions 17–22 of the 10-21 file)

### 17. The dispute evidence and the Log: processor or controller?

**Answer.** Restro is a processor for both, provided the venue agreement names them as the venue's instructions, with their contents and retention. Restro is a controller only for uses of its own. Those should be listed apart and kept to aggregates where possible.

**Legal basis.**
- [TEXT] Art. 28(10), as above. Art. 32 binds "the controller and the processor" alike, so keeping security and operation logs of the venue's processing is part of a processor's own duty.
- [PRACTICE] EDPB 07/2020, paras 81–82: a processor "may not carry out processing for its own purpose(s)"; the same entity may be a controller for some operations and a processor for others.
- [TEXT, internal] D125 3.4: the venue "carries its own disputes"; payments are direct charges on the venue's account. D111, refined by D122: the dispute evidence is kept 18 months from the service day and 6 months past a dispute's close.

**Reasoning.** [READING]
- **Dispute evidence.** The disputes are the venue's: it is the merchant, and it answers them in its Stripe Dashboard. Restro keeps the evidence so that the venue can answer. Restro isn't a party, so it has no claim of its own to defend. Processor.
- **The 31-day Log.** It records what happened in the venue's ordering and payments (retries, money alerts, who pressed Done). It serves the venue's service, and Art. 32 security of that same processing. Processor.
- **Restro's own uses, where it is a controller:**
  - platform-wide security monitoring across venues;
  - the guard-trip counts and alerts to the Restro team (the location file already put these on Restro);
  - product analytics;
  - Restro's billing.

  These need their own basis, likely legitimate interest, and their own lines in Restro's notice and Art. 30 records. Using aggregates without guest data where possible keeps this small.
- **One edge.** If Restro kept the evidence to defend itself in a dispute with a venue, that would be Restro's own purpose. Name it in the agreement, or don't do it.

**How sure:** medium-high.

**Lawyer:** no.

**What it changes (T31).** The venue agreement lists the dispute evidence and the Log as processing on the venue's instructions, with D111's retention and an export before erasure. Restro's controller uses go in a separate clause and in Restro's own Art. 30 record.

### 18. The location check: joint control or Restro alone?

**Answer.** Joint control, as D119 already records. The CJEU's tests all point to it, and the alternative would change little in practice.

**Legal basis.**
- [PRACTICE] CJEU case law:
  - **Wirtschaftsakademie** (C-210/16, para. 39): an operator who sets "parameters" for processing that another runs takes part in determining purposes and means.
  - **Jehovan todistajat** (C-25/17, paras 68–69): influence "for his own purposes" makes a controller, and joint control "does not require each of them to have access to the personal data".
  - **Fashion ID** (C-40/17, paras 74, 76, 78–80): joint control may cover only some operations, such as collection and transmission, where each has a decisive influence and an interest.
  - **C-683/21** (paras 43–45 and ruling 2): converging decisions suffice if each has "a tangible impact", and no formal arrangement is required for joint control to exist.
  - **IAB Europe** (C-604/22, ruling 2): whoever sets the framework rules for others' processing, for its own purposes, is a joint controller without access to the data.
- [PRACTICE] EDPB 07/2020, paras 53–55: "converging decisions" that "complement each other and are necessary for the processing to take place".

**Reasoning.** [READING]
- Restro designed the check, runs it by default and has its own interest: the guard counts, the team alerts, protecting the platform.
- The venue switches it on or off and sets the spot and the radius. Those are decisive parameters, as in Wirtschaftsakademie, and the venue's own interest is fewer fake orders on its bills.
- Neither the check nor its settings can work without the other's decision. That is converging decisions with a tangible impact.
- An "independent controller" reading would need the venue to have no say, but it does.
- If a regulator saw Restro as a sole controller, the joint arrangement would simply over-comply. The notice already names both (D119, D121).

**How sure:** medium-high.

**Lawyer:** no.

**What it changes:** nothing. Draft the Art. 26 annex, as T31 already plans.

### 19. Does the DPIA's "not high risk" finding hold with payments?

**Answer.** Yes. A DPIA should be done: two WP248 criteria are met, so it is the safe course. But after Restro's measures the remaining risk is not high, so no prior consultation of КЗЛД is needed.

**Legal basis.**
- [TEXT] A DPIA is due where processing "is likely to result in a high risk". "A single assessment may address a set of similar processing operations" (GDPR Art. 35(1)).
- [TEXT] Prior consultation is required where the DPIA "indicates that the processing would result in a high risk in the absence of measures taken by the controller to mitigate the risk" (Art. 36(1)).
- [PRACTICE] WP248 rev.01 (endorsed by the EDPB) reads Art. 36(1) with recitals 84 and 94: consultation is needed only where "the residual risks are still high". Where the risks are "sufficiently reduced", the processing "can proceed without consultation".
- [PRACTICE] WP248's criteria count as sensitive both "location data whose collection questions the freedom of movement" and "financial data that might be used for payment fraud". Its criterion 9 covers processing that "prevents data subjects from … using a service". Two criteria mean a DPIA "in most cases".
- [PRACTICE] КЗЛД's list (Art. 35(4)) has eight items. The only location item is location "for profiling purposes" with legal or similarly significant effects. Payments are not on it.

**Reasoning.** [READING]
- **Criteria met.** Location (4), and the refusal of one feature (9). Payment data counts under 4 only weakly: Restro holds no card numbers or device identifiers (D127 4.2). The card data sits with Stripe as its own controller. Large scale is not met at the pilot: one venue.
- **Measures:**
  - no stored coordinates;
  - consent, with withdrawal;
  - alternatives open (pay first, the waiter);
  - no card data at Restro;
  - restricted keys;
  - 31-day and 18-month limits;
  - no profiling or automated decision with legal effect.
- **Residual risk:** low to medium.
- **Who signs.** The venue is the controller for payments, so it carries its own DPIA, with Restro's help under Art. 28(3)(f). Restro co-signs the location part as joint controller. One shared document for all venues fits Art. 35(1)'s "set of similar processing operations".

**How sure:** medium-high.

**Lawyer:** no.

**What it changes:** nothing new. The one short DPIA (T31) covers the location check and payments, and records the residual-risk finding with its reasons.

### 20. Is an unstored location read at each send "strictly necessary" under ЗЕТ чл. 4а(4)(2)?

**Answer.** Still unsettled: no court or authority has ruled on an anti-fraud location check. It doesn't matter for Restro, because D119 builds on consent, and consent meets both the Directive and ЗЕТ чл. 4а.

**Legal basis.**
- [TEXT] ЗЕТ чл. 4а, ал. 1 requires Art. 13 GDPR information and "възможност да откаже". Ал. 4, т. 2 exempts access "необходими за … предоставяне на услуга на информационното общество, изрично поискана". The Bulgarian text omits the Directive's "strictly"; the Directive's wording governs by conforming interpretation.
- [PRACTICE] The EDPB's Guidelines 2/2023 state that they do not analyse the exemptions. No CJEU ruling on the Art. 5(3) exemption for security or fraud was found up to 10-28 [UNKNOWN; search only].
- [PRACTICE] The CNIL's FAQ (29.04.2026), Q16: anti-fraud trackers are "de manière générale" outside the exemptions, except those securing the user's own authentication. The authorities for and against are in the 10-20 location file §1.

**Reasoning.** [READING] The design asks for consent before the first read and lets the guest stop it (D119, D121). That meets ЗЕТ's lighter opt-out wording and the Directive's consent wording. The exemption would only matter if Restro dropped consent, which no decision proposes. The Digital Omnibus may later add a security exemption, but it is not law (10-26 file §4.4).

**How sure:** high that the consent design complies. Low on the exemption itself.

**Lawyer:** no, while consent stays. Ask again only if a future decision drops consent.

### 21. Would КЗЛД accept paying first or a waiter as an equivalent alternative?

**Answer.** Very probably yes. The guest who refuses keeps the menu, the bill and paying. Pay-first items still order from the phone, and the waiter still adds to the same bill at the same prices.

**Legal basis.**
- [TEXT] Art. 7(4) GDPR asks for "utmost account" of whether a service is conditional on consent to processing "not necessary for the performance" of the contract. It is a weighing factor, not a ban.
- [PRACTICE] EDPB Guidelines 05/2020, para. 37: no conditionality where the same controller offers "an equivalent service … that does not involve consenting", as long as the two are "genuinely equivalent". Para. 38: an alternative from a different controller doesn't count.
- [PRACTICE] CJEU C-252/21 Meta, para. 150: users must be offered, "if necessary for an appropriate fee, an equivalent alternative not accompanied by such data processing operations".
- [UNKNOWN] No КЗЛД decision on equivalent alternatives was found.

**Reasoning.** [READING]
- **Same controllers.** The alternative comes from the venue and Restro, the controllers who ask, as para. 38 requires.
- **Same thing.** Same items, same prices, the same bill. Only the route differs: the waiter instead of the phone for on-the-bill items.
- **No fee.** The CJEU accepted an alternative that may cost money. A free, slower route is a smaller difference than a fee.
- **The weak point** is still the waiter's speed in a loud club. EDPB Opinion 08/2024 (written for large platforms) warns that big differences weaken equivalence. The refusal screen should keep naming the alternatives (D121 does).
- The risk is a complaint, not a ruling against a design the guidance supports.

**How sure:** medium-high.

**Lawyer:** no.

### 22. Does Cloudflare's reuse of Turnstile signals take Turnstile outside the exemption?

**Answer.** On the strictest regulator's test, yes. The CNIL says a CAPTCHA needs consent when the provider reuses the data "pour leur propre compte", and Cloudflare's addendum says it is a controller for improving Turnstile. No Bulgarian or EU authority has ruled on Turnstile itself. Since a CAPTCHA that needs consent protects nothing, the real choice is about the product, not a legal opinion.

**Legal basis.**
- [TEXT, vendor] Cloudflare Turnstile Privacy Addendum (last updated 18.06.2025):
  - Turnstile processes IP, TLS fingerprint, User-Agent and site key;
  - Cloudflare is a processor for detecting bots, and "a data controller of Signals that we process to improve Turnstile's bot detection capabilities", on its legitimate interests;
  - the addendum calls the signals "strictly necessary";
  - it offers customers no opt-out from the controller use, and states no retention period.

  https://www.cloudflare.com/turnstile-privacy-policy/
- [PRACTICE] CNIL FAQ on cookies (dated 29.04.2026), Q17:
  - no consent where a CAPTCHA's "seule finalité" is securing the site "au bénéfice des utilisateurs";
  - consent is needed where the operations "poursuivent également d'autres finalités" not strictly necessary;
  - it names providers that "réutiliser les données pour leur propre compte";
  - and it recommends "solutions alternatives" that need no consent, because a refusable CAPTCHA is useless.

  https://www.cnil.fr/fr/questions-reponses-lignes-directrices-modificatives-et-recommandation-cookies-traceurs
- [PRACTICE] CNIL SAN-2023-023 (NS Cards), the reCAPTCHA case, and CJEU Fashion ID (C-40/17, paras 76–80): a site that embeds a third party's script is joint controller for the collection and transmission, though not for the provider's later use. See the 10-20 location file §4.

**Reasoning.** [READING]
- Cloudflare's reuse is for security, not ads, which is the best argument that it differs from reCAPTCHA. But the CNIL's test is "own account" and "other purposes", not "advertising".
- Improving Cloudflare's detection for all its customers is not strictly needed to serve this guest's order.
- Restro, by embedding Turnstile, is joint controller with Cloudflare for the collection (Fashion ID). So the risk is Restro's.
- **Options, all product choices:**
  1. **Run the pilot without Turnstile.** D118 already makes Restro's own server limits the main defence: the cap per round, the pace limit, open tables, the location check. Turnstile was an extra against scripts.
  2. **A check with no outside reuse.** A self-hosted proof-of-work check, for example. That is a new dependency, which needs a ticket.
  3. **Ask Cloudflare in writing** whether its controller use can be switched off by contract. That was already proposed on 10-20; no answer is recorded.
  4. **Keep Turnstile as is** and accept a low-medium risk. КЗП enforces ЗЕТ чл. 4а: BGN 500–2,000, about €256–1,023 (10-20 file §6).

**How sure:** medium that the CNIL's test applies to Turnstile. Low on how КЗП or КЗЛД would decide.

**Lawyer:** only if Restro keeps Turnstile as it is (option 4). Then:
- BG: Изключението по чл. 4а, ал. 4, т. 2 ЗЕТ (чл. 5, пар. 3 от Директива 2002/58) обхваща ли CAPTCHA услуга (Cloudflare Turnstile), когато доставчикът ѝ обработва събраните от устройството сигнали и като самостоятелен администратор, за да подобрява разпознаването на ботове за всички свои клиенти, без възможност този допълнителен ползвател да бъде изключен?
- EN: Does the exemption in ЗЕТ чл. 4а, ал. 4, т. 2 (ePrivacy Art. 5(3)) cover a CAPTCHA service (Cloudflare Turnstile) when its provider also processes the signals read from the device as an independent controller, to improve bot detection for all its customers, with no way to switch that use off?

**Recommendation:** option 1 for the pilot, and option 3 in parallel. Martin decides; it touches D119's "Turnstile runs only at Send".

## What this changes, if Martin agrees

Proposals only; nothing is edited in `docs/decisions/`.

1. **Pilot readiness V10:** say "every item, drinks included" (Q1).
2. **Pilot readiness, new line:** the venue confirms its entrance sign names the company, seat and address (Закон за туризма чл. 114, т. 3) (Q3).
3. **T31 venue agreement:**
   - the dispute evidence and the Log listed as the venue's instructions;
   - Restro's own controller uses in a separate clause;
   - the Stripe clause from the 10-26 file (Q4, Q17).
4. **D119 / Turnstile:** run the pilot without Turnstile, relying on Restro's own limits, and ask Cloudflare whether the controller use can be switched off (Q22).
5. **Later venues:** a venue-level "Алергени" link as a fallback where items lack allergens (Q2). Not needed at the pilot.

## Sources

All read on 2026-10-28 unless marked.

**Bulgarian law**
- Наредба за предоставянето на информация на потребителите за храните (ПМС 97/2021), to ДВ 62/2026: чл. 5, 6, § 1, and the final provisions of ПМС 31/2025. https://lex.bg/laws/ldoc/2137211121
- ПМС 31/2025, draft package on strategy.bg, consultation #10800 (03.01.2025): the draft ПМС (§ 7), the доклад (мотиви) and the partial impact assessment. https://strategy.bg/bg/public-consultations/10800
- ЗЗП, to ДВ 87/2026 (чл. 4). https://lex.bg/laws/ldoc/2135513678
- ЗЕТ, to ДВ 55/2026 (чл. 4, 4а). https://lex.bg/laws/ldoc/2135530547
- Закон за туризма, Ciela free consolidation, last change shown ДВ 87/2026 (чл. 3, ал. 2; чл. 114, т. 3; чл. 124, ал. 7). https://www.ciela.net/svobodna-zona-normativi/view/2135845281/zakon-za-turizma. lex.bg refused the download on 10-28.
- КЗЛД list of operations requiring a DPIA (2019). https://www.edpb.europa.eu/system/files_en?file=decisions%2Fbg_list_dpia_operations_bulgaria_final.pdf

**EU law**
- Reg. 1169/2011, consolidated 01.01.2018 (Art. 2(1)(a), 8, 13, 14, 16(4), 44). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02011R1169-20180101
- Reg. 178/2002, consolidated 01.07.2024 (Art. 2). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02002R0178-20240701
- Dir. 2011/83/EU, consolidated 28.05.2022 (Art. 5(1), (3)). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:02011L0083-20220528
- GDPR (Arts. 7(3)–(4), 28(10), 32, 35(1), 36(1)). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32016R0679

**Official guidance and decisions**
- Commission Notice 2017/C 428/01 on allergen information (paras 28–31). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:52017XC1213(01)
- Commission guidance on Dir. 2011/83, 2021/C 525/01, §3.1. Read 10-26 and cited from the 10-26 file. https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:52021XC1229(04)
- EDPB Guidelines 07/2020 on controller and processor, v2.0 (paras 28–30, 40–41, 53–55, 80–84). https://www.edpb.europa.eu/system/files/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf
- EDPB Guidelines 05/2020 on consent, v1.1 (paras 37–38). https://www.edpb.europa.eu/system/files/documents/files/file1/edpb_guidelines_202005_consent_en.pdf
- WP29 WP248 rev.01, DPIA guidelines (criteria 4 and 9, "two criteria", residual risk and Art. 36). https://ec.europa.eu/newsroom/article29/redirection/document/47711
- CNIL, Q&A on the cookie guidelines, dated 29.04.2026 (Q16, Q17). https://www.cnil.fr/fr/questions-reponses-lignes-directrices-modificatives-et-recommandation-cookies-traceurs
- EDPB Guidelines 2/2023, EDPB Opinion 08/2024, CNIL SAN-2023-023 and EDPB-EDPS Joint Opinion 2/2026: as read in the 10-20 location file. Not re-read.

**Case law (EUR-Lex)**
- C-210/16 Wirtschaftsakademie, 05.06.2018 (paras 35–39). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62016CJ0210
- C-25/17 Jehovan todistajat, 10.07.2018 (paras 68–69, 73). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62017CJ0025
- C-40/17 Fashion ID, 29.07.2019 (paras 74–85). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62017CJ0040
- C-252/21 Meta v Bundeskartellamt, 04.07.2023 (para. 150). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62021CJ0252
- C-683/21 Nacionalinis visuomenės sveikatos centras, 05.12.2023 (paras 30–31, 41–45; ruling 1–2). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62021CJ0683
- C-604/22 IAB Europe, 07.03.2024 (ruling 2). https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62022CJ0604

**Vendor terms**
- Stripe Connected Account Agreement, last modified 18.11.2025 (§1, §4.1). https://stripe.com/legal/connect-account
- Stripe Services Agreement, last modified 28.09.2026 (general terms §4.1). https://stripe.com/legal/ssa
- Stripe DPA, updated 28.09.2026 (§2, §4.3). https://stripe.com/legal/dpa
- Stripe Privacy Policy, last updated 28.04.2026, with a revision announced for 20.11.2026. https://stripe.com/privacy
- Cloudflare Turnstile Privacy Addendum, last updated 18.06.2025. https://www.cloudflare.com/turnstile-privacy-policy/

**Secondary sources, used only to find primary texts**
- dnes.bg, "Написани ли са алергените в менюто? БАБХ проверява" (2015). https://www.dnes.bg/a/58-obshtestvo/253153-napisani-li-sa-alergenite-v-menyuto-babh-proveryava
- bTV, check on allergens in menus (03.04.2024). https://btvnovinite.bg/predavania/tazi-sutrin/proverka-na-btv-spazvat-li-se-iziskvanijata-za-izpisvane-na-alergeni-v-menjutata-v-zavedenijata.html
- Борба, "Заведенията трябва да имат менюта … на храните и напитките" (29.07.2025). It reports menus for food and drinks with allergens, but cites no article; no primary text was found for its claim. https://www.borbabg.com/2025/07/29/zavedeniyata-tryabva-da-imat-menyuta-s-tseni-i-gramazhi-na-hranite-i-napitkite/
