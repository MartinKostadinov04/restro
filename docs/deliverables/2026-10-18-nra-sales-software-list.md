# Are barsy and Mistral/Zamboo on the NRA list of sales software?

Research for GitHub issue #33 (child of map #29, "Ordering from the menu"). Planning research, no code. Searched on 2026-10-18. Follows Gate 1 of `docs/deliverables/2026-10-17-pos-integration-requirements.md`.

## Answer

**Neither product is on the list.** On 2026-10-18 the NRA's public register of sales software (СУПТО, чл. 118, ал. 16 ЗДДС) held 130 entries. None is barsy, "barsy SUPTO", Zamboo or any Mistral product, and none has Lukanet or Mistral Software as declarant. The search form worked without sign-in, a CAPTCHA or personal data.

[READING] So Annexes 29, 41 and 42 and чл. 52з do not bind a pilot venue **because of** barsy or Mistral/Zamboo. They would bind it only if the venue has chosen some other listed software for the site. That is one question to the venue (see "What stays open").

## How it was searched

1. [NRA] Opened `https://portal.nra.bg/details/reg-allowed-software` ("Достъп до услугата: ПИК, КЕП, Свободен достъп"), clicked "Справка". It opens the form at `https://portal.nra.bg/home.html#/goto:dec2009.REGREPSOFT.home` ("Публичен електронен списък на софтуерите за управление на продажби в търговските обекти по чл. 118, ал. 16 от ЗДДС"). Fields: type of software, name, version, declarant ID, declarant name, declaration date, declarant type.
2. Typed `barsy` in "Наименование на СУПТО", pressed "Търсене": "Няма намерени резултати" (0 results).
3. Because a name search can miss a Cyrillic spelling or a declarant-only match, ran the search with every field empty, chose "Всички" rows (130 of 130, `Показване на резултати от 1 до 130 от общо 130`) and checked every row's name, version and declarant for: barsy, барси, Mistral, Мистрал, Zamboo, Замбо, Lukanet, Лукънет. No match.

The last entries in the register are №1100 SUBCLOUD (included 27.08.2026) and №1101 SATISLY MONEY (included 11.09.2026), so the list is current to September 2026. Every entry is of kind "СУПТО по чл. 52а, ал.1 от Наредба Н-18/2006г.".

## Per product

