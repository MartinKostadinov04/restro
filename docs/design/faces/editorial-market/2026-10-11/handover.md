# Restro Face — Handover

A self-contained guest menu + table-ordering UI ("face") for QR table service. **The platform owns configuration, business authority and external execution; the face owns presentation and temporary guest interaction state.** The current preview includes local simulation, not production transactions. This document distinguishes implemented inputs from the extensions the receiving agent must plan.

The venue chooses its color scheme in the platform formatting panel. Colors, fonts, rounding, offers, tags, filters, addons, menu structure and available features arrive from the platform. The menu never administers the restaurant or calls the POS directly.

---

## 1. Repository map

| Path | Purpose |
|---|---|
| `src/features/restro-face/face.tsx` | `EditorialMarketFace` — menu renderer, dish page, filters, allergens, layout switch, `Overlay` |
| `src/features/restro-face/styles.ts` | Scoped face CSS (`FACE_CSS`), all colours via tokens |
| `src/features/restro-face/types.ts` | View-model contract (`ViewModel`, `ViewItem`, `FaceProps`, …) |
| `src/features/restro-face/model.ts` | Pure helpers: theme → CSS vars, image `srcset`, BCP 47 |
| `src/features/restro-face/manifest.ts` | Face manifest (slots, tokens, channels) |
| `src/features/restro-face/guest-strings.ts` | Face UI strings (EN/BG) |
| `src/features/restro-face/ordering/ui.tsx` | Bag, table tab, waiter call, payment, receipt UI + `ORDER_CSS` |
| `src/features/restro-face/ordering/logic.ts` | Pure reducers and money maths (bag, totals, split, tip, VAT) |
| `src/features/restro-face/ordering/strings.ts` | Ordering UI strings (EN/BG) |
| `src/features/restro-face/ordering/demo.ts` | **Demo only** — fake choices, fake waiter round, EUR formatter |
| `src/features/restro-face/fixtures/` | Sample view models (EN/BG) and four theme presets |
| `src/features/restro-face/fixtures/themes/examples.ts` | Review-shell theme resolver; keeps preset selection outside the face |
| `src/routes/index.tsx`, `src/routes/menu.tsx` | Preview shell (stands in for the platform) |
| `public/menu-assets/a/<asset>/w320|w640|w1280.webp` | Sample dish images |
| `src/test/restro-face.test.tsx`, `restro-ordering.test.ts` | Contract, contrast and ordering-rule tests |

Stack: TanStack Start v1, React 19, Vite 7, Tailwind v4 (preview only — the face uses its own scoped CSS), `lucide-react` icons. No backend, no network calls from the face.

---

## 2. What the face draws itself (owned by the face)

### Browsing
- Compact venue bar: logo or wordmark, table label, language switch (BG | EN pill), Bill pill, filter button.
- Menu title, intro, schedule text.
- Sticky category rail with automatic active tracking and horizontal auto-centering (never scrolls the page).
- First section as a photo-led feature strip.
- **Three layouts**: list / 1 column / 2 columns (default 2). Icon-only switch under the second top-level section title, after the featured section. Remembered per visit (`sessionStorage: rm-layout`). The feature strip stays independent of this switch.
- Dish cards: photo on a "stage" panel, badge pill, full name (never truncated), price, description, portion, dietary/tag chips, allergen numbers, extra fields, choice summaries, "ask waiter" note, sold-out/scheduled states.
- Text-only dishes rendered as clean rows.
- Full-screen dish page (`#item-<id>`), shareable link, phone back button closes it, scroll position preserved.
- Filter sheet (dietary + tags, AND across dietary, OR across tags), reset.
- Allergen sheet per dish + allergen legend footer.

### Ordering (only when `ordering` prop is given)
- Quick-add "+" on each dish; turns into "− n +" counter. Dishes with required choices open the dish page instead.
- Dish page: choice groups (min/max/required, inline validation), kitchen note, quantity, live price, "Add to bag".
- Bottom bar: waiter bubble (wide label → round icon once the bag has items) + "View your order".
- Bag sheet (`#bag`): edit, change qty, remove, send to kitchen.
- Table tab (`#tab`): rounds from the app and from the waiter, per-item status (Received / Preparing / Served), table total, Pay.
- Call server (`#call`): waiter, bill, card terminal, water, cutlery, other + note; "on the way" state with cancel.
- Payment (`#pay`): whole table / split equally / only mine; tip 0/5/10/15 %/custom; promo field; Apple Pay, Google Pay, card, pay waiter; processing / success / failure screens.
- Receipt page (`#receipt`): venue, table, date, items, VAT, tip, total, method, reference; Download PDF / Email / Print buttons.

