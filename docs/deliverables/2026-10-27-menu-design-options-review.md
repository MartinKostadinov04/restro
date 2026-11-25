# Review of the menu design options spec: five verdicts

Made by: independent review subagent (Fable, max effort), 2026-10-27, at Martin's request. Reviews 2026-10-27-menu-design-options-spec.md; binds nothing.

**Sources read.** The spec; the component inventory; the decision log (rows 1.1–1.24, taken as binding: one design per venue, nothing off the item row, sold out hidden, scheduled out of scope, content is content); the market scan; the passport studio map §1; `docs/guides/menu-template-functionality.md`; the designer guide §5.2, §5.4, §5.5, §7.2–7.6 and §10; `packages/shell/src/manifest.ts`; D22, D70, D71, D72, D92, D93, D105, D122; `GLOSSARY.md`; and the Editorial Market code (`face.tsx`, `header.tsx`, `section.tsx`, `item.tsx`, `detail.tsx`, `css.ts`, `services/*`). I ran nothing and edited nothing.

**How I judged.** The owner's two conditions as the spec states them: (a) a venue owner would plausibly want it to differ between venues; (b) one renderer draws every value well on a phone from 320 px up, inside the §7.5 floors and the inventory's "never" block. Applicability is weighed against the market scan (what Toast, Wix, Square, Flipdish, Sociavore, Shopify and Stripe let an owner set) and the passport's eight blocks (2–9 leaves each). Wherever the spec says "as today", I checked the code.

## 1. Did we miss a group?

| Page | Item | Verdict | Reason | Default or value |
|---|---|---|---|---|
| Header | Venue bar and title block (logo, table label, language switch, bill, pay and filter entries, h1, intro, closed-menu note) | covered | One page for both halves is right: they share the band, and a tap on either lands on one thing | — |
| Section navigation | The rail | covered | — | — |
| Sections | Block, image, title, description, strip, sub-sections | covered | "Sub-section title one step smaller" as a derived rule is right | — |
| Items, Photos, Labels | The row and every part of it | covered | — | — |
| Dish page | The page and its photo | covered, one line short | Its ordering part (choice groups, the note, the quantity, the "Add" bar) is not named, so its option buttons have no look | Add: the dish page's option buttons follow Labels and D93's selected roles; its Add bar follows Buttons |
| Overlays and footer | Filter sheet, allergen sheet, veil, footer | covered | The layout switch and the empty-filter state are rightly fixed | — |
| The five screens | Call a waiter, Bill, Order, Pay, Receipt | covered, too richly | See §3 | — |
| General | Host notices (loading, not found, not published, load failed) | missed, one line | Drawn today by the host with `qr-phone`'s parts (inventory §1.1). With one renderer a guest should not meet a bare page in another font and colour; no option is needed | Add to §2: the host notices inherit General (colours, screen, fonts, text size, corners) and nothing else |
| General and Overlays | The location-consent sheet, "Last orders at 04:30", "Ordering from phones has closed for tonight", the still card "Please order from your waiter" (D122) | missed, one line | D122 fixes their words; nothing says what draws them | Add: they follow Sheets, Buttons and the status panel; no option of their own |
| Header | Language switch, table label, closed-menu note | covered, fixed | Right: proofs and controls, not looks | — |
| Main | Empty-filter state | covered, fixed | — | — |

No page is missing and none deserves splitting; the inventory's tree maps onto the fourteen pages, and the spec's split is better than the inventory's twelve (Brand, Type and Layout folded into General; the five screens on their own). What is missing is three one-line statements that keep the builder from guessing: the host notices, the D122 notices with the consent sheet, and the dish page's ordering part. None adds an option.

## 2. Did we miss an item within a group?