| Product | Listed? | Name / version | Declarant | Date of entry | Page |
|---|---|---|---|---|---|
| barsy | **No** | none | none (Lukanet absent) | none | [register](https://portal.nra.bg/home.html#/goto:dec2009.REGREPSOFT.home), 0 results for `barsy`; absent from the full 130 rows |
| barsy SUPTO (the vendor's variant) | **No** | none | none | none | same |
| Mistral V3 ("Софтуер Мистрал v3 по наредба H18") | **No** | none | none (Mistral Software absent) | none | same |
| Zamboo | **No** | none | none | none | same |

Restaurant or POS products that **are** listed, for context (none is a pilot product): ЕЛИТ РЕСТОРАНТ - ПОРЪЧКИ, СУПТО 7.04 (№1034); МИКРОИНВЕСТ СКЛАД ПРО ЛАЙТ РЕСТОРАНТ 3.07.101 and 3.07.104 (№1000, №1051); RES 3700 v5 (№972); OMNIPOS V2.1.0 (№974); INCOPOS SUPTO (№996).

## The contradiction to resolve

[DOC] barsy's help says: "barsy SUPTO е вариант на система barsy, при които са изпълнени всички изисквания на Наредба Н18" ([docs.lukanet.com, Представяне](https://docs.lukanet.com/barsy.help/100-about/index.html)). [VENDOR PAGE] Mistral Software's help centre lists a product line "Софтуер Мистрал v3 по наредба H18" next to Zamboo ([mistral.bg/helpdesk](https://mistral.bg/helpdesk/), read in the browser on 2026-10-18). Both vendors thus claim an Н-18 variant, yet neither is in the register.

[READING] Possible explanations, none confirmed: the vendors never made the voluntary declaration; the entry was removed or never published; the register lists it under a name I did not try. The last is unlikely, since all 130 rows were read. Only the vendors can say. The pages read do not say that either variant is on the NRA list; the claim is "meets Н-18", which is not the same thing.

## What a venue files (Annex 32)

[NRA] ([NRA, users of СУПТО](https://nra.bg/wps/portal/nra/fiskalni-ustroystva-supto-i-e-magazini/supto/page.Informacia-za-potrebiteli-na-SUPTO); read through a page-extraction tool, not word for word, so check the page before quoting) A person who **chose** software from the public list for a site files the information of Annex 32 with the NRA:
- when: within 7 days of installing the software in the site (чл. 52з, ал. 1 Н-18); again within 7 days of any change; to stop using it, file Annex 32 with the date use ended;
- one filing per site; content: the site's name and address, the software's name and version, the seller it was bought from, the start date, the fiscal devices connected to it, the location of the database and further items in Annex 32;
- how: electronically, with a qualified electronic signature, through the e-service "Информация, подавана от лицата по чл. 118, ал. 18 от ЗДДС", which the page places on the NRA e-services portal. The choice counts from the day after filing. The page says users of СУПТО under чл. 52а, ал. 2 are exempt from filing.

[VENDOR PAGE] Mistral Software also hosts a form for the same information ([mistral.bg, Н-18](https://mistral.bg/%D0%B8%D0%BD%D1%84%D0%BE%D1%80%D0%BC%D0%B0%D1%86%D0%B8%D1%8F-%D0%BD-18/), cited in the fiscal research, not re-read here).

[READING] A venue on barsy or Mistral/Zamboo therefore cannot have filed Annex 32 **for that software**, because the form asks for software on the list and there is none. Whether it filed for something else is the venue's answer.

## How a venue can tell which variant it runs

- [NRA] The Annex 32 filing carries the software's name **and version**, and the register shows name, version and declarant per entry. The NRA page does not say how a venue finds its version number or matches it to the register; it points to the vendor.
- [DOC] barsy's public help describes "barsy SUPTO" as a variant but, in the page read, gives no way to see which variant an installation is (the page's table of contents lists an administration section, not read). Mistral's help centre names the "по наредба H18" product line but the page read gives no identification step.
- [READING] The reliable test is on the register: the venue (or Martin, for a pilot venue) searches `portal.nra.bg` for the exact name and version printed in the software's "About" screen or on the vendor's invoice. If the exact name and version are not there, the software is not listed, whatever its marketing name says. Today that test fails for both vendors by name.

## What stays open

1. **Does a pilot venue use other listed software for the site?** [READING] Only then do Annexes 29/41/42 bind it. Ask the venue: which software manages sales in the club, and did it file Annex 32 for the site? If it filed, ask for the name and version it declared.
2. **Why the vendors' "Н-18 variants" are absent.** One question to Lukanet and one to Mistral Software: "Is your Н-18 product in the NRA public list (чл. 118, ал. 16 ЗДДС)? Under what name and version?" [READING] Recommended, because a vendor could be listed later, and the answer changes Gate 1 for every venue on that POS.
3. **The list moves.** Entries are added (№1101 in September 2026). Re-run the search before any ordering build that depends on this answer, and again if a venue switches POS.
4. [NOT FOUND] The old link `inetdec.nra.bg/pls/pub/home.html#/goto:dec2009.REGREPSOFT.home` that the NRA СУПТО page gave returned 404 on 2026-10-17; the same form now works at `portal.nra.bg/home.html#/goto:dec2009.REGREPSOFT.home`. The NRA's user page still names `inetdec.nra.bg` for the filing service; not tested here, because filing needs a signature.

## Steps for Martin to repeat the search

1. Open `https://portal.nra.bg/details/reg-allowed-software` (no sign-in) and click "Справка".
2. Leave every field empty and click "Търсене". The table shows 130 rows (as of 2026-10-18). Change "Показване на" to "Всички".
3. Press Ctrl+F and look for `barsy`, `Мистрал`, `Zamboo`, `Лукънет`. Or type a name in "Наименование на СУПТО" and search. Nothing is entered about a person.
4. For a listed entry, "Преглед" at the row's end opens its details (not opened here, since no pilot product is listed).

## Not done

No sign-in, no CAPTCHA, no personal data. The "Преглед" detail pages of other entries and the filing e-service were not opened. The ЗДДС and Н-18 texts were not re-read; the reasoning on чл. 118, ал. 18 is the fiscal research's.
