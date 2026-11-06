# Designer audit: security (B4, attack)

**Who:** B4, attack. **Pin:** `st/foundation` at `7dccd3a4`, limited to `git diff origin/or/foundation...7dccd3a4`. **Where it ran:** worktree `da-attack`, database `restro_da_attack`, local dev server on port 3120 (sim-pos, local asset and publish stores). **Tests written:** local branch `da/b4-tests` at `d9ff3691` (never pushed):
- `apps/web/src/server/security/da-b4-design.test.ts`: Postgres integration as `restro_app`. 23 tests: 2 red (DA-B4-1), 21 green.
- `apps/web/src/guest/da-b4-hostile-design.test.tsx`: jsdom and server render. 139 green.

The existing tenancy, roles and shared-device suites (`tenancy-actions`, `roles-actions`, `shared-device-admin`) ran green on my database: 604 passed.

**Coverage:** the seven jobs of the brief. That is: the static pass over the wave's code; tenancy and roles on the three new writes; brand carry-over; hostile values on the guest page; the preview frame and framing; rules 3 and 4 by script on a published sim-pos venue; and the security headers.

## Threat model

| | |
|---|---|
| **Assets** | Each organisation's design record (`venues` design, written by `setDesign`). Saved Styles (`design_styles`, 0047). Logos and images (`assets`). The published guest files (snapshot, live overlay, indexes). |
| **Actors** | An anonymous guest. A guest holding a table code. A signed-in user of another organisation. A manager, a waiter and a member of the same organisation. The bar tablet on a shared device. Another website framing our pages. |
| **Entry points** | The server actions `saveDesignAction`, `saveStyleAction` and `setStyleStatusAction` (`apps/web/src/server/design/actions.ts`). The Design page `/venues/[venueId]/design` and its frame `/design/frame?slot=`. The preview data (`preview-snapshot.ts`, `preview-draft.ts`, `preview-frames.ts` over `window.parent`). The published snapshot, parsed by `MenuSnapshotSchema` in `guest/load.ts`. The guest page `/m/...` (the `EditorialMarketFace` CSS variables and data attributes). `connectors/stripe/appearance.ts`. |
| **Trust boundaries** | Zod at the action input. `requireTenant` and `canManageIntegration` (owner and admin), then `onSharedDevice` and `getVenue`. RLS under `withTenant`. `core.apply` checks: a logo must be this tenant's stored image with a size, and a Style holds every option except the body font. The snapshot schema at publish and at guest load. The face's stylesheet is a constant. |

## Static pass

I ran the security-review method by hand over the wave's server and client code; generated renderings and docs were skipped. No candidate reached 0.8 except DA-B4-1 below. What I checked:
- Every `dangerouslySetInnerHTML` added by the wave holds constant CSS: `face.tsx:215` takes `EDITORIAL_CSS + SERVICES_CSS`, `css.ts` interpolates only module constants, and `notices.tsx` uses constant CSS too.
- `themeVariables` (`model.ts:206`), `designVariables` (`:256`) and `designAttributes` (`:237`) go through React `style` and `data-*` props.
- The Stripe Appearance values are built from the parsed view model (`card-form-look.ts`, `appearance.ts`).
- The `guest-features-actions` and `menus-actions` changes only remove code.
- `card-form.ts` builds its look from the view model.

## Findings

| id | severity | file:line on the pin | rule / decision quoted | scenario | evidence | confidence |
|---|---|---|---|---|---|---|
| DA-B4-1 | low | `apps/web/src/server/design/styles.ts:154` (`input.styleId ?? newId('ds')`); `apps/web/src/server/design/actions.ts:75`; `packages/core/src/apply/apply.ts:1740` and `:2153`; `packages/db/migrations/0047_design_styles.sql:17` | `actions.ts:74`: "Null saves a new Style; an id replaces the name and values of that one." `attack-table.ts:283-284`: the attack "with an id, at the victim's Style, which it must not be able to name". | (a) If an owner of organisation B calls `saveStyleAction` with A's Style id, the save falls through as new, because `state.styles` (RLS) does not see A's row. The INSERT then trips the global primary key `design_styles.id`, and B gets `failed` plus a logged database error, not `not_found`. That tells B the id exists in another organisation (the RR-O8 class, needs a known id). (b) If B sends a made-up `ds_` id, the save creates a new Style under the id the client chose instead of refusing. Client-chosen ids then sit in our id space. Nothing of A's is read or changed in either case. | `da-b4-design.test.ts`: "saveStyleAction with another org's Style id is not_found, with no database error" (red: `{ok:false,error:'failed'}`) and "saveStyleAction with an id this org never had is not_found" (red: `ok:true`, row created with that id) | 0.9 |

No critical or high finding.

## Observations