| Page | Item | Verdict | Reason | Default or value |
|---|---|---|---|---|
| Overlays | Filter sheet chips | covered | §3.6 names them under Labels | — |
| Overlays | Allergen sheet | fixed, fine | Two columns, the item's own marked; follows Sheets | — |
| Items | Layout switch look | fixed, fine | Three icon buttons; its presence is the Guest switch | — |
| Header | Intro, closed-menu note | content / fixed, fine | Q5 holds | — |
| Sections | Section image | content, crop unstated | Today 16:7; the Photos page covers item photos only | Say: section images keep 16:7 with General's corners |
| Sections | Sub-sections | derived, fine | — | — |
| Items | "Ask your waiter" | fixed, fine | A bold line; R11 | — |
| Items | Price size | missed rule | Names have s, m, l; the price has no size, and the never-list only says "never smaller than the body text" | Derive: the price follows the name size one step down, never below the floor of §3 |
| Items | Choices summary and extra fields in the two-column layout | missed, matters | Today's CSS hides `.rm-modifiers` and `.rm-extra` under `data-layout="two"` (`css.ts` 1229–1232). The never-list forbids removing them and Editorial is "as drawn today": both cannot hold | State that two-column cards draw both, at 12 px, wrapping; list it among Editorial's changes |
| Items | No-image layout | fixed, fine | `text_only` stays; a placeholder is a picture the venue did not upload | — |
| Labels | Marks ("New") | folded, right | One loud mark beside quiet labels is the one combination that works | — |
| Labels | Allergens "names" and the footer | missed rule | With names on the row nobody sees a number, and a numbered legend then explains nothing | With names, the footer lists the names without numbers; R6 is still met by row and sheet |
| Labels | `allergen_mode` | small correction | A manifest has one mode per face; `inline_codes` is satisfied by both values (the label or the code in the slot's text, `aria-label` or `data-allergen`, §7.4) | Keep `inline_codes`; the contract test renders both values |
| Navigation | Pills on a band | missed rule | D93's `selected` and `selectedText` are checked on page and panels; on an ink band nothing guarantees the pill's 3:1 edge | With Nav band = header and an ink header, the pill uses the band pair: `background` fill, `text` writing |
| General | Ink buttons on ink | missed rule, matters | Buttons = ink and Sheets = ink are both in the Editorial column; `text` filled on `text` is invisible | On an ink sheet or band an ink button inverts (page fill, ink writing); say it, because the Style test will hit it first |
| Bill | "Compact" lines | missed floor | "options inline after the name in smaller text" names no floor | 12 px, like every other text |
| Order | Stepper, count badge | fixed, fine | — | — |
| Call, Order, Pay | Status panels | see §3 | — | — |
| Receipt | Dashed rules | note | Today's receipt has dashed separators; the spec rules a dashed edge out (D122 §8), so Editorial changes here too | List it |

Nothing here is a new option. It is six renderer rules the spec leaves to the builder, and two of them (the two-column cards, ink on ink) would otherwise make the proposed never-list test fail on the Editorial Style itself. The two-column finding is the one Martin should know: either the renderer finds room for the choices summary and the extra fields in a 140 px card, or decision 1.22 bends for the grid. I recommend the room, and the spec saying so.

## 3. Items to ditch

| Page | Item | Verdict | Reason | Default or value |
|---|---|---|---|---|
| General | Style, Colours, Screen, Body font, Heading font | keep | The brand set every product offers (Toast, Flipdish, Stripe, the passport) | — |
| General | Heading weight, Corners, Depth, Density, Text size, Buttons | keep | Each differs across the five Styles; CSS; floors stated | Depth loses "high" (§5) |
| Header | Band, Arrangement, Title size, Logo size | keep | The strongest brand statement; Sociavore offers header alignment, the passport `hero` and `logo_size` | Band loses "accent" (§5) |
| Header | Title shown/hidden | **ditch** | The one option in the set that takes content off the page, while the spec's own rule for the intro, section images and descriptions is "content is content, delete it instead" (Q5). Square and Sociavore do offer such toggles, but Restro has already said no to them for the intro. The case it serves, a wordmark repeating the name, is content too: the header name is per menu and editable (D92), so "Club X" under a Club X wordmark is fixed by naming the menu "Drinks" | shown |
| Navigation | Marker, Band | keep | Pills against underline is the app/print cue; the band pair rule of §2 applies | — |
| Sections | Header, Title size, Title case, Strip card size | keep | Rhythm cues, all CSS; all-caps Cyrillic checked by the fixture | — |
| Items | Frame, Name size, Name weight, Name case | keep | Martin's own cards-or-no-cards example; weight and case differ between Classic, Editorial and Club | — |
| Items | Price place, Portion place, Description lines | keep | The bar convention ("8,00 € · 50 ml") against the bistro one; R9 behind every cut | — |
| Items | Layout, Guest switch | keep | Decision 1.20 | — |
| Photos | Shape, Frame | keep | Toast offers 1:1, 4:3 and 16:9; stage against bleed is Editorial's signature | — |
| Labels | Labels, Allergens | keep | Decision 1.18; the 12 px floor | — |
| Dish page | Kind, Photo | keep | Branch, small; both looks exist in the overlay today | — |
| Overlays | Sheets | keep | Editorial's ink sheets against calm ones | — |
| Call a waiter | Kinds | keep | A venue with two kinds against one with six | loses "words" (§5) |
| Call a waiter | Status (centred, inline) | **ditch** | It shows for seconds and goes; no product offers a status-panel style; the centred mark is the pattern every payment flow uses, and `role=status`, the 40 px reference and the tick are easier to hold in one draw. Q4's sharing is right; the option is not needed | centred, for Call, Order and Pay |
| Bill | Rows, Lines | keep | A twelve-line club bill against a four-line one; the amounts untouched | Rows loses "open" (§5) |
| Bill | Frame (flat, card) | **ditch** | A card inside a sheet inside a phone is decoration with small applicability; the receipt already sits on its card today and should keep it, as a page | flat on sheets; the receipt page keeps its card |
| Bill | Total place (bottom, top) | **ditch** | The venue bar already shows "Bill · €46,00" before the sheet opens, so the number is first for every venue; "top" draws the amount twice (the total and the Pay button) in 288 px at 320, and invites Pay before the lines | bottom |
| Order | Add control, Order bar | keep | Wix documents quick-add as an owner choice; floating against docked is the app/system cue | — |
| Order | Line photos | keep, borderline | Cheap Branch; it matters only to a photo-led menu that wants a text Order | hidden |
| Pay | Scope (segmented, stacked) | **ditch** | The spec's "as today: segmented" is wrong: `.ro-scope` is `display: grid` with no columns, three 58 px rows (`services-css.ts` 795–798 with 382–406). Three Bulgarian labels in one segmented control at 320 px is the one value that draws badly | stacked, which is today |
| Pay | Tip (chips, rows) | keep | Rows show the host's amount per option; a restaurant wants that, a bar the chips; `tipOptions` already carry the amounts (D72) | — |
| Pay | Methods (list, tiles) | **ditch** | Payment buttons are the one place where a wide, equal target is the known practice; tiles put a loud Apple Pay beside a quiet "with the waiter" at half width. Also "Apple's own look" is not today's: the apple button is an accent fill. Apple's button rules belong to the pay work, not the designer | list |
| Pay | Promo field (folded, open) | **ditch** | Whether a venue takes codes is the host's quote (`quote.promo`); how prominent they are is a feature setting beside it, not a look | folded; if wanted, a switch in the Guest functions card |
| Receipt | Layout (detailed, compact) | **ditch** | The confirmation people screenshot and quote to staff; small type for VAT rows and references has small applicability and a real cost | detailed |
| Receipt | Venue block | keep | Cheap branding on the one screen a guest keeps | — |
| §5 | "a scheduled item's 'from 18:00'" | **strike from the never-list** | Decision 1.24: scheduled is out of scope; a clause that becomes a test must not test a state the shell stops producing | Keep "an unavailable one" only if the shell still draws it after 1.23 |
| §5 and §3.6 | "D22, under review"; the `item.state` marker | correct | Decision 1.23 confirmed: hidden. A page that opens for a part that is never drawn is odd | Say "hidden (1.23)"; drop `item.state` from the Labels page's markers |
| §5 | "never smaller than the body text" | define | Editorial's price is 14 px on a text row and 16 px with a photo, while the root body is 16 px and descriptions 14 px; a test needs one number | The floor is the description size (14 px standard, 16 px large) |

Tenancy and security: no option carries free text, a URL or CSS; the only free values are the three colours, contrast-checked (D70, D93). Nothing to flag, except that a copied design (decision 1.6) must copy values and not the logo asset, the editing proposal's open point. The law: no value hides a price, strikes it through, shows it ex-VAT or hides an allergen; the never-list covers 1169/2011 Art. 14 and 2011/83 Art. 6. So the cuts above are not safety cuts; they are applicability cuts. The evidence: no menu or ordering product in the scan lets an owner style the bill, the checkout or the receipt beyond colours and fonts (Stripe Checkout: six fields), and the passport has no equivalent block. Decision 1.8 wants the five screens in the designer, and they stay in it: eight options of their own plus General, Sheets and Labels keep every screen editable without a setting a venue will never touch.

## 4. Did we miss an option value?

| Page | Item | Verdict | Reason | Default or value |
|---|---|---|---|---|
| Photos | Shape 3:2 | no | 4:3 and 16:9 bracket it; Toast stops at three ratios | — |
| Labels | Allergens "both" (number and name) | no | Over-engineering; names already open the sheet | — |
| Items | Layout: a two-column text list (wine lists) | no | 60-character names in 140 px columns; the list with one description line covers it | — |
| General | Heading weight "light" | no | None of the six faces is served at 300 | — |
| Navigation | Band "panel" | no | Marginal between page and header | — |
| Header | Band after losing "accent" | enough | page, panel and ink cover calm, framed and dark | — |

Nothing added. The lists already have the market's shapes (Toast's three ratios, Typeform's rounded-to-square, the passport's s/m/l), and every look I could want for a Bulgarian bar or club is reachable by combining what is there.

