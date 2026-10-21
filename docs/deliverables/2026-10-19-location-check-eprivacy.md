# The location check and Turnstile under the ePrivacy rules
Made by: research subagent (Sonnet), 10-19, for ticket #38 "Guarding against fake orders on the bill" of map #29. Builds on section 6 of `2026-10-19-location-check-indoors.md`.

## Summary

- **Does ePrivacy Art. 5(3) apply to the location read? Clear: yes, very likely.** The EDPB says a web page that tells the browser to send something it holds to a server is "gaining access", even if the data was made on the phone. Its own COVID guidance says location read from a phone falls under Art. 5(3).
- **Is the "strictly necessary for a service the user asked for" exemption available? Needs a lawyer, and the signs are against us.** The CNIL says fraud prevention is generally not covered, except security that protects the user's own login. Our check protects the venue and other guests, not the guest.
- **Does the browser's permission prompt count as consent? Needs a lawyer.** The EDPB says consent must name the purpose and the controller. The prompt names neither, so our one-line explanation carries the weight.
- **Is "refuse and you cannot order on the bill" a problem for free consent? Needs a lawyer.** The rule against tying a service to consent is aimed at data the service does not need. Whether an anti-fraud check counts as needed is the open question.
- **Bulgaria: clear on the text, unclear on the sanction.** The cookie rule is Art. 4а of the Electronic Commerce Act (ЗЕТ), not the Electronic Communications Act. It asks for information plus a chance to refuse, which a browser prompt gives. The enforcer is probably the Consumer Protection Commission (КЗП), not КЗЛД; sources conflict.
- **GDPR basis: needs a lawyer.** Preventing fraud is a named legitimate interest, but where ePrivacy needs consent, the EDPB says the GDPR bases are narrowed. A privacy notice is needed in any case.
- **DPIA: needs a lawyer, but lean yes.** Location data and "stops a person using a service" are both on the EDPB's risk-criteria list; two criteria usually mean a DPIA. A record of processing is needed even though nothing is stored.
- **Turnstile: partly clear.** Cloudflare calls its signals "strictly necessary", but no DPA ruling or EU regulator statement on Turnstile was found, and the CNIL's CAPTCHA rule is conditional. Whether it needs consent depends on settings (a cookie only if pre-clearance is on).

## 1. Does Art. 5(3) apply to the Geolocation call?

[LAW] Art. 5(3) of Directive 2002/58 covers storing information on, or gaining access to information stored on, a user's device. It applies to any "information", not only personal data.

[GUIDANCE] EDPB Guidelines 2/2023 v2.0 [1] say:
- Para. 33: when the accessing party's JavaScript tells the browser to send the targeted information, that "clearly" counts as access.
- Paras. 39 and 12: stored information includes what sensors on the device produce, whoever stored it.
- Para. 44: a phone's system APIs (GPS named) are not "access" while the information stays on the device, "but when this information or any derivation of this information is accessed", Art. 5(3) applies.
- Paras. 52-53 ("local processing"): results made locally and sent to a server are "access"; local origin does not matter.

[GUIDANCE] The EDPB's COVID location guidance [5], para. 11, says that for location data "collected directly from the terminal equipment", Art. 5(3) applies.

[READING] Our design sends latitude, longitude and accuracy from the browser to the server on instruction of our own script. That fits paras. 33 and 53 squarely. Discarding it at once does not matter for the question of "access"; it happened when it was sent. Sending only a yes/no would still be a "derivation" under para. 44. **Clear: 5(3) applies.** The note that the geolocation API already asks the user first does not change that.

## 2. Is the "strictly necessary" exemption available?

[LAW] The exemption covers access "strictly necessary in order for the provider of an information society service explicitly requested by the subscriber or user to provide the service".

[GUIDANCE] WP29 Opinion 04/2012 [2]: the user must have asked for the service by a positive act, and the access must be needed for a function the user asked for ("if cookies are disabled, the functionality will not be available"). Section 3.3 extends this to "user-centric security" cookies, for example detecting repeated failed logins, but "would not however cover" security of services not requested by the user. The summary list gives such cookies only for authentication abuse.

[GUIDANCE] The CNIL's cookie FAQ [3], Q16: fraud-prevention trackers generally fall outside the exemptions, which it reads narrowly. Exceptions exist where the tool secures a user's authentication (limiting automated or unexpected access attempts). Q17 on CAPTCHAs: no consent if the sole purpose is securing the site or login for users' benefit.

[READING] Placing the order is the service the guest asked for. But the check protects the venue's bill and other guests from fakes. That is not security of the guest's own service, and the order works technically without it. WP29's test ("the functionality will not be available") is not met. I found no DPA that accepts a location check against order fraud under the exemption. **Needs a lawyer; plan on consent.**

