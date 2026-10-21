# The location check and Turnstile under EU and Bulgarian law: working answers
Made by: deep-research agent (Opus), 10-20, for Q83 after ticket #38 (D118) of map #29. Martin 10-20: move on without a lawyer for now; the points marked "for the lawyer" stay on the lawyer list.

## Summary

1. **Exemption for the location check:** it can be argued, but it is not safe to rely on. Keep building on consent, as D118 does. Confidence: medium (low on how Bulgaria would decide). Lawyer: yes.
2. **Validity of the consent:** valid once the line mentions withdrawal and drops "used once". Confidence: high for the fixed version. Lawyer: no.
3. **Refusal blocks on-the-bill ordering only:** allowed, because paying first and the waiter stay open. Confidence: medium-high. Lawyer: yes, one narrow point.
4. **Turnstile:** it can run without consent if it runs only at Send and only against scripted orders. Cloudflare's own reuse of the signals is the weak point. Confidence: medium (low-medium on the reuse). Lawyer: yes.
5. **Roles, DPIA, record:** the location check is joint control (Restro and the venue); Restro processes orders for the venue; write a short DPIA; keep a record of processing. Confidence: medium-high. Lawyer: yes, on joint versus independent control.
6. **Enforcer and sanctions:** КЗП (Commission for Consumer Protection) enforces Art. 4а ЗЕТ. A company faces BGN 500–2,000 (≈ €256–1,023), or BGN 1,000–4,000 if repeated. КЗЛД (the data protection authority) enforces the GDPR in parallel. Confidence: high. Lawyer: no.

## 1. The "strictly necessary" exemption for the location check

**Working answer.** The location read is "access" to the phone, even though the position is dropped at once [GUIDANCE 7 paras 33, 44, 53]. So the only question is the exemption: access "strictly necessary" for a service the user explicitly requested [LAW 5].

In Bulgaria, Art. 4а(4)(2) ЗЕТ exempts access "необходими за … предоставяне на услуга …, изрично поискана от получателя" ("necessary for providing a service explicitly requested by the recipient") [LAW 1]. Para 1 reads as opt-out. But КЗЛД's 2025 guidance reads the rule as prior consent [GUIDANCE 4], and Planet49 requires active consent [CASE 15]. So design to the Directive's standard.

For: WP194 §3.3 covers security "of the service that has been explicitly requested by the user", with login abuse only as an example [GUIDANCE 8]. Germany's DSK counts "user-oriented fraud prevention" as part of the service (Rn. 74) [GUIDANCE 10]. Spain's AEPD exempts fraud control linked to the service's security [GUIDANCE 11].

Against: WP224 §7.4 says a device signal used as an extra access check is not strictly necessary where other methods exist [GUIDANCE 9]. The CNIL says fraud tools are "generally" not exempt (Q16) [GUIDANCE 12]. The EDPB and EDPS say today's rule has no security exemption as such (Joint Opinion 2/2026, fn. 103) [GUIDANCE 13]. The venue benefits most, but necessity is judged from the user's side. No court or Bulgarian authority has ruled [NOT FOUND].

[READING] Arguable, not safe. Consent costs little: the phone asks anyway, and a refusal fails closed. D118 rejected a table PIN and expiring codes, the very "other methods" WP224 names. The DPIA should record why.

**Confidence:** medium. Low on how КЗП or КЗЛД would decide.

**Where the earlier file was wrong.** It read WP194 §3.3 as covering logins only and took the CNIL, the strictest regulator, as the EU norm. It missed WP224 §7.4 and Joint Opinion 2/2026, the real authorities against. "Plan on consent" still stands, but D118's "probably does not fit" should read "arguable, not relied on". One of this round's notes looked for the Bulgarian rule in ЗЕС; it is in ЗЕТ.

**For the lawyer:** question 1.

## 2. Is Restro's line plus the phone's prompt valid consent?

**Working answer.** The structure is right. Restro's line is the consent. The phone's prompt names neither who asks nor why, so it is only the gate [GUIDANCE 14 para 89; 20 §6.2.3]. A tap on a clearly labelled button is a clear affirmative act [GUIDANCE 14 paras 77, 84]. Naming both the venue and Restro fits joint control [GUIDANCE 14 para 65].

