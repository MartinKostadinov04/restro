# Brief CF-14: public menu address = readable name + permanent random code (D68)

- **Model:** Sonnet 5.5. **Branch:** your worktree branch, from `cf/foundation` after CF-01 is merged.
- **Read first:**
  - `CLAUDE.md` (rules 3 and 4);
  - `docs/tracker.md` → D61, D68, T61;
  - `docs/reviews/connector-architecture/A5-guest-outbound.md` (findings F5 and F7, for context);
  - the files below.
- **Why:** today a menu's public address is `/m/<slug>`.
  - The slug must be globally unique (migration 0013).
  - It can't be renamed without breaking links.
  - Venue addresses can be guessed.

  Martin decided (D68) to use the pattern Claude artifacts, Notion and Medium use: `<base>/m/<slug>-<code>`. A random, permanent code finds the venue; the slug is a readable, editable decoration.

## Target behaviour

- **The code:** every venue gets `public_id`, 12 characters of `[a-z0-9]`.
  - Generated with `crypto.getRandomValues` and rejection sampling (no modulo bias).
  - Never derived from `vn_` or any other id.
  - Unique (database index) and never changed by normal edits.
- **Canonical address:** `/m/<slug>-<public_id>`. Add one helper in core, `menuPath({ slug, publicId })`, and use it everywhere a guest link is built. Never assemble the string by hand elsewhere.
- **Lookup:** `/m/[venue]` reads `public_id` from the route parameter.
  - If the parameter ends in `-` plus 12 `[a-z0-9]` characters, those 12 characters are the code. If the whole parameter is 12 such characters, it is the code.
  - Anything else is "unknown venue".
  - The slug part is never used for lookup.
- **Self-correcting address:** the venue index file also carries the current slug. If the address bar's slug part differs (renamed venue, or a bare code), the guest page calls `history.replaceState` to the canonical path, keeping `?t=` and `?lang=`. Use no server redirect: the guest page stays a static shell reading only published files (rule 4).
- **Slugs are free:**
  - drop the global `venues_slug_unique` index and the per-tenant slug unique constraint, keeping the slug format check;
  - remove the `slug_taken` mapping from `provisionVenue` and from CF-01's New venue action and dialog (dead code otherwise);
  - add slug editing to the venue's Settings tab (`apps/web/src/components/admin/venue-settings.tsx`, read-only today): a field with `suggestSlug` from CF-01, a server action `renameVenueSlugAction` (owner/admin), and a note that old links keep working;
  - after a rename, queue the publish-files job so the index carries the new slug (find how the Publish tab queues it and reuse that).

## Published files

`packages/core/src/guest-files.ts` and their readers and writers:
- **`v/<public_id>.json`** = `{ venue_id, menu_id, slug }` replaces `v/<slug>.json`. It is written by `apps/worker/src/publish/files.ts`:
  - `slugOf` becomes a read of `public_id` and `slug`;
  - keep the "never overwrite another venue's index" guard as defence in depth (the job fails loudly);
  - rename `VenueAddressTakenError` accordingly;
  - when the slug changed, the existing index for this venue is rewritten.
- **`t/<token>.json`** = `{ venue_public_id, venue_slug, table_label }`, written by `apps/worker/src/publish/table-tokens.ts`. Update `tableTokenBytes` and the schema.
- **`/t/<token>`** (`apps/web/src/server/publish/table-token.ts`) redirects to `menuPath(...)` + `?t=<token>`.
- **`loadTableLabel`** (`apps/web/src/guest/load.ts` ~227–237) compares `venue_public_id`, not the slug.
- **No migration of old files:** only test data exists. Old `v/<slug>.json` files are left in the store and are never read again. Say so in a code comment.

## Database

- **Migration 0015** (or the next free number when you start; CF-03 may have taken 0014):
  1. add `public_id text` with a format check `^[a-z0-9]{12}$`;
  2. backfill existing rows. Generate 12 base36 characters from `gen_random_uuid()` bytes in SQL, or update row by row in a `DO` block; the unique index decides collisions, retry on conflict;
  3. set `NOT NULL` and a unique index `venues_public_id_unique`;
  4. drop the slug unique index and constraint.
- **`provisionVenue`** sets `public_id` itself, retrying once on a unique violation of `venues_public_id_unique`.
- **Read side:** `getVenue` / `listVenues` return `publicId`.

## Admin places that show or build a guest link

Find them with a search for `/m/` and `slug` in `apps/web/src` and `apps/web/app`:
- the Publish tab's "open the guest page" link;
- the Tables tab and print sheet;
- the QR address card's example;
- the venue card on the venues list;
- `docs/guides/qr-links.md` if it shows the menu address format.

All use `menuPath`.

## Tests

- **Core:**
  - `newPublicId` is 12 characters of `[a-z0-9]`, and 10,000 draws have no repeats;
  - `menuPath`;
  - the route-parameter parser (`demo-club-k3x9p2m7qa1z` → code; `k3x9p2m7qa1z` → code; `demo-club` → unknown; `demo-k3x9p2m7qa1Z` (upper-case) → unknown).
- **Database:**
  - two venues may share a slug;
  - `public_id` is unique, set on create, and unchanged by a slug rename;
  - the migration backfills all rows.
- **Worker:**
  - the index is written at `v/<public_id>.json` with the slug;
  - a rename rewrites it;
  - token files carry `venue_public_id`.
- **Web:**
  - the loader reads by code;
  - `/t/<token>` redirects to the canonical path;
  - a stale slug and a bare code both load the menu, and the address is corrected (component or Playwright).
- **Playwright:** update every spec that opens `/m/demo-club` to use the seeded venue's canonical path (seed scripts print or return it; don't hard-code a code). Add one spec: rename the slug in Settings, publish, then the old link still opens the menu and the address bar shows the new slug.

## Done when

- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass with DB tests on your own database `restro_cf_14` (54329), plus the full Playwright suite.
- **Vendor words:** the vendor-word test (CF-08a) stays green.
- **Report:** in the CLAUDE.md format.

## Never / scope

- Don't expose `vn_` ids or any internal id in the address.
- No server-side database read on the guest page (rule 4).
- **Dependencies:** none new.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