### Current presentation behavior (verify before production)
- Themes via 8 semantic colour tokens + radius; light, dark and `auto` scheme.
- Motion: slide-up sheets, press feedback, gliding category underline, photo fade-in; all off under `prefers-reduced-motion`.
- Accessibility: `ViewText` helper supplies BCP 47 language annotations; dialogs have focus containment / Escape / scroll locking, with focus restoration on browsing dialogs. Some smaller controls and ordering dialogs need a final touch-target/focus audit; do not claim every control has a 44 px target.
- Contract markers: `data-item` on dishes, `data-slot` on declared content wrappers, `data-state` on dish/state elements; source order preserved. Markers are not on every element.
- Responsive: tuned for 320–430 px phones first, then tablets (≤820 px column); controls scale with `clamp()`.

---

## 3. What must come from the platform (owned by the shell)

### Content & data
| Need | Where it goes | Notes |
|---|---|---|
| Menu structure (sections, nested sections, items, order) | `view.sections` | Face never reorders or filters out items except via guest filters |
| All texts already in the chosen language | every `ViewText` (`text`, `lang`) | Fallback language is marked per text via `lang` |
| Prices, formatted | `item.price.text`, `minor`, `from` | Face never formats menu prices itself |
| Money formatter for totals | `ordering.formatMoney(minor)` | Used for bag, tab, tips, receipt |
| Item state | `item.state` (available / sold_out / scheduled / unavailable + label) | Face only styles it |
| Allergens (codes, numbers, labels) + legend | `item.allergens`, `view.allergenLegend` | Always reachable when supplied; platform owns correctness and applicable legal requirements |
| Dietary labels, tags, badges | `item.dietary`, `item.tags`, `item.badges` | |
| Filters available | `view.filters` | |
| Choice groups | `item.modifierGroups` (min/max/required, option deltas) | Demo injects fake ones — remove `withDemoChoices` |
| Portion, extra fields, "ask waiter" note | `item.portion`, `extraFields`, `order.askWaiter` | |
| Images with variants and focal point | `ViewImage` + `assetBase` | Shell picks crop/variant; face only builds `srcset` |
| Menu title/intro/schedule | `view.menu` | |

### Design variables
| Need | Where |
|---|---|
| Colours light + dark (background, surface, accent, onAccent, text, muted, accentText, border) | `view.theme.colors`, `colorsDark` |
| Corner radius, shadow, font family name, logo | `view.theme.radius/shadow/font/logo` |
| Font stacks for font names | `fontStacks` prop |
| Light / dark / auto | `scheme` prop |
| Contrast ≥ 4.5:1 for text/canvas, muted/canvas, onAccent/accent | Shell must validate brand colours (tests show how) |

### Context
| Need | Where |
|---|---|
| Locale + available languages | `view.locale`, `languages`, `onLanguageChange` (shell re-resolves the view) |
| Table label | `tableLabel`, `ordering.tableLabel` |
| Venue name | `ordering.venueName` |
| VAT rate | `ordering.vatRate` (demo: 20 — must come from venue) |
| Channel | `view.channel` (QR only today) |

---

## 4. Connection points (inputs → face → outputs)

| Flow | Input from shell | Output to shell | If missing |
|---|---|---|---|
| Browse menu | `view` | — | Required |
| Change language | `languages` | `onLanguageChange(locale)` | Switch hidden when <2 languages |
| Ordering on/off | `ordering` config | — | Face is browsing-only |
| Send order | — | `onSend(lines: BagLine[])` | Order only moves to the local tab |
| Live table tab | `ordering.tab: TabRound[]` (incl. waiter-entered rounds from POS, statuses) | — | Only app-sent rounds appear |
| Call server | — | `onCallServer({kind, note})` | Only local confirmation |
| Pay | — | `onPay({amountMinor, tipMinor, method, scope})` → `boolean` or `Promise<boolean>` | Current demo incorrectly assumes success; MUST replace before production |
| Receipt data | today derived locally | — | Needs shell fiscal number, VAT ID, real items |
| Receipt PDF / email / print | — | **not yet wired** (buttons show a confirmation) | Need callbacks |