Two defects:
- **No word on withdrawal.** Art. 7(3): "Prior to giving consent, the data subject shall be informed thereof" [LAW 6; GUIDANCE 14 para 116].
- **"Used once" is wrong.** Every later on-the-bill order checks again, and wrong information undermines informed consent [CASE 15 para 74; 16 para 40].

Also say what refusing means [CASE 16 para 41], add an equal "Not now", let the guest stop the check inside the page [GUIDANCE 14 para 114], keep proof of consent without coordinates [GUIDANCE 14 para 108], and show the line once per visit even if the browser remembers "allow" [GUIDANCE 21].

Use consent as the GDPR basis for the server check too [GUIDANCE 19 para 41]: one purpose, one tap. One note suggested legitimate interest; consent is cleaner, and a controller cannot "silently migrate" to another basis later [GUIDANCE 14 para 120]. Art. 4а(3) ЗЕТ supports not asking again for later checks [LAW 1].

**Confidence:** high for the fixed version. Medium that today's wording would survive a complaint.

**Where the earlier file was wrong.** It called this a lawyer question; the guidance settles it. Neither file noticed the missing withdrawal information. The indoors file even proposed "used once" as notice content.

**For the lawyer:** none. Who must be named follows from section 5.

## 3. May a refusal block on-the-bill ordering only?

**Working answer.** Yes. Art. 7(4) targets tying a service to data it does not need, such as a cookie wall [GUIDANCE 14 paras 32, 39–41]. Here only the protected feature closes. The menu, the bill, paying and pay-first orders stay open. Two routes reach the same answer:
- If the check is part of on-the-bill ordering, Art. 7(4) "does not apply" [GUIDANCE 14 para 32].
- If it is not, the same controllers offer equivalent alternatives: pay first, or the waiter adds to the same bill. They differ only because the data is not processed [GUIDANCE 14 para 37; CASE 17 para 150; GUIDANCE 18 paras 121–123].

Say this in the line. The weak point: a waiter is slower in a loud club. Opinion 08/2024 warns that bigger differences weaken equivalence. It was written for large platforms, so applying it here is an analogy. D118's refusal screen should also mention paying first.

**Confidence:** medium-high.

**Where the earlier file was wrong.** It found "no guidance on this exact case" and missed the equivalent-alternative test.

**For the lawyer:** question 2.

## 4. Cloudflare Turnstile

**Working answer.** Art. 5(3) applies even without a cookie: Turnstile's script probes the browser and sends the results to Cloudflare [vendor 22; GUIDANCE 7 para 33]. Listings also report an undocumented stored item, `cf.turnstile.u` [ARTICLE 28]. Pre-clearance off removes only the `cf_clearance` cookie [vendor 25].

For Restro's purpose the exemption is likely. The CNIL needs no consent when a CAPTCHA only secures the site "au bénéfice des utilisateurs" ("for the users' benefit") (Q17) [GUIDANCE 12]; WP194 §3.3 and DSK Rn. 74 and 83 agree [GUIDANCE 8, 10]. Pressing Send is the request, and flooded orders would hit real guests' bills.

The weak point: Cloudflare's Turnstile addendum makes it an independent controller for "improving Turnstile's bot detection capabilities" [vendor 23], while its DPA v6.4 says processor only [vendor 24]. The CNIL fined NS Cards €105,000 because reCAPTCHA also served Google's own analysis [CASE 26 para 71]. Cloudflare's reuse is for security, not ads. No authority has ruled on Turnstile [NOT FOUND].

Consent would not help: a CAPTCHA the guest can refuse protects nothing [GUIDANCE 12]. So run Turnstile without consent, keep it minimal and disclosed, and keep Restro's server-side limits as the main defence, as D118 does. All widget modes appear to collect the same signals; invisible mode must be disclosed with the addendum [vendor 25]. Data may go to the US under the EU-US Data Privacy Framework [vendor 29].

**Confidence:** medium on the purpose. Low-medium on the reuse.

**Where the earlier file was wrong.** It implied that switching pre-clearance off narrows the question; the probing is access anyway. It said the answer "rests largely on Cloudflare's own statement", but CNIL Q17 and the NS Cards decision give a regulator's test.

**For the lawyer:** question 3.

## 5. Controller roles, DPIA and record of processing

