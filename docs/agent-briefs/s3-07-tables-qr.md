# Brief S3-07: tables and QR codes (ours or the venue's own link, D61)

- **Model:** Sonnet 5.5.
- **Branch:** your worktree branch from `s3/guest`, after S3-05 and S3-06 are merged.
- **Read first:**
  - `CLAUDE.md` (rule 3: no barsy ids in URLs or files; ids opaque);
  - `docs/tracker.md` → D38, D61, P53 and the "Guest phone page (S3-03)" note;
  - `packages/db/src/schema.ts` (`places`: `place_num`, `salon_name`, `is_public`, `state`, `qr_token`);
  - `packages/core/src/apply/barsy-venues.ts` (`upsertPlaces`), `packages/core/src/guest-files.ts` (the token pattern and `t/<token>.json` schema);
  - `packages/assets/src/publish-*.ts` and `guest-files.ts` (`writeTableTokenFile`);
  - `apps/web/app/t/[token]/route.ts` and the guest page's table banner;
  - `docs/platform-reference.md` (pitfall 9: no hard-coded domains).

## Goal
The venue's **Маси и QR / Tables & QR** tab, replacing the placeholder. Every barsy table gets a QR code that opens the venue's menu with that table's context. Codes can be printed. The address inside a code is either **ours** (`<base>/t/<token>`) or **the venue's own link**, a URL on its domain that forwards to ours. A short guide explains both.

## Do
1. **Data:**
   - **Writers in `packages/core/src/apply/tables.ts`:**
     - `issueTableToken(place)` gives a new random opaque token (22 chars base62 from `crypto`), matching the core token pattern, unique;
     - `retireTableToken(place)` sets `qr_token = null`;
     - `issueAllTableTokens(venue)` for tables without a code;
     - `setTableLabel(place, label | null)` for an optional display label. Add a nullable `label` column on `places` (migration).
   - **Tokens never contain or derive from barsy ids.** A table that barsy deletes (state `deleted`) has its token retired at the next sync. Add that to the places conclusion; the token file goes too (step 2).
   - **Venue QR settings** in `venues.settings.qr`:
     - `mode`: `ours` | `own`;
     - `base_url`: our public base, default from env `PUBLIC_BASE_URL` (falls back to `BETTER_AUTH_URL`);
     - `own_pattern`: must contain `{token}` and be `https://` (or `http://localhost` / a private LAN address while building).
     - A writer + Zod schema.
2. **Token files:**
   - Add `delete(path)` to `PublishStore` (local + R2).
   - Add a worker job `publish-table-tokens {tenantId, venueId, retired: string[]}` that:
     - writes `t/<token>.json` `{venue_slug, table_label}` for every active token of the venue (idempotent);
     - deletes the files of the `retired` tokens.
   - The web actions enqueue it after every issue, retire or relabel. **The web never writes the publish store** (one writer).
   - **Table label:** the custom label, else `place_num` (a number shows as "Маса 12" / "Table 12" on the guest page; any other text as it is).
3. **Tab UI** (owner/admin act, others read only):
   - **Tables:** the venue's tables grouped by hall (`salon_name`, "No hall" last), each with label (editable), barsy number, public/hidden, and code status (none / active).
   - **Actions:** "Create codes for all tables", per table "Create code", "New code" (confirm: the printed sticker stops working) and "Turn off code".
   - **QR address card:** "Our link" vs "The venue's own link". Our link shows the base address (editable, with a hint: use this PC's network address, e.g. `http://192.168.x.x:3000`, to scan from a phone on the same Wi-Fi). Own link shows the pattern field with live validation, a preview of the final address for the first table, and an **"Open test link"** button that opens it in a new browser tab. **No server-side fetch of venue URLs.**
   - **Per table:** the QR as SVG in the row (click to enlarge), "Download PNG" and "Download SVG".
   - **Print sheet** `venues/[venueId]/tables/print`: A4, 2×3 cards per page. Each card: venue name or logo, table label, QR, the short address text, "Сканирайте за менюто / Scan for the menu". CSS `@page`, page breaks, and a "Print / Save as PDF" button. No PDF library.
   - QR rendering uses **`qrcode`** (approved 10-10, exact version, web only): error correction M, margin 2, dark-on-light only (QR codes must stay scannable whatever the theme).
4. **Guide:** `docs/guides/qr-links.md`, BG first then EN, plain language for a venue manager:
   - **Option 1, our link:** nothing to set up.
   - **Option 2, your own link:** a forwarding rule on your domain from `https://your-domain/t/*` to `https://<our address>/t/*` keeping the path, with step-by-step examples for Cloudflare (Redirect Rules), a typical hosting panel, and a website builder that supports redirects. Then enter the pattern, test with the button, print.
   - What happens if the forwarding breaks (stickers stop working). Never hard-code any domain.
   - Link it from the tab ("How do I use my own link?").
5. **i18n:** all strings BG + EN; add them to the T44 review list.

## Tests
- **Writers:** unique opaque tokens (property: no token contains a barsy id or `place_id`); retire; relabel; RLS; tokens retired when barsy deletes a table.
- **Job:** writes token files, deletes retired ones; idempotent.
- **Settings:** pattern validation (needs `{token}`, https or local only).
- **Components:** tab, address card, print page.
- **Playwright:**
  1. create codes for all tables → a row's QR decodes (use the `qrcode` library's data or decode the SVG's encoded text via the generator output in the test) to `<base>/t/<token>`;
  2. open `/t/<token>` → the menu with "Маса N";
  3. "New code" → the old `/t/<old>` shows "code not active";
  4. own-link pattern → the preview address uses the pattern;
  5. print page renders 6 cards per page.
- **Screenshots** to `.local/screenshots/s3/s3-07-*.png`.

## Done when
The full gate passes with DB tests (`CI=true`; your own database `restro_s3_07` on the running 54329 instance), and the Playwright spec passes.

## Allowed dependencies
`qrcode` (+ `@types/qrcode` if needed), exact versions, `apps/web` only.

## Never / scope
- **Scope:** `packages/core/**` (tables writers, settings), `packages/db/**` (one migration), `packages/assets/**` (`delete`), `apps/worker/**` (token job, deletion hook), `apps/web/**` (tab, print page, actions), `docs/guides/qr-links.md`, `messages/*.json`.
- **No server-side fetch** of venue-provided URLs.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
- **Report:** as in `docs/agent-briefs/_template.md`.