`BagLine` = `{ key, itemId, name, qty, unitMinor, options[{groupId, optionId, name, deltaMinor}], note }`.

---

## 5. Infrastructure the shell provides
- Menu import from venue files/API, cleaning, translation, image processing and CDN (`assetBase`).
- POS / restaurant system integration: sending rounds, reading the table tab and statuses, live updates (polling or push → new `tab` prop).
- Waiter paging (staff app / POS / notifications).
- Payment provider (Apple Pay, Google Pay, card), split logic authority, promo validation, tips settlement.
- Fiscal receipts: number, VAT breakdown, PDF generation, email sending, printer.
- QR → venue → table resolution, session per table/guest, "only mine" item ownership.
- Theme administration per venue (presets + custom colours), contrast validation.
- Analytics, error reporting, hosting.

---

## 6. Demo-only today (replace before production)
- `ordering/demo.ts`: fake Size/Extras choices on every third dish, fake waiter round, EUR formatter.
- `onPay` in the preview always succeeds after 1.4 s.
- VAT 20 %, venue "RESTRO", table "12".
- Receipt reference number, PDF/email/print buttons.
- Preview theme switcher ("Aa") on `/` and `/menu`.
- Ordering totals computed client-side — shell should be authoritative.

---

## 7. Open questions to decide together
1. Live tab updates: push (websocket/SSE) or polling interval?
2. Who is "me" for "pay only mine" — device session, guest name, seat?
3. Are promo codes validated before or during payment?
4. Should a sent round be editable/cancellable within a time window?
5. Receipt: render the shell's fiscal document, or the face's layout fed with fiscal data?
6. Waiter call cooldown and cancel — enforced by shell?
7. Sold-out changes mid-session: how does the shell tell the face to remove an item from the bag?
8. Additional locales beyond BG/EN — strings files need translations.
9. Kiosk/TV channels — new faces or new modes of this face?
10. Tip presets and service charge rules per venue/country.

---

## 8. Verification
- `bunx vitest run` — contract, contrast (all 8 theme versions), ordering rules.
- This update: 24 targeted tests passed, including arbitrary platform theme mapping; browser checked the dropdown through all four examples in light/dark without page errors. This verifies the review controls, not live platform/POS integration.
- Check at 320 / 360 / 390 / 430 px and ~800 px tablet, BG/EN, light/dark.

---

## 9. Two-way platform contract — integration architecture

```text
Venue files / POS / staff system / payment & receipt services
                         ↕
                PLATFORM (administrator)
      resolve content, design, permissions, prices and live bill
                         ↕
               PLATFORM ADAPTER / SHELL
          JSON → resolved props; callbacks → platform commands
                         ↕
                  CUSTOMER MENU FACE
       browse / select / draft bag / request / display results
```

The platform is the middleman in **both** directions. Initial JSON is not enough: send fresh resolved menu/context and authoritative bill state after commands and when the POS changes independently (including orders placed with staff). The adapter owns transport, subscriptions/polling, session identity, validation, loading/error state and reconciliation. No transport implementation is included here.

### Inbound: what the platform sends
1. **Resolved menu:** `ViewModel`, including selected locale, formatted prices, hierarchy, ordering state, modifier limits/deltas and all available content attributes. IDs must remain stable across refreshes and match platform entities through its mapping to POS IDs.
2. **Resolved design:** complete `theme.colors` and `colorsDark`, font token, radius, shadow and logo. Arbitrary venue palettes work; no preset ID is required by the face.
3. **Shell context:** `assetBase`, `languages`, `tableLabel`, `fontStacks`, `scheme`; these are separate `FaceProps` today, not members of `ViewModel`.
4. **Ordering data:** `ordering.tab`, venue/table labels, VAT input and money formatter. `TabRound` is defined in `ordering/logic.ts`. The platform must include app- and waiter-origin items and refreshed statuses.
5. **Needed extensions:** feature availability, authoritative quotes/totals, request statuses, transaction/receipt data, revisions and safe errors (see sections 12–13). These are NOT supported just by sending extra JSON keys today.

