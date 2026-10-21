# Brief CF-08a: guardrails first (workspace guard, one vendor-word test, fixtures lint exclusion, PR template)

- **Model:** Sonnet 5.5. **Branch:** your worktree branch, from `cf/foundation`.
- **Read first:**
  - `CLAUDE.md`;
  - `docs/tracker.md` → D67, T70;
  - `docs/reviews/connector-architecture/A6-guardrails.md`: findings F2, F7, F9, F11; §5.4 (the vendor-word test design); §5.2, the "Pinned by non-dependency-cruiser tests" bullets; adjustments G1, G2, G11;
  - `scripts/depcruise-rules.test.ts` (house style for repo-wide tests);
  - `vitest.config.ts`, `pnpm-workspace.yaml`, `biome.json`, `packages/barsy/fixtures/biome.json`, root `package.json`.
- **Why:** before we move barsy into a connector package and add a second one, the repo must fail loudly when:
  - a new package is silently left out of tests and typecheck (A6-F2);
  - a vendor word leaks into code that must be neutral (A6-F7).

  Today neither is checked.
- **Out of scope:**
  - dependency-cruiser rules (they change with the package move);
  - the conformance kit;
  - any renaming of existing code.

## 1. Workspace guard (G1)

- **Test:** add `scripts/workspace-guard.test.ts` (it runs in the existing `scripts` Vitest project). It finds every `package.json` under `apps/` and `packages/` (any depth, excluding `node_modules`) and asserts each one is:
  1. matched by a glob in `pnpm-workspace.yaml`;
  2. a Vitest project: read the list `vitest.config.ts` builds, or replicate its discovery in a tiny shared helper both use. Never duplicate the folder list by hand; export it from one place;
  3. has a `tsconfig.json` and a `typecheck` script.
- **Today:** it must pass on the current tree.
- **Self-test:** add a case that builds a fake tree in a temp dir with a `packages/connectors/x/package.json` and expects the guard to fail. That shows `packages/connectors/*` is not covered today.
- **Don't add the `packages/connectors/*` glob yet:** CF-06 does that with the first such package.

## 2. One vendor-word test (G2)

**Files:**
- `scripts/vendor-words.test.ts`;
- `scripts/vendor-words.config.ts`;
- `scripts/vendor-words.baseline.json`;
- a root script `pnpm vendor-words:baseline` that rewrites the baseline. The test never writes it.

**What and how** (A6 §5.4):
- **Words:** `barsy`, `lukanet`, `mistral`, `zamboo`, case-insensitive, also inside identifiers (`linkedToBarsy` counts).
- **Tokenising:**
  - use the TypeScript compiler API already installed at the root (`typescript`); no new dependency;
  - count identifiers, string literals, template literal parts and JSX text in `.ts`/`.tsx`;
  - **skip comments**;
  - in `apps/web/messages/*.json`, count words in every key path and string value.
- **Scope:** non-test code only. Skip `*.test.*`, `*.spec.*`, `tests/`, `testing/`, `e2e/`, `scripts/`, `fixtures/`, `migrations/`, `node_modules/`, `.next/`.
- **Zones** (config):
  - `published`, **wall**: 0 allowed. `packages/shell/src`, `packages/faces/*/src`, `packages/core/src/snapshot`, `apps/web/src/guest`, `apps/web/app/m`, `apps/web/app/t`, `apps/web/app/cdn`, `packages/assets/src`;
  - `core`, **ratchet**: `packages/core/src`, allowing `packages/core/src/connectors/**`;
  - `db`, **ratchet**: `packages/db/src`;
  - `web`, **ratchet**: `apps/web/src`, `apps/web/app`, `apps/web/messages`, allowing message keys under `connectors.<kind>.*` and `apps/web/src/connectors/**`;
  - `worker`, **ratchet**: `apps/worker/src`, allowing `apps/worker/src/connectors.ts`;
  - the connector's own package (`packages/barsy` today, later `packages/connectors/<kind>`) is allowed its own word, but **another** kind's word fails (cross-kind).
- **Baseline:** `{ "<file path>": <count> }` for ratchet zones only.
  - The test fails if a file's count is **higher** than its baseline, or if a file with hits has no entry.
  - It also fails if the count is **lower** than the baseline ("stale entry: lower it with `pnpm vendor-words:baseline`"), so the baseline only shrinks (D67).
  - The baseline script refuses to raise any number unless run with `--allow-increase` (only the lead uses it, when merging older branches).
- **Banned patterns:** in `packages/barsy/src` (non-test), fail on `parseFloat(`, `.toFixed(`, `* 100`. Report hits, expect 0 today. If a legitimate use exists, stop and ask; don't allow-list it yourself.
- **Error message:** file, line, word and zone, plus one sentence: "Vendor words belong only in a connector's own package or `core/src/connectors/`; see D67."

## 3. Biome and fixtures (G1)

- Add `!**/fixtures/**` to the root `biome.json` `files.includes`.
- Delete `packages/barsy/fixtures/biome.json`.
- `pnpm lint` must stay green, and no fixture byte may change (check `git diff --stat packages/barsy/fixtures` is empty).

## 4. PR template (G11)

- `.github/pull_request_template.md`:
  - "What changed for Martin" (plain language);
  - "Tests run";
  - a checklist "Guardrails touched?" listing `.dependency-cruiser.cjs`, `scripts/*.test.ts`, `scripts/vendor-words.baseline.json`, any `write/` folder, `packages/db/migrations/`, `CLAUDE.md`. If any is ticked, say why and who approved (D67).
- Keep it short.

## Done when

- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass (DB tests not needed for this brief, but don't break them).
- **Current state:** the vendor-word test passes on the current tree with the generated baseline, and a test case proves a new hit in the `published` zone fails.
- **Report:**
  - in the CLAUDE.md format;
  - the baseline totals per zone;
  - the self-test cases.

## Never / scope

- **Dependencies:** none new.
- **Secrets:** never read `E:\Restro\.env.local`.
- **Code:** don't change application code to lower counts; that's for later briefs.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