**Working answer.**
- **Location check: joint control, Restro and the venue,** for collection and comparison only. Restro set the purpose and essential means (which data, no storage, no recipients) [GUIDANCE 30 paras 39–40], runs it on by default and has its own interest (guard counts, team alerts). The venue sets on/off, radius and spot, like the "parameters" in Wirtschaftsakademie [GUIDANCE 30 paras 64–66]. Whoever influences processing for its own purposes is a controller, contract or not [CASE 27 paras 30–31, 43–45].
- **Order data:** Restro is the venue's processor (Art. 28 agreement), and a controller for any reuse of its own [GUIDANCE 30 paras 81–82].
- **Guard-trip counts and alerts:** Restro alone; treat them as personal data.
- **Notice:** Restro's page collects the data, so Restro gives the Art. 13 information and the essence of the Art. 26 arrangement, with a contact point [LAW 6 Art. 26(2); GUIDANCE 30 paras 178–181].
- **DPIA:** КЗЛД's 2019 list covers location only "for profiling purposes" with legal or similarly significant effects [GUIDANCE 32], so it is not mandatory. But WP248 criteria 4 (location data) and 9 (refusing a service) are met, and two criteria mean a DPIA "in most cases" [GUIDANCE 31]. Write one short DPIA for all venues (Art. 35(1) allows that).
- **Record of processing:** yes. Reading and comparing a position is processing even if nothing is stored [LAW 6 Art. 4(2); CASE 27 paras 49–51]. The under-250-employee exemption fails because the processing is "not occasional" [LAW 6 Art. 30(5)]. Restro keeps a controller and a processor record; venues keep their own. A proposed EU easing is unconfirmed [ARTICLE 33].

**Confidence:** medium-high on joint control (high that Restro is at least a controller). High on order data and the record. Medium-high on the DPIA.

**Where the earlier file was wrong.** It said that if the venue sets the purpose, Restro is a processor and the venue gives the notice. Restro's own purpose and the default-on setting rule that out. It also found no КЗЛД list, but one exists.

**For the lawyer:** questions 4 and 5.

## 6. Who enforces Art. 4а ЗЕТ, and the sanctions

**Working answer.** КЗП enforces it. Art. 20(1) ЗЕТ: "Комисията за защита на потребителите упражнява цялостен контрол за спазването на този закон" ("The Commission for Consumer Protection exercises overall control over compliance with this law") [LAW 1]. КЗП officials write the violation report, and КЗП's chair issues the penalty decree (Art. 25). КЗЛД has no role under ЗЕТ but enforces the GDPR in parallel [LAW 3 Art. 10(1)]. ЗЕС has no device-access rule; its location rule (Art. 253) covers telecom operators only [LAW 2].

Sanctions under Art. 24 [LAW 1]:

| Who | First violation | Repeat within a year |
|---|---|---|
| Company or sole trader | BGN 500–2,000 (€255.65–€1,022.58) | BGN 1,000–4,000 (€511.29–€2,045.17) |
| Natural person | BGN 250–1,500 | BGN 500–2,500 |

Ignoring a КЗП order adds BGN 500–2,000 for a company (Art. 24а). The amounts were never rewritten in euro; since 1 January 2026 they are read at 1.95583 [ARTICLE 34], and the euro figures are our arithmetic [READING]. Art. 4а was last amended only by ДВ бр. 17/2019. No public КЗП practice exists [NOT FOUND]. The real exposure is GDPR fines through КЗЛД (Art. 83) [LAW 6].

**Confidence:** high, though lex.bg is a private consolidation. Medium on the euro conversion, which comes only from summaries.

**Where the earlier file was wrong.** The indoors file said the Electronic Communications Act implements ePrivacy and that КЗЛД enforces; both are wrong. The ePrivacy file left the enforcer open and guessed at euro amounts. A vendor's "КЗЛД enforces, up to BGN 5,000" is wrong [ARTICLE, vendor 35].

**For the lawyer:** none.

## What D118's design should change, if anything

These are options for Martin to decide.

1. **Consent line,** proposed text:
   > **Ordering on your table's bill**
   > [Venue] and Restro check that your phone is in the venue, so nobody outside can order onto your table's bill. Each time you send an order to the bill during this visit, we check your phone's location and then discard it. It is never stored.
   > Rather not? You can still pay first or call a waiter. You can stop the check at any time. [Privacy notice]
   > [ Allow location check ] [ Not now ]