Functions cannot be serialized in JSON. `formatMoney`, `onLanguageChange`, `onSend`, `onCallServer` and `onPay` must be bound by the adapter after parsing data. A recommended future envelope separates `{ contractVersion, revision, view, presentation, context, capabilities, liveState }`; this envelope is a proposal, not an existing TypeScript type or endpoint.

### Outbound: every guest action and its destination
| Guest action | Current behavior/boundary | Production platform responsibility |
|---|---|---|
| Change language | `onLanguageChange(locale)` | Resolve fresh content and metadata for the requested locale; preserve stable item IDs |
| Open/close dish, change layout/filter | Local hash/state/session storage | Usually local only; optional analytics events require a future callback and consent policy |
| Quick add, quantity, addon, kitchen note, edit/remove draft | Local bag reducer | Decide whether draft sync/quote is needed; current code emits no bag-change callback |
| Send bag | `onSend(BagLine[])` returns `void`; then local success | Validate IDs, availability, choices and prices; submit via POS API; return acknowledgement and authoritative bill |
| Read table bill | New `ordering.tab` props | Continuously read the real bill; merge staff/POS updates using stable IDs, not menu-local guesses |
| Request waiter/bill/water/cutlery/terminal/other | `onCallServer({kind,note})` returns `void` | Route to staff/service system; return request ID and actual accepted/assigned/completed status |
| Cancel service request | Local reset only | Future cancel callback must identify request and respect platform permission/cooldown |
| Choose split, tip or payment method | Local preview calculations | Quote authorized payable amount, supported methods, ownership, tax/tip/service-charge rules |
| Apply promo | Input exists; Apply currently does nothing | Future validation callback and updated quote/discount result |
| Pay | `onPay(PayRequest)` → boolean / promise | Create payment session, complete provider flow, verify settlement and refresh bill; never trust client totals |
| View receipt | Locally derived paid state | Supply fiscal receipt/transaction data and only items actually covered by that payment |
| Download/email/print receipt | Confirmation-only placeholders | Future callbacks for platform-issued PDF, email and printing; no PDF generation in the face |

### Required successful ordering round trip
1. Guest prepares a **draft**. Draft contents are not a real bill or kitchen acceptance.
2. Adapter sends stable item/option IDs, quantities and notes plus guest/table context and an idempotency key to the platform. Names/prices from the face are display values, not trusted authority.
3. Platform checks table permissions, menu revision, stock, constraints and price; it talks to the POS.
4. Platform returns accepted/rejected result and mapped order IDs; rejection leaves the draft intact with actionable feedback.
5. Platform sends a new authoritative bill revision. The face displays that state, including staff-entered orders.
6. Subsequent POS changes refresh the bill independently of customer actions.

**Current blocker:** `OrderingProvider` immediately appends a local round and clears the bag, even without a callback or acknowledgement; it merges `cfg.tab` with these local rounds, risking duplicate entries when the platform echoes them. Before connecting real systems, replace this simulation with pending/accepted/rejected handling and a platform-controlled bill (or optimistic records reconciled by client action ID). The same requirement applies to local waiter confirmation and payment/receipt state. This is an explicit integration task, not a completed capability.

---

## 10. Formatting panel specification — current design inputs

### Color count and assignment
**Eight independent semantic colors per appearance mode: 16 values for a complete light/dark theme.** No separate color is needed for every button or badge. The panel may derive starter values from a brand palette, but must emit all eight resolved roles for both modes. `auto` chooses the mode using the device preference; it does not generate a dark palette.