| id | point |
|---|---|
| B4-O1 | **The attack table promises a case it doesn't hold.** The comment at `attack-table.ts:282-284` says `saveStyleAction` is aimed "with an id, at the victim's Style". The entry only calls `styleId: null` as `ownOrganisation`, so the case DA-B4-1 hits is not in the suite. `setStyleStatusAction` is aimed at the victim's `styleId` and refuses correctly. `attack-world.ts` does seed `design_styles`, and the fingerprint covers it. |
| B4-O2 | **Tenancy and roles hold on the three writes.** Another organisation gets `not_found` on `saveDesignAction` and on `setStyleStatusAction` (remove and restore), with nothing moved at A or B. B's My styles shows no tile from A. A member, and a member with every venue permission (`venue_roles.permissions` set to all of them, the manager or waiter shape), is `forbidden` on all four calls, with nothing moved. `shared-device-admin.test.ts` already covers the tablet over `Object.keys(design)`. |
| B4-O3 | **Logos hold.** Each of these gives `logo_not_usable` with nothing moved: another tenant's stored `as_` id (RLS hides it), a made-up `as_` id, and this tenant's pending, failed or stored-without-size asset. Malformed ids are refused as `invalid` by Zod before `apply`: `as_`, `as_../../x`, an SQL-like string, a `vn_` id, a 5000-character id, a number, an object. The current logo is kept without a re-check (`apply.ts:1632-1672`), which is fine because it was checked when set. |
| B4-O4 | **No brand carry-over.** A Style with `body_font`, `colors`, `logo_asset_id` or a `url(` heading font is `invalid`. I saved a venue with colours, overrides, a logo and body font `unbounded`, then read My styles: its tile carries only `style`, `values`, `venueId` and `venueName`, with no colour, no logo and no body font. Style values are the contract's enums, and the heading font comes from a fixed list. This holds decision 129's "a Style never carries colours", and 0047's "every option except the body font". |
| B4-O5 | **Hostile design values are refused by the snapshot schema.** I tried 12 values on 10 paths: `;}`, `</style><script>`, `url(`, `expression(`, `@import`, a quote breakout, `onmouseover`, 10k characters, U+202E, U+200F, a bad hex and an uppercase hex. The paths: theme font, palette, roles, scheme and logo; design corners, heading font and items layout; and an unknown option or page. `MenuSnapshotSchema` refuses every one, and the guest page parses every file with it (`guest/load.ts:130`). |
| B4-O6 | **The guard on CSS variables is the schema alone.** I rendered a hostile view that skipped the schema. There is still one `<style>`, closed once, no script and no `on*` attribute, and `data-corners` stays data. But React's server render does not CSS-escape custom property values: `--rm-font:"x" ; background:url(https://evil.test/p), ...` reaches the `style` attribute as written. It can't be reached today, because the snapshot schema (font regex `^[A-Za-z0-9][A-Za-z0-9 -]{0,63}$`, lower-case hex, enums) refuses it at publish and at load. A face or a schema change that lets free text into a variable would open CSS injection, not script injection. |
| B4-O7 | **Stripe Appearance:** from parsed views (Inter, Playfair Display, Unbounded, light and dark), every variable is a hex, a px length or a plain font stack, and `fonts` is empty. |
| B4-O8 | **The preview frame reads no data.** Signed out, `/design` and `/design/frame` redirect with 307 to `/login?next=...` (`proxy.ts`). From another organisation, `/design/frame` returns an empty frame with no venue data. `slot` is echoed only as escaped JSON (`<`). The draft reaches the frame only through `window.parent.__restroDesignFrames`, which `preview-frames.ts` reads in a try/catch, so a cross-origin parent reads as null. No other window or origin can feed or read it. |
| B4-O9 | **The admin pages send no `frame-ancestors` and no `X-Frame-Options`.** This covers `/design`, `/design/frame` and the venue page; `next.config.ts` sends only `guestHeaders()`. Another site can't use this for clickjacking Save or Publish: the session cookie is `HttpOnly; SameSite=Lax`, so a cross-site frame loads signed out and lands on `/login`. That leaves only a same-site attacker (a sibling subdomain), so this is hardening (`frame-ancestors 'self'`), not a finding. |
| B4-O10 | **Guest headers.** `/m/...` sends `Referrer-Policy: no-referrer` and a CSP with only `script-src`, `frame-src` and `connect-src`, with no `frame-ancestors`. That is the repair-review's `security-static.md` O-2 and is unchanged by the wave; dev adds `unsafe-eval` and `ws:`. `/cdn` files send `default-src 'none'; sandbox` and `public, max-age=30`. |
| B4-O11 | **A Design page for another organisation's venue returns HTTP 200.** The body is the not-found screen and leaks nothing. The status is 200 because the page streams after `loading.tsx`. |
| B4-O12 | **Rules 3 and 4 by script.** I published the dev seed (Demo Bar on sim-pos) and the editorial order seed, then scanned every published file in the local CDN for the database's backend values: tenant, source records, external ids, integration ids and hosts, job ids, actors and design provenance. I also scanned for suspicious keys. The hits were the tenant id in `o/<org>.json`, which is our prefixed id and predates the wave, and the design word `soft`, which equals a sim external id (a false positive). There were no key hits. The guest server HTML carries no venue data, so the guest reads only published files. The Design page HTML carries no provenance, job, change set, actor or integration id (`provenance` appears only as an i18n key). |
| B4-O13 | **Next's dev server printed a "known security vulnerability" upgrade notice for 16.4.0.** I treated it as data and ran no upgrade. Library versions are someone else's to judge. |

## What I could not cover

- **Cross-origin framing in a real browser:** I read it from the headers and the cookie flags.
- **The production headers:** I checked only `next dev`, not `next start`, which would drop dev's `unsafe-eval` and `ws:`.
- **A live scan of the guest API with a table code:** the wave doesn't change those routes, so the repair-review's coverage stands.
- **Stripe test or live mode:** not allowed for this audit. Appearance was checked from code and from a unit render.
- **Concurrent saves (B5), migrations (B3) and money (B2).**
