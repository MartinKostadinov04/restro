# Design scan: where deeper modules would pay off

Read-only scan on 2026-10-16 (admin server code, worker sync/publish/purge, core apply/resolve/snapshot, the connector seam). Nothing was changed or run. "Deep module" here means a lot of behaviour behind a small, simple entry point, so a fix or rule lives in one place.

## Verdict
**Two things are worth doing before the pilot, both small: #1 and #2.** The code base is in good shape; there is no case for a wider rewrite. #3 and #4 are fine to schedule with the Mistral work (D79). #5 can wait.

## Candidates (most valuable first)

**1. "POS items cannot be deleted" is enforced in the screens, not in the one write path.** (D89, D92, rule 1)
- Where: `apps/web/src/server/composer/structure.ts` (`isTillLinked`, `deleteSectionPlan`), `apps/web/src/composer/actions.ts:409`, `view-model.ts:280`, `server/item-sheet/service.ts:161`. "Does this come from the POS?" is written out five times, and `apply()`'s `setNodeStatus` (`packages/core/src/apply/apply.ts:1379`) has no such check that I found.
- Risk: any future action (or import) that forgets the check could archive a POS section or item.
- Shape: `apply()` refuses a manual archive of a POS-linked node; one shared "is POS-linked" helper in core; the screens keep their friendly early message.
- Dependency kind: in-process / local-substitutable (Postgres). Size: small to medium, one afternoon plus tests. Verify my reading of `apply.ts` first.

**2. Erasure has no "nothing left behind" test.** (D83, purge)
- Where: `apps/worker/src/jobs/purge.ts` lists, by hand, every table a venue owns; `apps/worker/tests/purge.test.ts` checks a hand-picked few. A new venue-owned table added later would silently survive "Delete permanently".
- Shape: mark venue-owned tables in `packages/db/src/table-access.ts` and add one test that purges a filled venue and finds zero rows left anywhere. Not a refactor, a guard.
- Kind: local-substitutable. Size: small.

**3. "Which source does this venue have?" is asked in seven places, each with its own join.** (D82, D87, glossary "Source")
- Where: `server/integration/service.ts` (4 times), `server/publish/load.ts:508` (imports the vendor table name directly), `server/tables/service.ts:93`, `server/venues.ts`. The same table alias `tillVenueLinks` is also defined three times (core, web, worker).
- Shape: one read in core, `venueSource(venueId)`, returning hand-made, or instance + POS venue + label. Callers stop joining tables.
- Kind: local-substitutable. Size: medium (about 8 call sites). Best done as preparation for Mistral.

**4. Every admin server action repeats the same 30 lines.**
- Where: 23 copies of the same try/catch, six private `perform` helpers (`tables/actions.ts`, `publish/actions.ts`, `composer/actions.ts`, `integration/actions.ts`, `design/actions.ts`, `guest-features-actions.ts`). Each re-does sign-in check, role check, "is this my venue", error log, page refresh.
- Shape: one wrapper that does these steps; each action keeps only its input check and its call.
- Kind: in-process. Size: medium but mechanical; low risk because the action tests already exist. Mostly tidiness, but a forgotten role check is a security bug, so it also helps safety.

**5. Three near-identical "save one venue setting" writers.**
- Where: `core/src/apply/venue-theme.ts`, `presentation.ts`, `guest-features.ts` (and partly `languages.ts`): each has its own error class, venue lock and "replace one key of `venues.settings`".
- Shape: one small helper. Kind: in-process. Size: small. Low value; do it when a fourth appears.

## Leave alone
- **`apply()`**: one entry, many rules behind it. Deep. (Candidate 1 only adds a rule inside it.)
- **Resolver and snapshot builder** (`core/src/resolve`, `snapshot`): a small entry (`resolve`, `buildSnapshot`) hiding the layer rules; the leak guard sits at the exit.
- **Venue sync/publish settings** (`core/src/sync-settings.ts`): the "venue's own setting, else the instance's" rule is already in one place and used by web and worker alike.
- **Purge rules** (`core/src/purge.ts`, pure) and the three-way database split (read / write / purge).
- **The connector seam itself.** Only one connector exists, so a formal plug-in interface now would be a guess. The barsy-shaped parts (`apps/worker/src/jobs/barsy.ts`, the 350-line `syncFetched` in `sync/catalogue.ts`) should be reshaped when Mistral is the second real case, not before (D79 parks it).