## 3. If consent is needed

[GUIDANCE] EDPB Guidelines 05/2020 [4]:
- Para. 64: informed consent needs at least the controller's identity, the purpose, what data is collected, and the right to withdraw.
- Para. 89: consent through browser settings is possible only if those settings meet GDPR conditions, "name the controllers" and be granular.
- Paras. 26 and 32: tying a service to consent is presumed unfree for data that is not necessary for the service; if the processing is necessary for the service, Art. 7(4) "does not apply". Para. 39: access must not depend on consent to device access (a "cookie wall").

[READING]
- The browser prompt names the site, not the purpose, so on its own it is not informed consent. Our one line before the prompt must give controller (venue or Restro), purpose, and that the position is not kept.
- The conditionality point cuts both ways. A cookie wall blocks content; we block only ordering on the bill, with the menu and waiter call still open, which is much milder. If the check is deemed necessary for the service, Art. 7(4) does not apply; if not, a lawyer must say whether a narrow, purpose-related refusal still leaves consent "free". I found no guidance on this exact case. **Needs a lawyer.**

## 4. Bulgaria

[LAW] Correction to the earlier file: the cookie and device-access rule is in the Electronic Commerce Act (Закон за електронната търговия), Art. 4а, added in 2011 (ДВ бр. 105/2011), according to a consolidated text I read [8]. Para. 1: a provider of information society services may store or access information on the user's device only if (1) the user gets clear and comprehensive information under GDPR Art. 13 and (2) the user can refuse. Para. 4 exempts access needed for a communication or for a service the user explicitly requested. [READING] This is an opt-out wording, weaker than the Directive's "consent"; the Directive still binds courts through conforming interpretation. A browser prompt with an explanation meets both wordings.

I did not find the Electronic Communications Act (ЗЕС) article for Art. 5(3): the PDF I opened had unreadable Cyrillic. [NOT FOUND] ЗЕС location-data rules (ePrivacy Art. 9) bind public telecom providers, not us.

[LAW, one source] Sanctions: Art. 24 ЗЕТ fines (hundreds to a few thousand BGN; amounts may have been converted to euro) and enforcement by the Consumer Protection Commission (КЗП), Arts. 20 and 25 [8]. A vendor page says the personal-data commission (КЗЛД) enforces [9]; a law-firm article says the Act has no consent duty [9]. The conflict is not settled. [NOT FOUND] No КЗЛД or КРС guidance on geolocation or on terminal access.

## 5. GDPR side

- **Lawful basis.** [LAW] Recital 47: processing "strictly necessary for the purposes of preventing fraud" is a legitimate interest (Art. 6(1)(f)), after a balancing test. [GUIDANCE] EDPB Opinion 5/2019 [6], para. 40: Art. 5(3) takes precedence over Art. 6 for the access, and where ePrivacy requires consent, "the controller cannot rely on the full range" of Art. 6 grounds. So they do not simply stack. If consent is required for the read, plan on consent under both. Contract (6(1)(b)) is unlikely: the EDPB reads "necessary for the contract" narrowly and fraud prevention falls outside it, as commentary on Guidelines 2/2019 reports [14].
- **Privacy notice, Art. 13.** [LAW, from memory] Controller identity and contact; purpose and basis (the legitimate interest, if used); recipients (Cloudflare); transfers outside the EEA; retention ("not stored"); rights, including withdrawal and complaint to КЗЛД; and whether the data is required and the consequence of refusing (no ordering on the bill). It must be given when the data is collected: one line plus a link is a layered notice. [READING] I did not open the WP29 transparency guidelines to confirm.
- **DPIA, Art. 35.** [GUIDANCE] WP248 [7]: location data is the example for "sensitive or highly personal data" (criterion 4) and "prevents a person using a service" is criterion 9. Two criteria usually mean a DPIA. [READING] Mitigated by no storage, but I found no КЗЛД list; **needs a lawyer.**
- **Record of processing, Art. 30.** [READING] Applies to any processing, stored or not. The small-firm exemption does not apply to non-occasional processing.
- **Controller or processor.** If the venue decides the purpose, Restro is processor (Art. 28 contract) and the venue gives the notice. If Restro designs and requires the check, it is controller or joint controller. Art. 5(3) names the party that instructs the device (guidelines 2/2023, paras. 32-34), not "controller". **Needs a lawyer.**

## 6. Cloudflare Turnstile and the proxy