## 5. Values to lose

| Page | Item | Verdict | Reason | Default or value |
|---|---|---|---|---|
| Header | Band "accent" | lose | The 10 % colour over a third of the first screen (D70's rule); the only §5.4 pair on it is `onAccent`, so the language pill, the table label and the bill outline have no guaranteed 3:1 edge; on a dark screen the accent is lightened for contrast and the band goes pale; no Style uses it | page |
| General | Depth "high" | lose | No Style uses it; a shadow barely shows on a dark screen, so "high" draws two different menus; "low" is the whole Editorial effect | low; keep none and low |
| Call a waiter | Kinds "words" | lose | A row with a 20 px icon and a row without are a few pixels apart, and the icon helps the guest (water, cutlery) in every Style | list |
| Bill | Rows "open" | lose | A bill is a statement: with wrapped options, space alone no longer says which amount belongs to which line | ruled; zebra for long bills |
| Header | Title size "xl" | keep | Editorial today | — |
| General | Corners "extra" | keep | The app look some venues want; cheap | — |
| Items | Description lines "all" | keep | R9 holds; a bistro wants it | — |
| Photos | "wide", "portrait" | keep | Promo strips, bottles | — |
| Sections | Strip card "s" | keep | A two-up strip is a two-column card, which exists | — |
| Labels | "text" | keep | Long drink lists | — |
| Overlays | Sheets "page" | keep | Calm venues | — |
| General | Density "spacious" | keep | Editorial today | — |

Four values go; each is one no Style in the table picks, with a draw cost on a phone or a pair the engine does not guarantee.

## Net effect

| Page | Spec | Review | Change |
|---|---|---|---|
| General | 11 | 11 | depth loses "high"; host and D122 notices named |
| Header | 5 | 4 | Title ditched; band loses "accent" |
| Section navigation | 2 | 2 | the band pair rule |
| Sections | 4 | 4 | the section-image crop stated |
| Items | 9 | 9 | the price-size and two-column rules |
| Photos | 2 | 2 | — |
| Labels, allergens and state | 2 | 2 | the footer rule with names; `item.state` marker dropped |
| Dish page | 2 | 2 | the ordering part named |
| Overlays and footer | 1 | 1 | the consent sheet named |
| Call a waiter | 2 | 1 | Status ditched; kinds loses "words" |
| Bill | 4 | 2 | Frame and Total place ditched; rows loses "open" |
| Order | 3 | 3 | — |
| Pay | 4 | 1 | Scope, Methods and Promo field ditched |
| Receipt | 2 | 1 | Layout ditched |
| **Total** | **53** | **45** | 8 options removed, 0 added; 4 values removed, 0 added; 8 renderer rules stated |

The Styles table moves with it: Classic takes list kinds, the centred status, ruled rows, no card and the detailed receipt; Club takes a list of methods, the total at the bottom and the detailed receipt; Soft takes ruled rows and no card; Editorial's pay scope reads "stacked", which is what it draws today. To stage: still seven (the design record, the heading font, the layout's move; names, the dish kind, the add control, the line photos), unchanged. Of the spec's six questions I would answer yes to all; Q4 becomes moot once the status look is fixed.

