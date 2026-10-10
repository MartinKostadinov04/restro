# Brief S2-03a: credential sealing + link state + deletion rule (core)

- **Model:** Opus 5.5 (security + rule 6). Kept small on purpose; the job plumbing is S2-03b (Sonnet).
- **Branch:** your worktree branch from `s2/composer`.
- **Read first:**
  - `CLAUDE.md`;
  - `docs/tracker.md` → D41, D50 (P38), D55, D56, and the Stage 2 engineering notes (S2-01 and resolver bullets);
  - `docs/architecture/data-architecture.md` → "The full pull, per venue" (step 8), "Link lifecycle", "Failure modes and guarantees";
  - `packages/core/src/change-set.ts` and `packages/core/src/apply/*`, including `moveNode` and the structural events that S2-06a added;
  - `packages/db/src/schema.ts` (`integrations`, `source_links`, `events`, `places`) and `packages/db/src/table-access.ts`;
  - `packages/barsy/src/mapping/` (S2-02): `linkStates` intents and the `onlyIfUnplaced` flag;
  - `.dependency-cruiser.cjs`.

## Goal
Three pieces that sync jobs (S2-03b) build on, each with strong tests:
- sealed barsy credentials (the web can seal, only the worker can open);
- link-state changes through `apply()`;
- placement that never undoes the manager's arrangement;
- a pure function that decides rule 6.