| JSON role | Where it appears | Panel validation |
|---|---|---|
| `background` | Main canvas, dish page, floating back control, receipt; also reversed text on header/footer and dark-action surfaces | Contrast with `text`, `muted`, `accentText` |
| `surface` | Photo stages, unaccented selected addon surfaces, receipt-page stage | Contrast with text used on it; visibly separated from canvas |
| `accent` | Badges, primary add/send actions, order count, selected service/tip/split controls, preparing status, success/loading signals; quick-add hover | `onAccent` ≥4.5:1; do not use accent alone to communicate status |
| `onAccent` | Text/icons sitting on accent fills | ≥4.5:1 against accent |
| `text` | Primary names/prices/body text; **also inverse header/footer, overlays, waiter/order bar, quick-add and layout-selection fill** | ≥4.5:1 against canvas and surface; check inverse compositions |
| `muted` | Descriptions, portions, metadata, inactive category labels, secondary details | ≥4.5:1 against its actual canvas/surface |
| `accentText` | Schedule/state emphasis, category underline, focus outline | Text contrast on canvas; focus/non-text contrast where used |
| `border` | Separators, outlines, addon/input borders, receipt dividers | Check required control boundaries at ≥3:1 against adjacent surface |

Header/footer and ordinary filter/order sheets invert `text` and `background`; dark mode therefore changes them too. This implementation has no independent header, overlay, status-success or status-error color inputs. Transparency, hover fills, shadows and muted inverse text are derived using `color-mix` and opacity. Validate **rendered combinations**, not just eight raw values. Accent is reused for positive and in-progress states; a future dedicated status palette is optional work, not an existing field.

`theme.palette` exists in the supplied model but is not used by the renderer. The operative contract is `colors` / `colorsDark`; do not build panel controls around unused palette keys. The manifest uses semantic token names such as `color.on_accent`, whereas the JSON property is camelCase `onAccent`; `model.ts` maps JSON fields into CSS variables.

### Typography, shapes, imagery and layout
| Panel field | Current input/support | Design behavior and limits |
|---|---|---|
| Font family | `theme.font` + `fontStacks[token]` | One stack for all typography. Adapter loads approved font resources; the face does not download fonts. No separate heading/body font inputs yet |
| Font sizes/weights/case | Fixed CSS hierarchy | Bold uppercase dish names, different list/grid/detail sizes. Separate size, weight, casing and line-height controls need new contract fields and CSS mapping |
| Rounding | `theme.radius` number in px | Base radius; photo wrappers scale roughly 1.2–1.3×, sheet corners 1.4×, main controls 1.6×. Some badges/allergen boxes/ghost buttons remain fixed or fully rounded; not every artifact follows this input |
| Shadow | `theme.shadow` number | Controls outer menu-column shadow on larger widths (`value × 18px` blur); overlay/button/badge shadows remain derived fixed strengths. It is not a universal elevation slider |
| Logo | `theme.logo: ViewImage \| null` | Header image fits within 96×44 px. Null uses fixed RESTRO fallback branding, not a dynamic venue name; replace fallback behavior if needed |
| Appearance policy | `scheme: light \| dark \| auto` | Supplied through props by the adapter, independently of palette. Production venue policy belongs to platform |
| Image variants | `src`, `variants[{src,width}]`, dimensions, `objectPosition`, `alt` | Platform provides media and crop position. `imageProps` uses `objectPosition`, not raw `focal`, to render; it builds responsive srcset |
| Media address | `assetBase` + asset-relative path | Current helper concatenates paths; absolute external `src` URLs need an explicit adapter/helper extension, not arbitrary concatenation |
| Image aspect and spacing | Fixed face CSS | Featured stage / 4:3 grid / square list / large dish stage. No arbitrary aspect, padding, density or photo-shape settings yet |
| Menu layout | Local list/one/two switch, default two | Platform-controlled default/allowed layouts and feature-section designation are future fields; first section is currently always featured |
| Responsive sizing | Fixed CSS + control clamps | Phone first (320–430), tablet next (up to 820 column). Panel changes must retain usable touch targets and text fit, not allow unconstrained dimensions |
| Animation | Fixed transitions + system reduced-motion | No venue animation slider yet; system accessibility preference must remain authoritative |

**Suggested panel workflow:** choose an example → edit eight roles for each mode → choose approved font / radius / outer shadow / logo → choose appearance policy → preview phone and tablet with representative long names, no-image dishes, many tags, choices and sold-out state → validate → publish a versioned theme. Store venue settings in the platform, not in this repository or guest session. Numerical editor ranges and allowed font resources should be validated by the platform; current types do not enforce safe ranges.