## Overall verdict

Yes, with the changes applied: this is the set to ship. The spec's judgment on the browsing page is sound and better than the inventory's stars: the folds (marks into labels, the footer into sheets, capitals into two cases) are right, "content is content" is right, and once the two pair rules of §2 are written down nothing in the set breaks a §7.5 floor, a contract ruling, rule 5 or the law. Its weak half is the five screens, where fifteen options outrun condition (a) and one "as today" is not today; and the never-list, offered as a contract clause with a test, still carries a state decision 1.24 removed and lacks the two rules without which the test fails on the Editorial Style itself. Forty-five options, eleven of them General, is the size of the passport's studio and of nothing in the menu market, which is the right size for a product whose pitch is designed menus.

## The five changes that matter most

1. **Fix the never-list before it becomes a test.** Strike the scheduled clause (1.24), state sold out as hidden (1.23), define the price floor as the description size, and add that two-column cards draw the choices summary and the extra fields, which today's CSS hides.
2. **Add the ink-on-ink rule.** Buttons = ink on an ink sheet or band inverts to page fill and ink writing; the Editorial column has both and would draw an invisible Send and Pay.
3. **Cut the five screens from 15 options to 8.** Ditch Status, Bill frame, Total place, Pay scope, Methods, Promo field and Receipt layout; lose "words" and "open". Every screen stays editable through General, Sheets, Labels and its remaining options.
4. **Make "Editorial is as drawn today" a checked claim.** Today the pay scope is stacked rows, the kinds are icon-beside-word in a two-column grid, Send and Pay are accent while the "+" and the bar are ink, the receipt has dashed rules, and the two-column grid hides choices and extra fields. List each departure in §4's notes, as the spec already does for the 12 px rises.
5. **Ditch Title shown/hidden and lose the header band's "accent".** The first for consistency with the content rule (the header name is editable per menu); the second because it is the one band with no guaranteed control pair, and no Style wants it.

## What I could not establish

- Martin's one-line descriptions of Soft, Classic and Club: in no file I found; the Styles table's "in the spirit of" cannot be checked here.
- Whether D93's `selected` and `selectedText` roles are checked against an ink band as well as against page and panels (I read the decision, not the engine); the pill-on-band rule stands either way.
- How allergen names draw in a two-column card at 320 px with five allergens; the spec's "Branch" claim is plausible but wants a prototype before the Allergens option is staged.
- Whether the host notices are to be drawn by the renderer at all; the live architecture doc wins over the inventory's "outside the template today".
- Carried from the inventory, unchanged: whether Bulgarian law requires the portion on a menu; Bulgaria's rule on non-prepacked allergen information; the heaviest weights of Lora and Playfair Display.
- The market scan's "no product styles the checkout" is "not found in public docs", not proof of absence; the cuts on the five screens rest on applicability, not on that alone.