2. **In-page withdrawal:** a "Stop location check" control, for example on the bill or in "Why?". Do not ask again after a refusal.
3. **Show the line once per visit,** even if the browser already allows location. Treat a browser "Block" as a refusal.
4. **Consent record without coordinates:** text version, time, session and outcome. This is a small new stored item.
5. **Privacy notice (T31):** each legal entity and its role, the essence of the joint arrangement and a contact point; consent as the basis, the check on each order, no stored coordinates; how to withdraw and the alternatives; Turnstile's signals, Cloudflare's two roles, US processing and `cf.turnstile.u` once inspected; complaints to КЗЛД.
6. **A short DPIA** by Restro for all venues, covering the rejected alternatives (PIN, expiring codes), the field test's false refusals and the remaining channels.
7. **Records of processing:** Restro's controller and processor records, plus a template entry for venues.
8. **Venue terms:** an Art. 26 clause for the check and an Art. 28 agreement for orders.
9. **Turnstile:** pre-clearance off; run only at Send, never on menu pages; managed or interaction-only mode; feedback off; inspect `cf.turnstile.u` on staging; ask Cloudflare in writing whether the reuse can be switched off. A self-hosted proof-of-work check would avoid the reuse question, but it is a new dependency.
10. **D118's "The law" bullet:** change it to "exemption arguable, not relied on".

## For the lawyer later

1. Under Art. 4а(4)(2) ЗЕТ with Art. 5(3) ePrivacy, is one unstored location read, made only when the guest sends an order to the table's bill, necessary for a service the guest explicitly requested? (For: DSK Rn. 74, AEPD. Against: WP224 §7.4, CNIL Q16.)
2. Would КЗЛД accept paying first, or a waiter adding to the same bill, as an equivalent alternative, though the waiter is slower in a busy club?
3. Does a CAPTCHA provider's reuse of the signals, as an independent controller and only to improve bot detection, take the access outside the exemption?
4. The venue switches the check on or off and sets the radius and spot; Restro designed it, runs it on by default and alerts its own team. Is that joint control under Art. 26, or is Restro an independent controller for platform fraud prevention?
5. Does the DPIA's "not high risk" finding hold, so that no Art. 36 consultation with КЗЛД is needed?

## Sources