### Included examples for agent review
The dropdown and light/dark button behind **Aa** on `/` and `/menu` remain intentionally available in this review app. They emulate platform choices, not customer permissions. All exact palette values are in `fixtures/themes/presets.json`; `examples.ts` resolves them onto a copy of the menu model, retaining font, logo, shadow and content.

| Example | Radius | Light background / accent / text | Dark background / accent / text |
|---|---:|---|---|
| Botanical | 14 | `#F4EFE6` / `#D9F26B` / `#1F3A2B` | `#13201A` / `#D9F26B` / `#F1ECE0` |
| Midnight | 6 | `#F5F1EA` / `#E0A43A` / `#1A1410` | `#0E0D0C` / `#E0A43A` / `#F3EBDD` |
| Nordic | 4 | `#FAFBFC` / `#2F5BEA` / `#1E2329` | `#12161B` / `#6E8EFF` / `#EEF2F6` |
| Terracotta | 18 | `#FBF5EC` / `#C8372D` / `#2B1B14` | `#1C1310` / `#E5533F` / `#F6EBDD` |

Production integration renders `EditorialMarketFace` directly with resolved props. Do not mount `MenuPreview`, run `withDemoChoices`, import theme fixtures as venue configuration, or expose the Aa control to guests. Custom themes need no renderer rewrite.

---

## 11. Content and available-attribute administration

| Platform panel/domain | Existing rendering contract | Authority / limits |
|---|---|---|
| Sections and special offers | `sections`, nested `sections`, title/description/image | Platform chooses inclusion, order and validity. No local offer engine or expiry evaluation; first section is visually featured by position |
| Item text | name, description, portion, `extraFields`, waiter note | Supply translated final text. `description.truncatable` is present but CSS currently clamps by layout regardless of flag |
| Price / promotions | `price.minor`, `text`, `from`, modifier delta | Formatted price text may express a resolved offer; no former-price/discount-card type or promo-rule engine. EUR-only types today |
| Availability and ordering | `state`, `order.controls` | Platform resolves schedule/stock/permission. UI orderability helper requires controls + available state + price; face does not calculate opening times |
| Badges | `badges[]` | Photo cards currently show only first badge; image-less items do not display badge slot. Separate multi-badge styling is an extension |
| Dietary labels | `dietary[]` | Chips from resolved labels; no nutrition inference |
| Tags | `tags[]` | Label chips; no per-tag color/icon input |
| Filters | `view.filters.dietary`, `.tags` | Empty arrays hide corresponding filters. Local semantics: AND dietary / OR tags. Custom predicates, sorting, search or filter logic settings are not supported |
| Addons / modifiers | `modifierGroups[]`: id/name/min/max/required/options | Group selection presentation follows cardinality; platform validates again. No nested/conditional groups, stock per option, per-option max quantity or option images |
| Allergens | per-item arrays + `allergenLegend` | Platform supplies complete mapping; never infer absence from a missing dataset |
| Section design hints | `hints.color/onColor/icon` | Present but currently unused; do not promise section-specific styling from these fields |
| Available languages | `languages`, locale and `ViewText.lang` | Content locale type lists 11 locales; UI strings currently EN/BG only. Other locale selection falls back to English UI |
| Ordering availability | Optional `ordering` prop | Absence is browsing-only; `view.ordering.enabled` alone does not enable/disable the provider |

Platform admins should choose the content and capabilities, not modify face markup. Unsupported attributes need deliberate schema versioning and renderer support; merely including them in JSON will not create a new interface.

---

## 12. Capability panel and missing contract extensions

