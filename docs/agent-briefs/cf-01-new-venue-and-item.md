# Brief CF-01: create a venue and create a menu item in the admin

- **Model:** Sonnet 5.5. **Branch:** your worktree branch, from `cf/foundation`.
- **Read first:**
  - `CLAUDE.md`, and `apps/web/AGENTS.md` (Next.js 16 is newer than your training data: read the guide in `apps/web/node_modules/next/dist/docs/` before writing a server action or a page);
  - `docs/tracker.md` → D64, D65, T68;
  - `docs/reviews/connector-architecture/A4-admin-app.md` → findings A4-F1, A4-F2, A4-F17 and proposals A4-P1, A4-P2.
- **Why:** Restro must work for venues with no till (D64). Today no production code creates a venue (only seed scripts and tests call `provisionVenue`), and the composer can create sections but **no items** (only `createSectionOps` exists). This brief adds both, in the admin, through the existing write paths.
- **Out of scope:** tables, integrations, the barsy layer rename, anything about connectors. Do not touch `packages/barsy`, the worker, or the database schema.

## 1. New venue

**Where:**
- `apps/web/app/(admin)/venues/page.tsx` (the venues list; today an `Empty` saying a venue is "set up together with the Restro team");
- new `apps/web/src/components/admin/new-venue-dialog.tsx`, modelled on `apps/web/src/composer/new-section-dialog.tsx`;
- new server action file `apps/web/src/server/venues-actions.ts` (`'use server'`), next to `apps/web/src/server/venues.ts`;
- new pure helper `apps/web/src/lib/slug.ts`.

**What and how:**
- **Button:** "New venue" in the page header, and as the action in the empty state. Shown only to owners and admins: use `canManageIntegration(role)` from `apps/web/src/server/roles.ts` (do not rename it; a later sweep renames it).
- **Dialog fields:**
  - name (required, trimmed, 1–120 characters);
  - public address (slug), pre-filled from the name with `suggestSlug(name)` and editable. Under it: "This is the menu's public address: `<base>/m/<slug>`. It can't be changed later." Use the base the Tables tab already uses (`defaultQrBaseUrl` in `apps/web/src/server/env.ts`); show only `/m/<slug>` if it is null;
  - languages: checkboxes for the locales `provisionVenue` accepts (today `bg_BG` and `en_US`; read the list from core's `LOCALES`, don't hard-code), at least one, plus a default-language select limited to the checked ones (default `bg_BG`);
  - time zone and currency are not asked: `provisionVenue` defaults them (`Europe/Sofia`, `EUR`). Show them as one read-only line.
- **`suggestSlug(name)`:** lower-case; Bulgarian Cyrillic transliterated to Latin with the official Bulgarian scheme (а→a, б→b, в→v, г→g, д→d, е→e, ж→zh, з→z, и→i, й→y, к→k, л→l, м→m, н→n, о→o, п→p, р→r, с→s, т→t, у→u, ф→f, х→h, ц→ts, ч→ch, ш→sh, щ→sht, ъ→a, ь→y, ю→yu, я→ya); every other non `[a-z0-9]` run becomes one `-`; trim `-`; at most 60 characters. The result must pass core's `isVenueSlug`; if it can't (e.g. empty), return `''` and the field shows its error.
- **`createVenueAction(input: unknown)`:**
  - follow the pattern of `apps/web/src/composer/actions.ts`: Zod `strictObject` input, `requireTenant()`, role check (owner/admin, else `{ ok: false, error: 'not_allowed' }`);
  - call `provisionVenue(getPool(), organization.id, {...})` then `provisionMenu(getPool(), organization.id, venue.id)` (both from `@restro/core/apply`);
  - map `ProvisionError` codes: `slug_taken` → `{ ok: false, error: 'slug_taken' }`, `invalid_input` → `'invalid'`; anything else is logged with `logError` and returns `'failed'`;
  - on success `revalidatePath('/venues')` and return `{ ok: true, venueId }`; the dialog then navigates to `/venues/<venueId>`.
- **Copy:** replace `venues.empty.description` so it points at the New venue button. All new strings in BG and EN under `venues.new.*` (`apps/web/messages/bg.json` and `en.json`).

## 2. New item in the composer

**Where:**
- `apps/web/src/composer/ops.ts`: add `createItemOps` next to `createSectionOps`;
- `apps/web/src/composer/actions.ts`: add `createItemAction`;
- new `apps/web/src/composer/new-item-dialog.tsx`, modelled on `new-section-dialog.tsx`;
- `apps/web/src/composer/item-pane.tsx` (the section pane and the Unsorted pane), `composer.tsx` (wire it like the section flow around lines 230–262), `reducer.ts` (an optimistic `addItem`, like `addSection`).

