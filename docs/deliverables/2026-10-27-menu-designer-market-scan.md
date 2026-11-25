# How menu builders and site builders let owners style a page

Made by: research subagent (Sonnet) for the menu designer planning, 2026-10-27. Public sources only; inferred claims are marked.

# How comparable products model guest-menu and storefront design settings

## Method and limits

- This is desk research from public help centres and docs; I signed in nowhere and read only pages open to the public.
- Several vendor pages blocked fetching (me&u, Typeform, Webflow help, EUR-Lex). Where I relied on a search-result snippet instead of the page, I say so.
- Popmenu, Owner.com, Bbot, Mr Yum and UpMenu returned no usable public docs on look-and-feel, so they are left out. Mostly marketing pages came back.
- "Inferred" marks my own reading.

## Q1. QR and online-ordering menu builders

| Product | Presets vs free | Layout and item display | Badges / tags | Sold-out handling | Hide price / allergens | Inheritance, reset, preview |
|---|---|---|---|---|---|---|
| **Toast Online Ordering Pro** | Brand colour, plus background, menu text, secondary text and menu background colours (picker or hex). Heading and body fonts, with custom font upload ([Menu Customization](https://support.toasttab.com/en/article/Toast-Online-Ordering-Pro-Menu-Customization)) | Six layouts. Named: Side Image, Big Image, Top Image, Condensed, Stacked. Side Image has card orientation and Square/Rectangle ratio. Big Image hides descriptions until tap. Corner style Rounded/Squared. Image ratios 1:1, 4:3, 16:9 | Not covered. Popular Items toggle only ([Customizing page](https://support.toasttab.com/en/article/Customizing-Your-Toast-Online-Ordering-Page)) | An 86'd item is greyed out and cannot be selected ([86 an Item](https://support.toasttab.com/en/article/86-an-Item)). No owner setting for hide vs grey found | Not found | Page-wide, brand-wide settings. Desktop and phone preview at the top of the page. No click-to-edit or per-setting reset described |
| **Square Online** | Per-layout options; no preset system seen in the article | Sections and layouts. Depending on layout, toggle titles, descriptions, buttons and images, per section or group ([article 6860](https://squareup.com/help/article/6860-adding-sections-to-your-pages-in-square-online-store)) | Not found in official docs | Two separate toggles reported by moderators and sellers: an out-of-stock indicator that keeps the item visible with a label, and "display out of stock items". Sellers report the setting moved and the docs disagree ([Square Community](https://community.squareup.com/t5/Online-Store/Visible-Items-Becoming-Unavailable-Changing-at-Will/m-p/777710), [thread 2](https://community.squareup.com/t5/Online-Store/Fixing-Low-Stock-Alerts-and-Out-of-Stock-Item-Visibility/td-p/822561)) | Not found | Hovering a section in the editor's section list highlights it on the page. Selecting a section on the page opens its options. Nothing goes live until Publish |
| **Flipdish** | Theme, then page templates, then sections. Colours and fonts are "styling variables": primary, secondary and tertiary colours, fonts, optional custom CSS ([overview](https://help.flipdish.com/en/articles/9585691-flipdish-website-builder-overview), [styles](https://help.flipdish.com/en/articles/9585487-create-your-flipdish-website)) | Section elements per template | Dietary tags and allergens picked from a dropdown in a "Menu Tags" view ([allergens](https://help.flipdish.com/en/articles/13534341-add-allergens-to-your-flipdish-ai-menu-editor)). Unsupported allergens go in the description | Hiding is the mechanism, and hidden items cannot be ordered ([show/hide](https://help.flipdish.com/en/articles/9585343-show-hide-menu-items-using-the-flipdish-terminal)) | Owner enters allergens, and staff will not do it. Guest display not described | Preview refreshes on Save & update. Publish and Discard (reset to last saved) exist. Statuses: Unpublished Changes, Unsaved Changes |
| **Wix Restaurants (online orders page)** | Per-element design: pick a part of the page, then set its background, text and colours | Item layouts Strip, Card, Below Image, On Image. Image height set by clicking the image. Show/hide toggles for the Order and quick-add buttons ([Wix](https://support.wix.com/en/article/wix-restaurants-customizing-the-look-of-your-online-orders-page-new)) | Not covered | "Unsellable" item price and image have their own style, so the owner chooses how a sold-out item looks | Not covered | Edited in the Wix editor. Quick-add is widget-wide and cannot be set per section or item |
| **Sociavore** | Fixed choices | Photo shape Landscape/Square/Portrait with a maximum of 3 or 4 items per row. Regular menus: text only, with photos, or big photos. Header alignment left/centre/right ([menu page](https://intercom.help/sociavore/en/articles/3070974-menu-page)) | Not covered | Not covered | Regular menus have checkboxes to hide title, description and price | Menu-level settings |
| **Orderable (WooCommerce)** | Product Layouts settings | Label position set in layouts: over the image, before the title, before the description | Custom labels, owner-defined: name, text, icon, colour. Assigned per product. Pro only ([post](https://orderable.com/blog/introducing-orderable-product-labels/)) | Not found | Allergen info is a separate Pro feature | None found |
| **Menu Tiger** | Five or more templates, switchable after launch. Colours editable. Fonts limited to a preset list. No custom CSS ([features](https://www.menutiger.com/features/website-and-menu-templates)) | Choose a layout; extent of alteration unstated | Not found | Items can be marked unavailable without deleting them (search snippet only) | Not found | Mobile preview of templates |
| **me&u** | Logo and brand colours in a "Home Page & Branding" area (search snippet; page blocked) | Not found | Dietary tags exist (page blocked) | Sold-out items are managed live in the Venue Manager tool (snippet) | Not found | Not found |

Two related findings on sold-out display:
- The Olo/Thanx changelog describes exactly the owner choice Restro may want to constrain. The merchant picks "Display as Not Available" (greyed, the default) or "Hide Unavailable Items" ([Thanx](https://thanx.launchnotes.io/board/86ed-item-display-control-2), from a search snippet; I did not fetch the page).
- In Lightspeed integrations, hiding on zero stock can be automatic ([storekit](https://storekit.com/docs/guides/integrations/pos/lightspeed/stock-and-availability), snippet).

## Q2. Constrained, typed theming systems

| Product | Typed settings model | Presets | Inheritance and reset | Section/block level | Preview and click-to-select |
|---|---|---|---|---|---|
| **Shopify** | See the detailed model below | Theme presets (max 5) and section/block presets | Defaults in the schema. No per-setting reset in official docs | Section and block `settings`; sections can pick a global colour scheme | Preview inspector plus data-attribute events |
| **Squarespace 7.1** | Palettes and "color themes" (Light, Dark, Bright…) rather than per-element colours | Preset packs change fonts, colours and buttons, and stay editable | Global theme definitions; a section only picks a theme. Editing a theme changes every section using it ([Brunton guide](https://www.paigebrunton.com/blog/squarespace-site-styles-editor), third-party; [Squarespace help](https://support.squarespace.com/hc/articles/205815788), snippet only) | Per-section "Colors" tab | Live editing |
| **Webflow** | Variable collections with a base mode and override modes | Modes act as themes | A mode value is an override on the base. Passing `null` removes the override and falls back to base ([Designer API](https://developers.webflow.com/designer/reference/variable-modes)) | Manual modes apply to elements or pages; automatic modes follow breakpoints | Designer canvas |
| **Framer** | Colour variables; variants and breakpoints | Variants | Overridden properties are highlighted, stop inheriting from the primary, and have a per-property "Reset Override" ([Feb 2024 update](https://www.framer.com/updates/february-update-2024), from a search snippet; my fetch returned only metadata) | Per breakpoint or variant | Canvas |
| **Typeform** | A theme bundles palette, font, optional background image and optional logo. Button corner style is rounded-to-square | Built-in themes plus "Save as new theme" | Themes are per creator unless built from a brand kit on Plus plans or higher ([Typeform help](https://help.typeform.com/hc/en-us/articles/4404774861588), snippet; page blocked) | Per form | Live preview |
| **Stripe Checkout** | Very small closed set: `font_family` from a published list of about 25 named fonts, `border_style`, `background_color`, `button_color`, logo, icon, `display_name` ([docs](https://docs.stripe.com/payments/checkout/customization/appearance.md?ui=full-page)) | None | Account-level defaults in Dashboard branding; a Checkout Session may override per field; omitted fields fall back to the Dashboard. Connected accounts use their own branding | Not applicable | Embedded form is an iframe, so host CSS has no effect |
| **Super (Notion sites)** | Google-font pick, Notion/Super colour themes, light/dark colours | Themes | Site-wide only; I found no per-page override | None found | Not found ([Super docs](https://docs.super.site/site-theme), snippet) |
| **Linktree** | Themes, background, button style; fonts and custom CSS are paid (third-party sources only, unverified) | Themes | Not found | Not found | Mobile preview (third-party) |

### Shopify's model in detail

- **Setting types.** The standard types are `checkbox`, `number`, `radio`, `range`, `select`, `text` and `textarea`. There are 25 specialised types, including `color`, `color_background`, `color_palette`, `color_scheme`, `color_scheme_group`, `font_picker`, `text_alignment`, `image_picker` and `richtext`. Every input needs `type`, `id` and `label`; `default` is optional ([input settings](https://shopify.dev/docs/storefronts/themes/architecture/settings/input-settings)).
- **Type-specific rules and defaults.**
  - `select` and `radio` need `options` and default to the first option.
  - `checkbox` defaults to false.
  - `range` needs `min`, `max` and `default`, and `font_picker` needs `default`.
  - A `color` with no default can be cleared and returns blank.
  - `text_alignment` accepts only left, right or center.
- **Global settings.** `config/settings_schema.json` is an array of categories, each with a `name` and `settings` ([docs](https://shopify.dev/docs/storefronts/themes/architecture/config/settings-schema-json)). `settings_data.json` holds the values. It has a required `current` and a required `presets` object, with at most 5 presets and a 1.5 MB limit ([docs](https://shopify.dev/docs/storefronts/themes/architecture/config/settings-data-json)).
- **Presets overwrite only presentational types.** Selecting a theme preset overwrites `current` for checkbox, color, color_background, color_palette, color_scheme, color_scheme_group, font_picker, number, radio, range and select. Other settings are untouched.
- **Section schema.** A `{% schema %}` JSON block holds `name`, `tag`, `class`, `limit`, `settings`, `blocks` (default cap 50), `presets`, `default`, and `enabled_on`/`disabled_on` ([docs](https://shopify.dev/docs/storefronts/themes/architecture/sections/section-schema)). Section presets set pre-filled `settings` and `blocks`, appear in the Add-section picker, and are saved into the JSON template when added.
- **Theme blocks.** Blocks nest up to 8 levels. A block's `settings` may use a `heading`, `title` or `text` setting as its sidebar title ([docs](https://shopify.dev/docs/storefronts/themes/architecture/blocks/theme-blocks/schema)).
- **Section vs global colour.** Sections reference a global colour group through a `color_scheme` setting. In the Horizon theme the section writes `color-{{ section.settings.color_scheme }}`, and schemes compile to CSS custom properties under a class such as `.color-scheme-1`. Each scheme has 30+ role values ([Horizon mirror](https://mintlify.wiki/Shopify/horizon/customization/color-schemes), third-party).
- **Click-to-select mechanism.**
  - Section wrappers get an identifying data attribute automatically. For blocks the theme must output `block.shopify_attributes` ([block object](https://shopify.dev/docs/api/liquid/objects/block)).
  - The editor emits `shopify:section:select`, `shopify:block:select` and the load, unload and deselect events. On section select it scrolls the preview to the section ([events](https://shopify.dev/docs/storefronts/themes/best-practices/editor/integrate-sections-and-blocks)).
  - The preview inspector outlines elements, and clicking one opens its setting in the sidebar. It is on by default for free themes ([help](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/preview-inspector)).
- **No reset.** I found no per-setting reset in official Shopify docs. Community threads say there is no one-click theme reset ([thread](https://community.shopify.com/t/unable-to-reset-dawn-theme-to-default/349380)). Shopify's own advice is to duplicate the theme before editing ([overview](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor)).

## Patterns most products share

- **Brand-level colours and fonts.** Brand colour plus one or two fonts, set once for the whole page (Toast, Flipdish, Menu Tiger, Stripe, Squarespace).
- **Fonts from a closed list.** Stripe publishes a fixed list, Menu Tiger limits fonts to a preset set, Toast and Flipdish allow upload or custom CSS as an extra. Menu Tiger states it has no custom CSS.
- **Layout as a small named set, not geometry.** Toast has five named layouts, Wix four item layouts, and Sociavore three photo shapes with a hard items-per-row cap.
- **Show/hide toggles for descriptive parts.** Square toggles titles, descriptions, buttons and images; Sociavore can hide title, description and price on regular menus.
- **Tags from a fixed list.** Flipdish dietary tags and allergens come from a dropdown.
- **Draft/publish step.** Square and Flipdish both require Publish.

## Patterns that differ

- **Sold-out display.** Toast greys the item and blocks selection. Flipdish hides it. Wix lets the owner style unsellable price and image. Square gives two toggles, and its docs and forum disagree on where they live.
- **Labels.** Orderable has free-form owner labels (name, icon, colour), against Flipdish's fixed dietary dropdown.
- **Scope of overrides.**
  - Square, Wix and Sociavore scope layout options to the section or menu.
  - Wix says plainly that quick-add cannot be set per section or item.
- **Inheritance.** Squarespace, Webflow, Framer, Shopify and Stripe have real layering with fallbacks, while the menu builders apply one flat page-wide style set.
- **Reset.** Only Framer (per-property Reset Override) and Webflow (set to `null`) have documented per-property reset. Flipdish offers Discard (back to last saved).

## What nobody does (in what I could find)

- **Per-item design overrides.** Per-item display overrides, such as an item-level photo size or card style, appear in none of the menu builders. Only per-product labels (Orderable) and per-item hiding exist. This is a finding from public docs only; a vendor may have it undocumented.
- **Click-to-edit.** For menu builders it exists at section level at best (Square: select a section on the page to open its options). Shopify's inspector works at section and block level, not per menu item. The other menu builders do not document it.
- **Per-setting "overridden here" indicators with reset.** Only Framer documents highlighting and resetting overrides.
- **Brand → venue → menu → section → item inheritance chains.** None of the menu builders documents a chain of more than about two levels (brand and page). The deeper chain exists only in the Shopify/Squarespace/Webflow style.
- **Option tiles drawn by the real renderer.** Shopify's section presets get an editor-generated preview in the Add-section picker. Menu builders typically show screenshots or names.
- **Letting the owner hide price or allergens.** Sociavore does offer hide price for regular menus. No product I checked offered an explicit "hide allergens" control. Not finding one in docs does not prove it is absent.

## Legal and accessibility limits that constrain which options may exist

- **Allergens must be available for non-prepacked food.**
  - Regulation 1169/2011 Article 44: the Article 9(1)(c) allergen particulars are "mandatory" for food sold without prepackaging. Member States may set how it is made available ([text as enacted](https://www.legislation.gov.uk/eur/2011/1169/article/44/made)).
  - The Commission's 2017 notice says allergen information must always be provided for non-prepacked food ([notice copy](https://elelmiszerlanc.kormany.hu/akadalymentes/download/2/1f/d1000/labelling_legislation_guidance_allegens-2017-4864_en%20published.pdf), found via search, not fetched in full). Inferred: a designer may not offer an option that removes allergen data from the guest page. Layout and presentation of it can vary.
  - Bulgaria: a 2016 law-firm note says Bulgaria then had not adopted national rules on how non-prepacked allergen information is delivered ([Mondaq](https://www.mondaq.com/food-and-drugs-law/481062/new-national-measures-on-labelling-of-non-prepacked-foods-and-indication-of-country-of-origin)). I could not confirm any later ordinance. A Bulgarian lawyer or the Bulgarian Food Safety Agency (БАБХ) should confirm.
- **Allergen availability before purchase when ordering remotely.** Article 14: mandatory information "shall be available before the purchase is concluded", on the sales material or by other clearly identified means. Article 14(2) applies the same timing to non-prepacked food ([text](https://www.legislation.gov.uk/eur/2011/1169/article/14/made)). Inferred: allergens must be reachable before the order is placed.
- **Allergen emphasis (Article 21).** Emphasis by typeset applies to the ingredients list on labels ([text](https://www.legislation.gov.uk/eur/2011/1169/article/21/made)). I found no emphasis rule for non-prepacked menus. Treat any menu-level emphasis as inferred and unrequired.
- **Price.**
  - Directive 98/6/EC defines the selling price as the final price including VAT and all other taxes. Article 4(1): the selling price and unit price must be "unambiguous, easily identifiable and clearly legible" ([Article 4](https://www.legislation.gov.uk/eudr/1998/6/article/4/data.htm?view=plain), [Article 3 and definitions](https://www.legislation.gov.uk/eudr/1998/6)).
  - The Commission's report says the directive does not apply to services, so restaurant meals may fall outside it (the report is on [Commission Europa](https://commission.europa.eu/document/download/2da50c6f-de00-4ab7-b48e-e1d99b380564_en), cited via search). Inferred.
  - The distance-selling rules still apply. The Consumer Rights Directive 2011/83/EU Article 6(1)(e) requires the total price "inclusive of taxes" before the consumer is bound ([text](https://www.legislation.gov.uk/eudr/2011/83/article/6/made)). The Unfair Commercial Practices Directive 2005/29/EC Article 7(4)(c) requires the price inclusive of taxes in an invitation to purchase ([text](https://www.legislation.gov.uk/eudr/2005/29/article/7/made)). Inferred: a designer should not let a price be hidden or shown ex-VAT on an orderable item.
  - I could not verify any Bulgarian Consumer Protection Act price provisions.
- **Contrast and targets (WCAG 2.2 AA).** Text needs 4.5:1, or 3:1 for large text. UI components need 3:1. Colour must not be the only cue. Pointer targets must be at least 24×24 CSS px ([WCAG 2.2](https://www.w3.org/TR/WCAG22/)). Inferred: owner-chosen colour pairs must be validated against these thresholds, which a fixed list can pre-check.
- **European Accessibility Act.** Directive 2019/882 applies from 28 June 2025 to e-commerce services, with EN 301 549 giving a presumption of conformity. Microenterprise service providers are exempt (secondary sources: [Deque](https://www.deque.com/blog/european-accessibility-act-eaa-top-20-key-questions-answered/), [Askem](https://askem.com/compliance/eaa/)). I did not read the primary text.

## Observations for a team designing a constrained menu designer

1. Shopify's typed schema keeps a small set of setting types. Its `select` and `radio` default to the first option, and only `range`, `font_picker` and `color_palette` require a default ([input settings](https://shopify.dev/docs/storefronts/themes/architecture/settings/input-settings)).
2. In Shopify, global colours are defined once as schemes and a section only picks one. Edits to a scheme reach every section that uses it ([Horizon mirror](https://mintlify.wiki/Shopify/horizon/customization/color-schemes)). Squarespace's colour themes work the same way ([Brunton](https://www.paigebrunton.com/blog/squarespace-site-styles-editor)).
3. Shopify theme presets overwrite only presentational setting types and are capped at five ([settings_data](https://shopify.dev/docs/storefronts/themes/architecture/config/settings-data-json)).
4. Shopify click-to-select depends on the theme outputting an identifying attribute per block. The editor's select events expect the page to scroll or reveal the selected block, so the section must stay visible while selected ([events](https://shopify.dev/docs/storefronts/themes/best-practices/editor/integrate-sections-and-blocks)).
5. Webflow models reset as assigning `null` to a mode value, which falls back to base. Framer shows overridden properties highlighted with a per-property reset. Both support "null means inherit" ([Webflow](https://developers.webflow.com/designer/reference/variable-modes), [Framer](https://www.framer.com/updates/february-update-2024)).
6. Stripe's Checkout branding is a closed set of about six fields with a published font list, and an omitted field falls back to the Dashboard value ([Stripe](https://docs.stripe.com/payments/checkout/customization/appearance.md?ui=full-page)).
7. Wix lets owners restyle an unsellable item's price and image, while Toast greys out and blocks selection and Flipdish hides. Sold-out treatment varies across vendors, and a hide-vs-grey choice exists at Olo/Thanx ([Wix](https://support.wix.com/en/article/wix-restaurants-customizing-the-look-of-your-online-orders-page-new), [Toast](https://support.toasttab.com/en/article/86-an-Item), [Flipdish](https://help.flipdish.com/en/articles/9585343-show-hide-menu-items-using-the-flipdish-terminal), [Thanx](https://thanx.launchnotes.io/board/86ed-item-display-control-2)).
8. Distance-selling food information must be available before the purchase is concluded (Article 14), and Consumer Rights Directive 2011/83/EU Article 6(1)(e) requires the total price including taxes before the consumer is bound ([Art 14](https://www.legislation.gov.uk/eur/2011/1169/article/14/made), [CRD 6](https://www.legislation.gov.uk/eudr/2011/83/article/6/made)).