These controls belong to the platform; most require implementation before they affect the current UI:
- **Orders:** per-venue/table/session enabled state; notes allowed and limits; quantity limits; draft quote validation; acknowledgement/rejection; edit/cancel policies. Current only coarse switch is presence of `ordering` and per-item `order.controls`.
- **Live bill:** stable POS line/round IDs, guest ownership, revision, last-sync time, payable totals, staff-origin rows, refunds/voids/discounts/service charges. Current tab statuses are only received/preparing/served, and totals are summed locally.
- **Service:** allowed request kinds and localized labels, cooldown, request lifecycle, cancelability, notes. Current six kinds and local confirmation are fixed.
- **Payments:** enabled methods, full/equal/mine scopes, permitted split count, quote ID, tip presets/default/custom policy, promo capability, provider availability, settled balance. Current methods/scopes and 0/5/10/15 tips are fixed; split people and promo code are not included in `PayRequest`, so existing payload is insufficient for authoritative split/promo execution.
- **Receipts:** platform-issued receipt ID, fiscal reference, seller/tax details, localized date, covered lines, tax breakdown by rate, discounts/service charges, paid amount and tip, method; availability of download/email/print. Current single VAT rate and local reference are demo-only.
- **Presentation:** approved fonts, appearance policy, allowed/default layouts, featured-section ID and optional visibility policy for slots. Current optional slots generally follow presence/nonempty data; no general slot-visibility config.
- **Brand/UI copy:** venue fallback identity, interface translations and service/payment labels; these are currently code-owned strings rather than arbitrary platform copy.

Keep data capabilities separate from aesthetic tokens. A theme color must never enable a payment method or hide mandatory allergen access. Derive available features from the platform's authorized capabilities, not guest input.

## 13. Reliability, security and integration acceptance

### Adapter requirements (not implemented here)
- Authenticate/authorize venue, table and guest session on the platform; do not put POS/provider credentials in guest JSON or browser code.
- Validate JSON contract/version and IDs; provide safe unavailable/error state for invalid data rather than assuming demo defaults.
- Commands need action IDs/idempotency keys, relevant menu/bill revision and session context. Prevent double send and double charge; preserve draft on failure.
- Return structured `pending/accepted/rejected` results with safe error messages, corrected quote/state and correlation IDs. A boolean payment result is insufficient for production recovery.
- Do not report staff as "on the way" until actual platform status confirms it. Do not report paid until verified settlement.
- Reconcile optimistic state against authoritative revisions; discard stale updates; avoid duplicates when POS echoes app-origin orders.
- Model reconnect/offline/stale-bill states; transport retries are platform-owned and must not repeat non-idempotent actions blindly.
- Revalidate availability/addons/prices on send and bill quote on pay. A client-computed amount is an estimate, never financial authority.
- Persist/restore completed transactions and service requests at the platform; current local state disappears on reload.
- Handle async exceptions and clear processing states. Current `onPay` await has no catch; thrown callbacks can leave processing stuck.

### Receiving-agent implementation order
1. Define versioned inbound JSON and outbound commands/results using the existing types as a starting point; explicitly add the unsupported fields above.
2. Build the formatting panel around the eight-role palettes and actual supported design inputs; retain the review fixtures as test examples.
3. Replace preview fixtures with platform resolution and bind callbacks in a platform adapter.
4. Replace immediate local order/service/payment success with acknowledged commands and platform-controlled live state; remove demo fallback success paths.
5. Add capability-driven controls, authoritative payment quotes and fiscal receipt props/callbacks.
6. Connect the platform—not the menu—to POS/staff/payment/receipt services and validate real round trips.

### Acceptance scenarios
- Platform JSON changes palette/font/radius/content without editing face code; all eight example appearances still render.
- Empty optional data hides corresponding affordances; unavailable item cannot be ordered even when a stale draft exists.
- Accepted order appears once on the real POS bill and once in refreshed menu state; rejected order leaves editable draft.
- Staff adds an item directly in POS and it appears on the guest bill without guest interaction.
- Language refresh preserves stable dish IDs and live table context.
- Unsupported payment/service/receipt capabilities are absent, not misleading demo buttons.
- A payment rejection or network failure never shows success; settled payment renders the platform receipt and refreshed balance after reload.
- Phone sizes first, then tablet; long translated text, many addons/tags, no-image items and every example theme checked for fit, contrast, focus and touch access.

**Scope delivered here:** customer UI, existing typed prop/callback boundaries, review themes and integration documentation. **Not delivered:** platform formatting panel, JSON transport, POS integration, authoritative acknowledgement/reconciliation, service lifecycle, real payments or fiscal receipts. No backend was added by this handover update.