[GUIDANCE-vendor] Turnstile's privacy addendum [10] says it processes client IP, TLS fingerprint, User-Agent and site key, "strictly necessary" for bot detection; Cloudflare is processor for bot blocking, controller for improving detection (its basis: legitimate interests). It does not mention consent or ePrivacy. Cookies page [10]: bot-management cookies (`cf_clearance`, `__cf_bm`) are "strictly necessary", with no consent statement; `cf_clearance` appears only if pre-clearance is on. Cloudflare's docs do not mention localStorage [10]. [ARTICLE] A cookie-consent tool flagged a `cf.turnstile.u` cookie before consent [11]; competitor pages call it contestable [11].

[GUIDANCE] The CNIL's CAPTCHA position (Q17 [3]): no consent if the sole purpose is security of the site; consent if the provider reuses data for its own ends. Cloudflare reuses signals to improve detection, so the CNIL test is not obviously met. [GUIDANCE] The EDPB says IP-only access is within 5(3) when it comes from the device, but plain IP use to deliver the page falls under the transmission exemption [1].

[NOT FOUND] No EU DPA decision on Turnstile. **Needs a lawyer** (question 4 below); a Turnstile-free fallback or no pre-clearance cookie narrows the issue.

## What this means for Restro

Facts and risks, not decisions.
- The location read is almost certainly in ePrivacy scope. Treat the exemption as unlikely; plan on consent.
- The browser prompt is not consent alone. The explanation must name the controller and the purpose, and the notice must exist.
- A refused guest loses ordering on the bill only. That narrowness helps the "free" argument but is untested.
- Bulgarian wording is lighter than the Directive; the risk is a challenge by КЗП, КЗЛД or a venue's customer, not a high fine.
- Turnstile's classification rests largely on Cloudflare's own statement.

**Narrowest questions for the lawyer:**
1. Can a location check against fake orders, protecting the venue and other guests, fall under the "strictly necessary for a service explicitly requested" exemption, in Art. 4а ЗЕТ and in the Directive?
2. Does the browser's permission prompt, with a one-line explanation of purpose and controller before it, give consent valid under ePrivacy and GDPR?
3. If consent is the basis, is refusal-means-no-ordering-on-the-bill compatible with "freely given" (Art. 7(4))?
4. Is Turnstile, without pre-clearance, "strictly necessary", given Cloudflare reuses signals to improve detection?
5. Who is controller: the venue, Restro, or both? Is a DPIA required?
6. Who enforces Art. 4а ЗЕТ, КЗП or КЗЛД, and what are the sanctions today?

## Sources

1. EDPB, Guidelines 2/2023 on the technical scope of Art. 5(3), v2.0, 7 Oct 2024, edpb.europa.eu/system/files/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf [GUIDANCE] (read in full)
2. Article 29 WP, Opinion 04/2012 on cookie consent exemption (WP194), ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2012/wp194_en.pdf [GUIDANCE]
3. CNIL, cookies and trackers Q&A (Q16, Q17), cnil.fr/fr/cookies-et-autres-traceurs/regles/cookies/FAQ [GUIDANCE]; CNIL pixels consultation summary 2026, cnil.fr (via search summary only)
4. EDPB, Guidelines 05/2020 on consent, v1.1 (copy at dataprotection.ro/servlet/ViewDocument?id=2491) [GUIDANCE]
5. EDPB, Guidelines 04/2020 on location data and contact tracing (copy at dataprotection.ro/servlet/ViewDocument?id=1878) [GUIDANCE]
6. EDPB, Opinion 5/2019 on ePrivacy and GDPR interplay [GUIDANCE]
7. Article 29 WP, WP248 rev.01 DPIA guidelines, ec.europa.eu/newsroom/document.cfm?doc_id=47711 [GUIDANCE]
8. Закон за електронната търговия, Art. 4а, 20, 24, 25, kik-info.com/normativna-baza/zakoni/0X2135530547/ [LAW] (unofficial consolidation; verify on lex.bg or ДВ)
9. ConsentStack, "Bulgarian ECA"; Mondaq/Legal500 cookie overview 2022 [ARTICLE]
10. Cloudflare, Turnstile privacy addendum (cloudflare.com/turnstile-privacy-policy/); Cloudflare Cookies page; Turnstile ephemeral ID docs [vendor documents]
11. captcha.eu; Friendly Captcha; Webflow forum thread on `cf.turnstile.u` [ARTICLE]; all competitors or anecdotal
12. Directive 2002/58/EC Arts. 5(3), 9; GDPR Arts. 6, 7, 13, 28, 30, 35, Recital 47 [LAW], taken from quotations in 1, 4, 6, 7 and my knowledge, not re-opened
13. CJEU, Planet49, C-673/17, as quoted in source 1, para. 10 [CASE]
14. Law-firm commentaries on EDPB Guidelines 2/2019 (A&L Goodbody, Hogan Lovells) [ARTICLE]; guidelines text not opened