## Do
0. **Modifier-group link type (S2-02's question 1, decided by the lead):**
   - **Fix:** add `modifier_group: ['supplement_group']` to `BARSY_LINK_TYPES` in `apply()`. Today every barsy-layer write on a group is refused as `not_linked`.
   - **Link ids:** the mapper links groups as `supplement_group` `<articleId>:<groupId>` and options as `supplement` `<articleId>:<groupId>:<optionArticleId>`.
   - **Acceptance test (integration):** apply the whole `mapCatalogue` output for the bid-10 fixtures, with the synthetic burger 7183 from S2-02's `test-data.ts`, on an empty menu. Expect **zero refused writes** and the counts S2-02 reported: 11 sections, 58 items, 58 placements; the burger has 4 groups and 14 options.
1. **Sealing (`packages/core/src/seal/`), using Node `crypto` only.**
   - **Scheme:** X25519 ephemeral ECDH → HKDF-SHA256 (salt = ephemeral public key ‖ recipient public key, info `restro-seal-v1`) → AES-256-GCM with a random 12-byte nonce.
   - **Envelope:** `rs1.<kid>.<ephPub>.<nonce>.<ciphertext+tag>`, base64url. `kid` = first 8 bytes of SHA-256 of the recipient public key, so a rotated worker key gives a clear "sealed for another key — reconnect" error.
   - **AAD:** `restro-seal-v1|<tenantId>|<integrationId>|<host>`. A sealed blob copied to another tenant or integration, or left in place after the host changes, fails to open. The worker must never send credentials to a host they were not sealed for.
   - **API:**
     - `sealSecret(publicKey, plaintext, aad) → string`, exported from `@restro/core` (or a `seal` subpath);
     - `openSecret(privateKey, sealed, aad) → string`, exported **only** from a separate subpath (e.g. `@restro/core/seal-open`);
     - a dependency-cruiser rule that only `apps/worker` may import the open subpath, plus a test proving `apps/web` cannot.
   - **Credentials helpers:** `sealBarsyCredentials({user, password}, ctx)` and `openBarsyCredentials(sealed, ctx)`, with Zod on the opened JSON.
   - **Keys:** env `SEAL_PUBLIC_KEY` (web and worker) and `SEAL_PRIVATE_KEY` (worker only), each base64url DER (spki / pkcs8).
     - Add them to `.env.example` with comments.
     - Parse them in the worker's Zod config. The private key is required when the worker runs sync jobs.
     - The web config never declares `SEAL_PRIVATE_KEY`, with a test that it is absent.
   - **Key script:** `pnpm keys:seal` generates a pair. With `--write-env <file>` it appends both keys to that file when absent and prints **only** the public key and the file path, never the private key.
   - **Tests:** round trip; a tampered byte in any part fails; wrong AAD fails (tenant, integration, host); wrong key fails with the kid error; nonce uniqueness over many seals; the envelope never contains the plaintext.
2. **`setLinkState` op** (change-set schema + `apply()`): `{ op: 'setLinkState', link: SourceLink, state: 'active' | 'missing' | 'deleted' }`.
   - **Transitions:** follow the Link lifecycle table. Writing the same state is a no-op without an event. Every other transition writes a structural event (`op`, old → new).
   - **`missing` since:** add `state_changed_at timestamptz not null default now()` to `source_links` (migration, existing privileges kept) and update it on every transition. S2-03b needs it for the "missing for 7 days → deleted" step.
   - **Enrichment:** a state change never touches field values, overrides or placements (enrichment is kept, rule 6). Hiding and showing are the resolver's job, which already ignores nodes whose link is missing or deleted.
   - **Unknown link:** refused, with a reason in `ApplyResult`, never thrown mid-batch.
   - **`lastSeenAt` / `lastHash`:** update them when the op carries `seenAt` / `hash` (optional fields), so S2-03b can mark "seen in this pull" without a second write path.
3. **`onlyIfUnplaced` on `setPlacement`:** skip the placement (no-op, counted as `skipped`) when the node already had at least one placement in the same menu **before this change set started**. Placements created earlier in the same change set don't count, so a first import still places an item in every category it belongs to. A re-sync never reorders, re-adds or moves anything the manager arranged. Integration tests:
   - first import with an item in two categories → two placements;
   - the manager moves the item → re-sync changes nothing;
   - the manager reorders a section → re-sync changes nothing;
   - a brand-new item in a later sync → placed at the end.
   - Known edge, documented in code: an item the manager unplaced everywhere is placed again by the next sync. Report it; don't solve it.
4. **Rule 6 as a pure function** (`packages/core/src/sync/conclude-full-pull.ts` or similar): `concludeFullPull({ pagesOk: boolean[], seen: Set<key>, links: {key, state, stateChangedAt}[], deletedSeen: Set<key>, now, missingToDeletedAfterDays = 7 }) → { complete, changes: {key, to}[] }`.
   - **Any failed page:** `complete = false` and **no** `missing` or `deleted` changes at all. Reactivations of links seen in this pull are still allowed (being seen is positive evidence).
   - **Complete pull:** `active` and absent → `missing`; `missing` for ≥ 7 days and still absent → `deleted`; in `deletedSeen` (barsy `delete_flag`) → `deleted`; `missing`/`deleted` and seen → `active`.
   - **Deterministic:** sorted output.
   - **fast-check properties:**
     - any failed page ⇒ no link ever moves to missing or deleted;
     - a seen key never ends missing;
     - output is independent of input order;
     - applying the result twice changes nothing.

## Done when
- The full gate passes, with DB tests on local Postgres (`CI=true`): `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build`.
- The migration is generated with `pnpm db:generate` and checked in.
- `table-access` tests still pass.

## Allowed dependencies
None new (Node `crypto`, existing fast-check).

## Never / scope
- **Scope:** `packages/core/**`, `packages/db/**` (the migration only), `.dependency-cruiser.cjs`, `.env.example`, root `package.json` scripts (`keys:seal`), and the worker config parse for the two env vars.
- **Not in scope:** no jobs, no barsy calls, no web UI.
- **Secrets:** never log or print key material or plaintext, and never read `E:\Restro\.env.local`.
- **Local DB:** `pnpm db:local` on port 54329. If the port is busy, reuse that instance with your own database `restro_s2_03a`. Stop only your own instance and leave nothing running.
- **Git:** commit as you go (`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); never push.
- **Report:** as in `docs/agent-briefs/_template.md`, plus one line on any edge case you chose to leave.