**What and how:**
- **`createItemOps({ id, sectionId, name, price, sortKey })`** returns, in order:
  1. `{ op: 'createNode', id, nodeType: 'item', parent: null, status: 'active' }`. Items have `parent: null`; membership is a placement. This is exactly how `apps/web/scripts/lib/demo-menu.ts:291` creates items;
  2. `setField` `name` in layer `manual`, scope `master`, value = the `LocalizedText`;
  3. only when a price was given: `setField` `price`, layer `manual`, scope `master`, value = the money shape `{ amount_minor, currency }` validated with core's `MoneySchema`;
  4. only when `sectionId` is not null: `{ op: 'setPlacement', item: { id }, section: { id: sectionId }, sortKey }`.
- **Money (rule 8):** the dialog sends the price as the decimal **text** the person typed (e.g. `"4.50"` or `"4,50"`). The action converts it with core's money module (`decimalToMinor` or whatever `packages/core/src/money.ts` exports for decimal text). Never `x * 100`, never `Number(...)` on the text first. Currency = the venue's currency (`venue.currency`). A price is optional; empty means no price write.
- **`createItemAction(input: unknown)`:**
  - strict Zod input: `venueId` (vn_), `id` (nd_, made on the client with `newId('nd')` like sections), `sectionId` (nd_ or null), `name` (`partialRecord(LocaleSchema, string 1–120 trimmed)`), `price` (optional string ≤ 12 chars), `sortKey` (`SortKeySchema`);
  - use `perform(venueId, build)`, so the change set is manual, atomic and goes through `apply()` (rule 1);
  - in `build`: the name needs the venue's default locale and only enabled locales (same check as `createSectionAction`);
  - when `sectionId` is set, check it is a `section`, not archived, **and belongs to this venue's menu**. `getNodeBasics` may not tell you the menu: if no helper answers "is this node in this menu", add `isNodeInMenu(tenantId, menuId, nodeId)` to `apps/web/src/server/menus.ts` (read side, `withTenant`). Refuse otherwise (return `null` → `invalid`);
  - add an owner/admin role check (`canManageIntegration`) to `createItemAction`, and the same check to the existing `createMenuAction` (A4-F17).
- **UI:**
  - a "New item" button in the pane header of a section and of Unsorted, and in the empty item list (`item-list-empty`);
  - the dialog asks: name per enabled language (default language required) and an optional price, labelled with the venue currency;
  - on submit, add the item optimistically (`addItem` in the reducer, placed at the end of the open section, or in Unsorted), call the action (`keyAtEnd` gives the sort key, as for sections), then **open the item sheet for the new item**. Find how a row opens its sheet (`item-param.ts` / `composer-context`) and reuse that, so the person can fill allergens, description and photo there.
- **Copy:**
  - `composer.empty.noSections.description` today says the menu "from barsy arrives here". Make it neutral, e.g. "Create a section, or connect a till in the Integration tab.";
  - `composer.empty.noItems.description` mentions the New item button.
  - BG and EN, new keys under `composer.newItem.*`.
- **Rules to keep:**
  - **Rule 5:** an item made by hand has no till link, so it is display-only (`orderable` stays false). Don't add any control that changes `for_sale` or `visible` to true.
  - **Required fields:** `allergens` is required by the template, so a new item shows its issues badge until it is filled in the sheet. That is expected; don't weaken the validator.

## Tests

- **Unit:**
  - `suggestSlug` (`"Демо Клуб Sofia"` → `"demo-klub-sofia"`, `"  --  "` → `""`, 60-character cut);
  - `createItemOps` shapes (with and without price and section);
  - the reducer's `addItem`.
- **Database tests** (`CI=true`, your own database `restro_cf_01` on the running 54329 instance; see CLAUDE.md "Database tests"):
  - `createVenueAction`: success creates venue + menu; `slug_taken` maps; a member (non-admin) is refused; bad input is `invalid`;
  - `createItemAction`: success writes node, name, price (minor units) in the `manual` layer and the placement; refuses a missing default-locale name, a section from another venue, and a non-admin.
- **Component:** the venue dialog (slug suggestion, validation, public-address line) and the item dialog (default-language name required, price text kept as typed).
- **Playwright:** one spec, "venue with no till":
  1. create a venue from the list;
  2. create the menu, a section, and an item with a price;
  3. the item sheet opens; set allergens to none;
  4. publish;
  5. `/m/<slug>` shows the item and its € price.

## Done when

- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass with DB tests, plus the Playwright suite.
- **Report:** in the CLAUDE.md format.

## Never / scope

- **Dependencies:** none new.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Strings:** every UI string goes through next-intl in BG and EN.
- **Scratch files:** `<your scratchpad>/cf-01/`.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
- **Stop and ask:** if something here doesn't fit the code, put the question in your report rather than guessing.