1. Закон за електронната търговия (ЗЕТ), Arts. 1, 4а, 20, 24, 24а, 25, lex.bg consolidation to ДВ 55/2026 [LAW] https://lex.bg/laws/ldoc/2135530547
2. Закон за електронните съобщения (ЗЕС), Arts. 248, 253 [LAW] https://lex.bg/laws/ldoc/2135553187
3. Закон за защита на личните данни (ЗЗЛД), Art. 10 [LAW] https://lex.bg/laws/ldoc/2135426048
4. КЗЛД, sector guidance "Онлайн търговия" (online commerce), 2025 [GUIDANCE] https://cpdp.bg/%D1%81%D0%BF%D0%B5%D1%86%D0%B8%D1%84%D0%B8%D1%87%D0%BD%D0%B8-%D0%BD%D0%B0%D1%81%D0%BE%D0%BA%D0%B8-%D0%B7%D0%B0-%D1%80%D0%B0%D0%B7%D0%BB%D0%B8%D1%87%D0%BD%D0%B8-%D1%81%D0%B5%D0%BA%D1%82%D0%BE%D1%80/
5. Directive 2002/58/EC, Art. 5(3) [LAW] https://eur-lex.europa.eu/eli/dir/2002/58/oj
6. GDPR, Arts. 4, 7, 13, 26, 28, 30, 35, 83, Recitals 43, 47 [LAW] https://eur-lex.europa.eu/eli/reg/2016/679/oj
7. EDPB Guidelines 2/2023 on Art. 5(3), v2.0 [GUIDANCE] https://www.edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf
8. WP29 Opinion 04/2012 (WP194) [GUIDANCE] https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2012/wp194_en.pdf
9. WP29 Opinion 9/2014 (WP224) [GUIDANCE] https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2014/wp224_en.pdf
10. DSK, OH Digitale Dienste v1.2, Nov 2024 [GUIDANCE] https://datenschutzkonferenz-online.de/media/oh/OH_Digitale_Dienste.pdf
11. AEPD, Guía sobre el uso de las cookies, 2024 [GUIDANCE] https://www.aepd.es/guias/guia-cookies.pdf
12. CNIL cookie FAQ, Q16–Q17 [GUIDANCE] https://www.cnil.fr/fr/questions-reponses-lignes-directrices-modificatives-et-recommandation-cookies-traceurs
13. EDPB-EDPS Joint Opinion 2/2026 on the Digital Omnibus [GUIDANCE] https://www.edpb.europa.eu/system/files/documents/2026-02/edpb_edps_jointopinion_202602_digitalomnibus_en.pdf
14. EDPB Guidelines 05/2020 on consent, v1.1 [GUIDANCE] https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-052020-consent-under-regulation-2016679_en
15. CJEU C-673/17 Planet49 [CASE] https://curia.europa.eu/juris/document/document.jsf?text=&docid=218462&doclang=EN&mode=req&dir=&occ=first&part=1
16. CJEU C-61/19 Orange România [CASE] https://curia.europa.eu/juris/document/document.jsf?text=&docid=233544&doclang=EN&mode=req&dir=&occ=first&part=1
17. CJEU C-252/21 Meta v Bundeskartellamt [CASE] https://curia.europa.eu/juris/document/document.jsf?text=&docid=275125&doclang=EN&mode=req&dir=&occ=first&part=1
18. EDPB Opinion 08/2024, consent or pay [GUIDANCE] https://edpb.europa.eu/system/files/2024-04/edpb_opinion_202408_consentorpay_en.pdf
19. EDPB Opinion 5/2019, ePrivacy and GDPR interplay [GUIDANCE] https://edpb.europa.eu/sites/default/files/files/file1/201905_edpb_opinion_eprivacydir_gdpr_interplay_en_0.pdf
20. CNIL, mobile-app recommendation (amended 2025) [GUIDANCE] https://www.cnil.fr/sites/cnil/files/2025-04/recommandation-applications-mobiles-modifiee.pdf
21. WP29 Opinion 13/2011 on geolocation (WP185) [GUIDANCE] https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2011/wp185_en.pdf
22. Cloudflare, Turnstile FAQ [vendor] https://developers.cloudflare.com/turnstile/frequently-asked-questions/
23. Cloudflare, Turnstile Privacy Addendum, 18 Jun 2025 [vendor] https://www.cloudflare.com/turnstile-privacy-policy/
24. Cloudflare, Customer DPA v6.4 [vendor] https://www.cloudflare.com/cloudflare-customer-dpa/
25. Cloudflare docs: pre-clearance; widget types [vendor] https://developers.cloudflare.com/turnstile/reference/pre-clearance-support ; https://developers.cloudflare.com/turnstile/concepts/widget/
26. CNIL SAN-2023-023, NS Cards France [CASE] https://bollettinoadapt.it/wp-content/uploads/2024/05/Deliberation-SAN-2023-023-du-29-decembre-2023-Legifrance.pdf
27. CJEU C-683/21 Nacionalinis visuomenės sveikatos centras [CASE] https://collab.dpa.gr/wp-content/uploads/2023/12/CJEU-C-683-21_en.pdf
28. Webflow forum and TfL cookie list on `cf.turnstile.u` [ARTICLE] https://community.webflow.com/ask-answer/post/cookie-consent-compliance---cf-turnstile-u-cookie-loading-before-consent-qjKK4GrWLfMOPzO ; https://www.tfl.gov.uk/corporate/privacy-and-cookies/cookies
29. Cloudflare Privacy Policy, s. 7 (DPF) [vendor] https://www.cloudflare.com/privacypolicy/
30. EDPB Guidelines 07/2020 on controller and processor, v2.0 [GUIDANCE] https://www.edpb.europa.eu/system/files/2023-10/EDPB_guidelines_202007_controllerprocessor_final_en.pdf
31. WP29 WP248 rev.01, DPIA guidelines [GUIDANCE] https://ec.europa.eu/newsroom/article29/redirection/document/47711
32. КЗЛД list of operations requiring a DPIA, 2019 [GUIDANCE] https://www.edpb.europa.eu/system/files_en?file=decisions%2Fbg_list_dpia_operations_bulgaria_final.pdf
33. Noerr on the Art. 30 simplification proposal [ARTICLE] https://www.noerr.com/en/insights/european-commission-proposal-for-simplification-of-gdpr-record-keeping-obligations-of-organisations-with-fewer-than-750-employees
34. Trud i pravo on the Euro Introduction Act (ЗВЕРБ) [ARTICLE] https://trudipravo.bg/?p=132717
35. ConsentStack, "Bulgarian ECA" [ARTICLE, vendor] https://www.consentstack.io/regulations/bg-eca
