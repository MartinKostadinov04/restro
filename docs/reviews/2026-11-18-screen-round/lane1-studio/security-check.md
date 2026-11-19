# Lane 1 security check (Fable, 2026-11-19)

Sources: `security-review` skill (Skill tool) over the lane's Studio paths, then `.claude/skills/restro-flow/audit-security.md` steps 1-6, statically. No high or medium finding; three low defence-in-depth rows.

- **SEC1 (low).** `placeItemAction` (`apps/web/src/composer/actions.ts:232-241`, ops `ops.ts:27-34`) checks only `itemId` against the venue. The other ids in `keys[]` become `setPlacement`s with no venue check, so a forged request can place another venue's items (same organisation) in this menu. `moveSectionAction` (244-252) has the same gap for section keys. Fix: every key id through `itemsOfVenue()` / `inMenu`, else `not_found`.
- **SEC2 (low).** `createSectionAction` (`actions.ts:255-269`) accepts an existing node id. `apply()` treats the `createNode` as unchanged, then overwrites the title in the manual layer whole, bypassing `renamePlan`'s override routing (D90), also for a till-mirrored section. Fix: refuse when `getNodeBasics(tenantId, id)` finds a node, as `createItemAction` does (line 287).
- **SEC3 (low).** `setItemTagsAction` (`tag-actions.ts:149-171`, core `apply/tags.ts:432-480`) does not check the items belong to the venue; unplaced items of any venue accept the tag, and clear/remove runs on any tenant node. Fix: `itemsOfVenue()` in the action, as `sold-out-actions.ts` does.

Clean: tenancy from the session, role checks on every write plus shared-device refusal, no RLS bypass, no POS ids in the composer, sheet, history or draft preview (rule 3), upload (origin check, size cap, magic bytes, server-built keys, nosniff, sandbox CSP), no XSS sink, redirects only to own paths, all writes through `apply()` or core writers.

Outside the lane (note only): `pnpm audit --prod` reports 11 advisories (4 high, 7 moderate): `undici` below 8.12.2, `next` up to 16.4.4 (two cache-leak advisories, fixed in 16.4.5), `esbuild` (dev server). Not run: two-organisation integration tests, fuzzing, local abuse step.
