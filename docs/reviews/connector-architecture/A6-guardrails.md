# A6: Guardrails, tests and docs, readiness for a multi-connector architecture

Reviewer A6 · read-only · 2026-10-11 · `E:\Restro` at `4a98a4b` (`cf/foundation`) · paths relative to the repo root. **Fact** = seen in code or config. **Inference** = my reading. Nothing was run or written. No `.env*` file was opened.

## 1. Scope read

- **Docs:**
  - CLAUDE.md; tracker D38-D65 and T47-T70; `readiness.md` (the lead's CF-01...CF-13 roadmap); briefs `_template`, `s1-04`, `s2-03b`, `s3-07`, `cf-02`, `cf-03`.
  - All other reports (R0, A1-A5, B1) and `prompts.md`.
  - README; `stack.md` ("Repository and boundaries", "How the nine rules are enforced"); outline of `data-architecture.md`.
- **Guardrail config:** `.dependency-cruiser.cjs` and `scripts/depcruise-rules.test.ts` (both in full), `vitest.config.ts`, `pnpm-workspace.yaml`, `biome.json`, root `package.json`, `.github/workflows/ci.yml` (+ head of `freeze-check.yml`), `tsconfig*.json`, `.github/` listing.
- **Barsy test assets:**
  - `packages/barsy/src/{testing/mock-server,fixture,fixture-files,read-methods}.ts`, `record/{run,cli}.ts`, `write/index(.test).ts`.
  - `mapping/catalogue.test.ts`, `read/reader.test.ts`, and the heads of `client.test.ts` and `mapping/apply.integration.test.ts`.
  - The fixture listing and `barsys.json`.
  - `apps/worker/tests/{fake-barsy,world,database}.ts` and the test names of `sync-full-pull.test.ts`.
- **Other suites:**
  - `packages/shell/testing/{contract,index}.ts` and `contract.test.ts`; `qr-phone/face.test.tsx`.
  - `core/resolve/{properties.test,fixtures}.ts`, `core/sync/conclude-full-pull.test.ts`, `core/change-set.ts`.
  - `db/tests/{rls-guard,app-role}.test.ts`, `db/src/{table-access,package-boundaries}.test.ts`.
- **Vendor-word counts** (`git grep -i barsy`, non-test code, lines/files): core 436/46; web/src 313/60; web/messages 188/2; worker/src 208/19; db/src 42/3. `packages/shell`, `packages/faces` and `apps/web/app` have 0. The snapshot folder has 3 comment lines and `packages/assets` has 1.

## 2. Scorecard

**Which guardrails keep connector #2 honest today, and which would not cover it**

| Neutral, cover connector #2 automatically (Fact) | Barsy-named, do not cover it (Fact) |
|---|---|
| `db-write-only-from-core-apply`, `db-entry-points-only`, `db-read-side-no-write`, `seal-open-only-from-worker`, `packages-never-import-apps`, `guest-page-reads-published-files-only`, `no-circular` (`.dependency-cruiser.cjs:73-97,118-134,156-183`) | `barsy-only-from-worker`, `web-no-barsy` (`:100-113`), the barsy entries inside `pure-layers-no-data-or-apps` (`:46-47`) and `assets-no-database-or-barsy` (`:145-146`) |
| `rls-guard`, `TABLE_ACCESS` equality, `app-role`, `tenant-isolation` tests (new tenant tables are checked at once) | DB checks on layer, source and kind (`schema.ts:325`, `change-set.ts:388-392`); rule-5 test builders hard-code layer `'barsy'` (`resolve/properties.test.ts:105-149`, `fixtures.ts:27`) |
| Strict snapshot schema, leak guard fed from all `source_links`, face contract id check (`shell/testing/contract.ts:67,181-184`) | Write allowlist test (`barsy/src/write/index.test.ts:11-25`), read allowlist (`read-methods.ts`), recorder, MSW harness, `FakeBarsy`, `BARSY_*` host policy (README:70-72) |
| `concludeFullPull`, `money` and `change-set` tests (source-free); gitleaks (`ci.yml:84-89`); lint, typecheck, test and build gates | CLAUDE.md wording (F8) |

**Part 8, contracts and tests, by guardrail area: overall 2**

| Area | Score | Evidence |
|---|---|---|
| Import rules for db, shell, faces, guest page, seal | 4 | Each rule has a case, and the rule set is pinned (`depcruise-rules.test.ts:443-448`) |
| Import rules that name a connector | 1 | They name barsy and restrict nothing a connector may import (F1) |
| Face contract suite | 4 | `contract.ts:229-266`, self-tested with broken faces (`contract.test.ts:160-300`). This is the one shared-suite pattern in the repo |
| Core property tests: rule 6, 8, 5 | 4, 4, 2 | Rule 6 and rule 8 are source-free; rule 5 is written in `'barsy'` terms |
| Connector conformance | 0 | The generic assertions sit inside barsy tests (`catalogue.test.ts:62-134,726-795`) (F4) |
| Fixtures, recorder, replay harness | 2 | Works, but barsy-shaped and without redaction or a facts list (F5, F6) |
| Docs for agents | 2 | CLAUDE.md is barsy-worded and partly stale; the briefs are good; there is no connector guide |

**Cross-cutting**

| Check | Score | In depth |
|---|---|---|
| Tenancy / RLS | 4 | `rls-guard.test.ts` reads the live catalog. The guard forbids SECURITY DEFINER (`:137-150`), so A5-P6 needs a pinned exception (F12). DB suites skip locally without the env and are required in CI (`worker/tests/database.ts:58-65`) |
| Secrets per connection | 3 | `seal-open-only-from-worker` is pinned (`depcruise-rules.test.ts:311-346`). The "never logs the password" tests are barsy-only (`client.test.ts:511-524`, `sync-connect.test.ts:140-158`) |
| Observability | 2 | Scrubbed run summaries are tested. No test says every run records connection, location and a kit error kind |
| UI by capabilities | 1 | No guardrail at all; 47 web tests name barsy (A4) |
| No over-engineering | OK | My kit is sized for 3-5 connectors (see 5.1, "not built") |

Other parts, guardrail view only:

| Part | Score | Evidence |
|---|---|---|
| 1 Own model | 2 | No vendor-word test (F7) |
| 2 Connector plug | 1 | No registry-coverage test |
| 3 Stages | 2 | Rejected rows are tested; there is no replay test |
| 4 Own ids | 4 for snapshots, 1 for tables | Tables have no id test |
| 5 Connections and venues | 2 | No test |
| 6 One engine | 2 | The pure rule-6 tests are strong; the engine tests are barsy-bound |
| 7 Write-back | 0 | The guard is barsy-only |

## 3. Findings

| Id | Severity | F/I | Where | Why it matters |
|---|---|---|---|---|
| A6-F1 | blocker (2nd connector) | Fact | `.dependency-cruiser.cjs:46-47,100-113,145-146` | Every connector rule names `barsy`. A package `packages/<other-till>` could be imported by `apps/web`, the shell or a face. It could itself import `@restro/db`, `@restro/assets` or the seal. No rule would fail. |
| A6-F2 | blocker | Fact (config), Inference (effect) | `vitest.config.ts:9`, `pnpm-workspace.yaml:1-4`, `package.json:14` | Workspace globs and Vitest projects stop at `apps/*`, `packages/*`, `packages/faces/*`. A package at `packages/connectors/<kind>` (A3's layout) is not a workspace member and not a Vitest project. With `pnpm -r --if-present` it is not typechecked either. Its tests never run and `pnpm test` stays green. `deps:check` (`:17`) would still see it. |
| A6-F3 | significant | Fact | `barsy/src/write/index.test.ts:11-25`; `read-methods.ts:10-47`; `record/run.ts:78`; CLAUDE.md:85 | The rule-7 guard and the "doc URL on every call" convention live in barsy files. The URL is only a comment, so nothing checks it. "Official docs" cannot be met for Mistral (T69). |
| A6-F4 | significant | Fact | `catalogue.test.ts:62-134,726-795`; `worker/tests/fake-barsy.ts`; `sync-full-pull.test.ts:217,312-446` | No conformance suite. Contract, provenance, scope and determinism checks are in barsy's mapping tests. Rule 6, idempotency and cursor behaviour run only against `createFakeBarsy`. |
| A6-F5 | significant | Fact | `mock-server.ts:66-71,117-131`; `fake-barsy.ts:13` | The replay harness serves one fixture per method and ignores params and `bid`. The worker has a second, separate model of barsy. The request actually sent was never recorded (B1-F11). Four of five places recordings are unused (B1-F24). |
| A6-F6 | significant | Fact | `fixture.ts:5,20-39`; `record/run.ts:98-106`; `fixtures/demo/barsys.json`; brief `s1-04` ("Out of scope"); `ci.yml:84-89` | Bodies are stored byte for byte with no redaction step. The "no personal data" rule is one sentence in a brief. The only automatic scan is gitleaks (secrets, not people). `barsys.json` carries a venue phone, address and website. No facts-to-verify list exists; unverified shapes sit in comments and tracker items (T48, T59, Q60, Q71). |
| A6-F7 | significant | Fact | counts in section 1; `worker/src/publish/after-sync.ts:20,113-146`; `web/src/server/publish/{load,service}.ts` | No vendor-word test. The published surface is clean only by convention, and about a dozen code lines in three publish-producer files name barsy. Four overlapping tests are proposed (A1-P2, A4-P15, A5-P13, the bespoke core test in `cf-03`). |
| A6-F8 | significant | Fact | CLAUDE.md:3,7,12,15,32,56-64,67-70,85,90-92,100; `_template.md:5,12`; README:3,51; `stack.md:79-101` | Rules and boundaries are barsy-worded. Some pointers are stale: "decisions D1-D50" (tracker has D65), "Stage 1" (Stage 3 accepted, tracker:197-205). The brief template's gate omits `pnpm deps:check`, which CLAUDE.md:34 requires. |
| A6-F9 | significant | Fact + Inference | `.github/` (two workflows); tracker:312 | There is no CODEOWNERS and no PR template, and branch protection is not enforced on this repo. The agent can edit the guardrail it is held to. The only barrier is the lead's diff review (CLAUDE.md:3) and the self-pinning test. A vendor-word baseline adds one more "edit the list" path. |
| A6-F10 | minor | Fact | `worker/tests/sync-full-pull.test.ts:17`; `worker/src/sync/chunk.test.ts:8-15` | Worker tests deep-import barsy internals (`mapping/ids.ts`, `catalogue.ts`, `test-data.ts`). There is no counterpart of `db-entry-points-only` (`:80-89`) for connectors. |
| A6-F11 | minor | Fact | `biome.json:8-21`; `packages/barsy/fixtures/biome.json` | Recorded JSON is exempt from Biome only through a per-folder file. A new connector without the copy fails `pnpm lint`. "Fixing" it by formatting changes recorded bytes. |
| A6-F12 | minor | Fact | `rls-guard.test.ts:137-150`; `worker/tests/database.ts:58-65` | The RLS guard forbids SECURITY DEFINER, which A5-P6 needs at Stage 4. DB-backed suites skip locally, so the engine tier cannot be the only tier of conformance. |
| A6-F13 | minor | Fact | README:70-72; `worker/src/sync/host-policy.ts` | Rule 9 host policy is `BARSY_*` configuration tested for barsy only. It is not a manifest property every connector must declare and pass. |

## 4. Walk-through: the nine rules, for an agent writing connector #2

Today the repo pushes back only by *failing*, by accident. `integrations_kind in ('barsy')` (`schema.ts:325`) and `layerAllowedForSource` (`change-set.ts:388-392`) stop a Mistral connector from writing at all. The path of least resistance is to relabel it "barsy" (silent false provenance, Inference), or to edit core. Nothing says stop.

| Rule | Today: what stops the agent | After the proposals |
|---|---|---|
| 1 One write path | Neutral and enforced: `:73-97`, cases at `depcruise-rules.test.ts:176-292`. Not stopped: a connector reading the db (F1). | `connectors-isolated` forbids db, assets, `core/apply` and the seal for connectors. |
| 2 Provenance | Accidental only (above). | After CF-03 the layer is neutral. Check `provenance`: source `till:<connection>`, every till write cites a record in the same output and the manifest's `mappingVersion`. The kind must be in the registry. |
| 3 Source ids stay in the backend | Snapshot schema, leak guard and face id check are neutral and strong. Not covered: table labels in `t/<token>.json` (A5-F7), `venues.settings`, run notes. | Check `rule-3` on the connector's output (K7). The `published` vendor zone. Labels go through the guard (A5-P12). |
| 4 Shell reads only snapshots | Neutral, enforced (`:36-69,156-174`). Gap: shell or faces could import a non-barsy connector (F1). | `pure-layers-no-data-or-apps` lists `^packages/connectors/` and `^@restro/connector-`. |
| 5 Only more cautious | `validateWrite` and the resolver are neutral in logic, barsy in names. Nothing checks a connector's output. | `till` layer (CF-03). Check `rule-5` (K8). Property tests over three shapes (G9). |
| 6 Absence needs a complete read | `concludeFullPull` is pure and tested. The engine around it is inside `sync/catalogue.ts:451-508`; the CF-02 hold is barsy-only. | The engine owns it (CF-07). K9 plus engine tests E1/E2 run for every registered connector. Residual: a connector can lie about completeness; backstops are the 30 % hold and the facts list. |
| 7 No source writes | Barsy only. A new connector may send any request. | Manifest outbound allowlist plus the replay server (K10, K11). Per-connector export list equal to `APPROVED_WRITES[kind]`, which is `[]` today. |
| 8 Money | `money` module and tests. Float code is absent today (0 hits for `* 100`, `parseFloat`, `toFixed`). Zod `.int()` misses a rounding error such as `Math.round(1.005*100)` (Inference). | K8 table of decimal strings to minor units. A banned-pattern zone at 0 hits for `packages/connectors/*/src`. |
| 9 Accounts | Barsy only (F13). | `policy.hosts` in the manifest, kit `assertHost`, K13. `seal-open-only-from-worker` is unchanged. |

## 5. Proposed adjustments

### 5.1 Connector conformance kit

**Placement.** `@restro/connector-kit/testing`, the same pattern as `@restro/shell/testing` and `@restro/barsy/testing`, so msw stays out of the package index.
- It **reuses** the `runFaceContract` / `assertFaceContract` shape: a report with rule codes, and one error listing every failure.
- It **reuses** `createBarsyMockServer`, generalised to be params-aware and `bid`-aware.
- It **reuses** the `FakeBarsy` hooks, generalised into a `FakeSource` interface.
- It **reuses** the existing barsy tests as the source of the checks.

Each connector runs the suite in about 15 lines:

```ts
// packages/connectors/<kind>/src/conformance.test.ts
import { assertConnectorConformance } from '@restro/connector-kit/testing'
import { connector } from './index'
import { spec } from './testing' // cassettes, good/bad credentials, venue ids, field coverage, facts, FakeSource
it('passes the connector conformance suite', () => assertConnectorConformance(connector, spec))
```

**Checks.** P = pure tier (no DB, runs everywhere). E = engine tier (DB, `apps/worker/tests`, looped over the static registry). All are written against A3's contract names.

| Id | Check | Source of the check | Tier |
|---|---|---|---|
| K1 | Manifest valid. Capabilities match implemented steps. Link types per node type. Policy hosts and limits. Every outbound entry has a name, access mode and a doc URL or recording. Message keys exist in bg and en. | rules 7, 9; A4 | P |
| K2 | `connect`: good credentials pass; bad ones give kit kind `auth` with a `userMessage`; a missing right gives `config`. | R0; B1-F10 | P |
| K3 | `discover` twice gives the same location ids in the same order. | R0 | P |
| K4 | `translate` twice is deep-equal. Shuffled input is equal. One changed record changes only its own record id. | `catalogue.test.ts:726-795` | P |
| K5 | Output passes `ChangeSetSchema`. Source is `till:<connection>`. `validateWrite` per node type. | `:62-118` | P |
| K6 | Every till write cites an emitted source record and the right `mappingVersion`. | rule 2 | P |
| K7 | No external id from the cassettes appears in any non-link write, node id, scope or sort key (exact match; manifest-declared public text excluded). | rule 3 | P |
| K8 | `true` flags only when the capability is declared. Venue scope is the supplied `vn_`. Prices are integer `amount_minor`. Decimal-string table gives the expected minor units. | rules 5, 8; `:119-134,421-452` | P |
| K9 | Full read over replay gives `complete: true`. A failing page gives `complete: false`. An empty cassette does not throw. | rule 6 | P |
| K10 | Replay: every outbound request matches a cassette (method, path, canonical params). Two full reads give hash-identical records. | B1-F11; R0 | P |
| K11 | All requests are within the manifest allowlist and none is a write. `write/index.ts` exports equal `APPROVED_WRITES[kind]`. | rule 7 | P |
| K12 | A sentinel secret never appears in an error, log line or `userMessage`. Messages carry no URL query. `classify` maps every error. | `client.test.ts:511-524` | P |
| K13 | Staging refuses a listed production host and a wrong suffix. | rule 9 | P |
| K14 | Every field path in the cassettes is `mapped`, `raw` or `dropped(why)`. Each mapped field has a non-empty sample. | B1 rule 10 | P |
| K15 | `facts.ts` is valid. A `verified` entry has evidence that resolves. The count of `assumed` is printed. | B1 rule 1 | P |
| K16 | `FakeSource` answers each recorded request like the cassette. | B1-F24 | P |
| K17-18 | Quarantine property; raw round trip. | B1-L2; A3-P3 | P, later |
| E1 | Failed page concludes nothing. Removal gives `missing`, then `deleted` after 7 days. Race guard. | `sync-full-pull.test.ts:312-446` | E |
| E2 | An empty read, or one hiding more than 30 % (at least 5), concludes nothing. | CF-02 | E |
| E3 | A second run is all no-ops. | `:217` | E |
| E4 | The cursor advances only on success. A scope change forces a full read. A far-future cursor gives nothing. | CF-02; R0 | E |
| E5 | The run row carries connection, location, kind and counters. An auth error stops retries. | A3 | E |
| E6 | Only the connection's own host is contacted. | `:564` | E |

**The suite tests itself**, as the face contract does (`contract.test.ts:160-300`). The in-memory reference connector passes. Ten hand-written mutants each fail with exactly their code:
- completes after a failed page (K9);
- writes `true` from the manual layer (K5/K8);
- leaks an external id (K7);
- float money (K8);
- an unlisted request (K10/K11);
- nondeterministic ids (K4);
- missing provenance (K6);
- a secret in an error (K12);
- external id in scope (K8);
- an exported write (K11).

The reference connector is also the second implementation the contract needs (T68).

**Meta-test.** A repo test fails if a registered kind has no `conformance.test.ts`, no `write/index.ts`, or no engine-tier case.

**Not built:** plugin loading, a scaffold generator, live sandboxes in CI (R0), coverage thresholds, a mutation-testing framework, per-connector CI jobs.

### 5.2 Dependency rules

These replace the barsy rules in the same PR that moves the package (CF-07). The kit-only rule ships with CF-06 and fires on two fake connectors (`alpha`, `beta`) in the test. `scripts/depcruise-rules.test.ts` gets a case for each rule, "as written and by path" (its existing style). The existing coverage test (`:443-448`) then demands a case per rule.

| Rule | From | To |
|---|---|---|
| `connectors-only-from-worker` (replaces `barsy-only-from-worker` and `web-no-barsy`) | pathNot `^apps/worker/`, `^packages/connectors/` | `^packages/connectors/`, `^@restro/connector-(?!kit(/\|$))` |
| `connector-kit-only-above-core` | `^packages/(core\|db\|shell\|faces\|assets)/`, `^apps/web/` | `^packages/connector-kit/`, `^@restro/connector-kit` |
| `connectors-isolated` | `^packages/connectors/([^/]+)/` | `^packages/(db\|assets\|shell\|faces)/`, `^apps/`, `^@restro/(web\|worker)`, `^packages/core/src/(apply\|seal)/`, `^@restro/core/(apply\|seal)` |
| `connectors-not-each-other` | `^packages/connectors/([^/]+)/` | `^packages/connectors/`, pathNot `^packages/connectors/$1/` (capture-group back-reference; unused in this repo so far, so its pinned case proves it first; Inference) |
| `connectors-no-io-builtins` | `.../src/` outside `testing`, `record` | `NODE_IO_BUILTINS` (`.dependency-cruiser.cjs:13-24`) |
| `connector-entry-points-only` (mirror of `:80-89`) | outside the connector | `src/` except `index.ts` and `testing/index.ts` |
| `pure-layers-no-data-or-apps`, `assets-no-database-or-connectors` (edited) | unchanged | the barsy entries become `^packages/connectors/`, `^@restro/connector-` |
| Stage 4: `connector-read-side-no-write` (mirror of `:90-97`); `guest-code-no-order-writes` | read side of a connector; guest code | `.../src/write/`; `core/apply/orders` |

**Pinned by non-dependency-cruiser tests in `scripts/`:**
- the workspace guard (F2): every `package.json` under `apps` and `packages` is in `pnpm-workspace.yaml`, is a Vitest project, has `tsconfig.json` and a `typecheck` script;
- connector `exports` equal `{".", "./testing"}` (mirror of `package-boundaries.test.ts:30-39`);
- connector `dependencies` are within an approved list. A new dependency then needs Martin's approval through a visible test edit;
- the registry meta-test.

### 5.3 Fixture and recorder standard

1. **Layout.** `packages/connectors/<kind>/fixtures/<label>/<name>.json`. Label is `demo`, `sandbox`, `pilot-<n>` or `handmade` (as `fixture.ts:43-61`). Name is `<resource>[-<location>][-<variant>]`. The variants `empty` and `unauthorised` are required. `missing-right`, `rate-limited` and `bad-json` are added when recorded.
2. **Format.** A generic cassette: `request`, `response`, `recordedAt`, `source`, `handmade?`, `note?`, `redaction[]`. Barsy's 15 files are read through an adapter, with no re-recording.
3. **Recorder.** `pnpm connector:record -- --kind <kind> --scenario <name> --label <l>` drives the connector's own production read code through a recording `fetch`. The stored request is then the one production sends (fixes B1-F11). Kept from today: refuse to overwrite (`fixture-files.ts:53-58`), read-allowlist check first (`run.ts:78`), no credentials or headers.
4. **Redaction before write.** Kit scrubbers (tokens, emails, phones, IBAN-like) plus connector JSON-path rules, recorded in the file. A fixture lint fails on an unredacted pattern unless the file carries `allow: [{pattern, reason}]`. Barsy's demo venue contact would use this.
5. **Data origin.**
   - Only the vendor's public demo or sandbox, or `pilot-<n>` with the venue's written consent and Martin's approval (a `consent` field).
   - Never guests, staff or orders.
   - Trim to the pages needed.
6. **Handmade** only for unrecorded shapes. It needs `handmade: true`, a note, and a facts entry marked `assumed`. The go-live gate allows none for a declared capability.
7. **Facts to verify.** `testing/facts.ts` entries are `{id, claim, status, evidence, usedBy}`. Seed barsy from B1: `is_for_sale_barsys` shape, `delete_flag` listing, missing-right answer, `last_update` zone (Q60), Places paging, `description_ml`.
8. **Biome.** Root `files.includes` gains `!**/fixtures/**`; the per-folder file goes.

### 5.4 One vendor-word test

One file, `scripts/vendor-words.test.ts`, plus `vendor-words.config.ts` and `vendor-words.baseline.json`. It replaces A1-P2, A4-P15, A5-P13 and the bespoke core test in `cf-03`.

- **Words.** Registered connector kinds plus `barsy`, `lukanet`, `mistral`, `zamboo`, case-insensitive, also inside identifiers.
- **Code vs comments.** Tokenise with the TypeScript API already at the root (6.0.3, no new dependency). Count identifiers, string and template literals and JSX text. Skip comments. In `messages/*.json`, every key and string counts.
- **Scope.** Non-test code only. Skip `*.test.*`, `tests/`, `testing/`, `e2e/`, `scripts/`, `fixtures/`, `migrations/`. Tests that inject a vendor word on purpose stay legal (`guest/load.test.ts:133`).
- **Modes.** `wall` allows zero. `ratchet` has a per-file baseline that may not grow and must be lowered when it shrinks. A stale entry fails. A larger number is never an accepted fix.
- **Allow-list.** Only `core/src/connectors/**`, the connector's own package, `web/src/connectors/**`, `worker/src/connectors.ts`, and message keys `connectors.<kind>.*`.
- **Cross-kind.** Inside a connector package, another kind's word fails.
- **Banned patterns** in `packages/connectors/*/src`: `parseFloat`, `toFixed(`, `Math.round(`, `* 100`. Zero hits today.

```ts
export const ZONES = [
  { name: 'published', mode: 'wall', include: ['packages/shell/src', 'packages/faces/*/src', 'packages/core/src/snapshot', 'apps/web/src/guest'] },
  { name: 'core', mode: 'ratchet', include: ['packages/core/src'], allow: ['packages/core/src/connectors'] },
  { name: 'web', mode: 'ratchet', include: ['apps/web/src', 'apps/web/messages'], allowKeys: ['connectors.*'] },
]
```

| Zone | Now | Target |
|---|---|---|
| published (shell, faces, snapshot, guest routes, assets) | wall, 0 hits | wall |
| publish producers (`worker/src/publish`, `web/server/publish`) | ratchet, about 12 lines | wall at CF-04 |
| core | ratchet, 436 | wall at CF-03/05/06 |
| db/src | ratchet, 42 | wall at CF-05 |
| web (src and messages) | ratchet, 313 + 188 | wall at CF-09 |
| worker/src | ratchet, 208 | wall at CF-07 |

### 5.5 Neutral CLAUDE.md wording (DRAFT: apply in CF-13; names tied to CF-03/06/07)

| Where | Draft |
|---|---|
| Line 3 | "...for Bulgarian nightclubs. A venue reads its menu from a till system through a connector (first barsy, next Mistral) or runs without a till." |
| Line 12, precedence | "The source system's official docs > recordings in `packages/connectors/<kind>/fixtures` > the architecture doc > the tracker. A shape no doc or recording shows goes on the connector's facts list as `assumed`." |
| Read before (line 7); new item 6 | "decisions (D1-D65; read the last rows)". New item 6: "Adding or changing a connector: `docs/guides/connectors.md`." The lead sets "Scope right now" (it still says Stage 1). |
| Command (line 32) | "`pnpm connector:record -- --kind <kind> --scenario <name>` records a connector's read scenario as fixtures (credentials from `.env.local`)." |
| Layout (51-52) | "`packages/connector-kit`: contract, error kinds, host policy, conformance suite (`/testing`). `packages/connectors/<kind>`: one package per source (client, translate, fixtures, empty `write/`)." |
| Rule 2 | "...layer, source (`till:<connection>` or `manual`) and job (NOT NULL). Till values also cite the raw record and mapping version." |
| Rule 3 | "**Source ids stay in the backend.** A till's article, category, location, table and order ids live only in link tables, raw records and connection tables. Snapshots, the shell, faces, published files and URLs use only our prefixed ids." |
| Rule 5 | "Only the `till` layer can put an item on sale, un-hide it or set an orderable item's price. Every other layer can hide, mark sold out or add text. With no till nothing is orderable (until D12)." |
| Rule 6 | "Absence is deletion only after a complete full read of one location. A failed page, an empty read, or one hiding more than 30 % (at least 5 items) concludes nothing until a person confirms." |
| Rule 7 | "Sync never writes into a source system. Each connector's `write/` exports only calls on Martin's allowlist (tracker + `APPROVED_WRITES`): currently none. Every call a connector can send is on its manifest allowlist." |
| Rule 8 | "Integer minor units through the `money` module only. Keep the source's exact text; convert from the decimal string with the declared rounding (half-up unless proven otherwise). Never `x * 100`, never floats in storage." |
| Rule 9 | "**Source accounts:** one API user per connection per environment; the manifest declares host rules and staging refuses production hosts; only the worker opens sealed credentials; (later) one POS-registration owner, server-generated order ids." |
| Boundaries (67-70) | "Shell and faces never import `db`, any connector or `apps/*`. Only `core/apply` imports the write side of `db`. Only `apps/worker` imports a connector; connectors import only `connector-kit`, pure `core` and zod. `apps/web` never imports a connector." |
| Line 85 | "**Source calls:** every call is on the manifest allowlist with its official doc URL or, for an undocumented source, a recording plus a facts entry." |
| Never (90-92, 100) | "Write to a source system." "Import a connector outside the worker." "Put a source id in a snapshot or URL." "Invent a source method, parameter or behaviour." New: "Weaken, delete or skip a guardrail test, rule or baseline to pass a task: stop and ask." |
| Glossary (new, 5 lines) | till (authority for menu, price, sale state); connector (code); connection (the `integrations` row); location (a till outlet); source (`till:<in_>`, `manual`). |

### 5.6 Adjustments

| Id | What | Why | Size | Risk | Depends | Tier | When |
|---|---|---|---|---|---|---|---|
| G1 | Workspace guard test, root Biome fixtures exclusion; `packages/connectors` globs added in CF-06 | F2, F11 | S | low; passes today | none | Haiku | before, now |
| G2 | Vendor-word scanner, baseline, zones. Amend `cf-03` to drop its bespoke test and lower the baseline | F7 | M | baseline conflicts with CF-03 | none | Sonnet | before CF-03 starts |
| G3 | Dependency rules (5.2) and pins | F1, F10 | M | a mis-specified rule breaks CI; pinned by cases | CF-06, CF-07 | Sonnet; Opus reviews | before Stage 4 |
| G4 | Kit `testing/`: replay server, reference connector, K1-K15, ten mutants | F4, F5 | L | wrong semantics give false comfort | CF-06 | Opus (checks, mutants); Sonnet | before Stage 4 |
| G5 | Barsy adopts the suite *before* CF-07 moves it. Bid-aware `FakeSource` using all five places recordings. K16 | F5, F10 | M | low | G4 | Sonnet | before Stage 4 |
| G6 | Engine tier E1-E6 over the registry. Port from `sync-*.test.ts`, do not rewrite; keep the old tests until green | F4 | M | rule-6 regressions if a case is lost | G4, CF-07 | Sonnet; Opus reviews E1/E2 | before Stage 4 |
| G7 | Recorder, redaction, fixture lint, facts list. Recording session B1-Q8 | F6 | M | needs Martin (demo admin, T39) | G4 | Sonnet | before Stage 4 |
| G8 | `APPROVED_WRITES`, export tests, manifest allowlist. Stage 4: read-side rule | F3 | S-M | low | G4 | Sonnet | empty form before; rules at Stage 4 |
| G9 | Rule-5 properties on a `TILL` constant over three shapes: till-linked, no-till, mixed (hand-made plus till item). `cf-03` names two | rule 5 | S-M | low | CF-03 | Sonnet | with CF-03 |
| G10 | CLAUDE.md rewrite, stale pointers, `_template.md` gate and D-range, `stack.md` and README wording (live doc too) | F8, F13 | S | wording errors mislead | G3-G8 | Sonnet; lead reviews | before Stage 4 (CF-13) |
| G11 | PR template: "guardrails touched?" listing cruiser config, `scripts/*.test.ts`, baselines, `write/`, migrations | F9 | S | none | none | Haiku | now |
| G12 | Guide, CLAUDE.md section, connector brief template (section 8) | all | M | fiction if written early | G3-G10, one dry run with the reference connector | Sonnet; lead reviews | after the foundation, before connector #2 |
| G13 | Stage 4: a named SECURITY DEFINER exception in `rls-guard` for the tenant seam, writer conformance (A5-P9) | F12 | S-M | tenancy | A5-P6 | Opus | Stage 4 |

Sequencing note: CF-08 is planned after CF-07. I recommend splitting it. G1, G2 and G11 are independent and cheap, so they go first. The kit skeleton (G4) goes into CF-06 and barsy adopts it before the move, so the extraction is checked by the suite the next connector will face.

## 6. Keep as is

- The `depcruise-rules.test.ts` method: a tiny fake repo per case, the real rule set, "as written and by path", and the rule-set coverage test (`:443-448`).
- The face contract and its broken-face self-tests, as the model for the kit.
- `barsy/src/write/index.test.ts`: generalise it, never weaken it.
- The recorder's refusal to overwrite, its read-allowlist-first check and its credential-free output. The strict `fixtureSchema` with the `handmade` flag.
- MSW `onUnhandledRequest: 'error'` and the mock's refusal to invent undocumented behaviour (`mock-server.ts:10-13,101-106`).
- `rls-guard`, `TABLE_ACCESS` equality and `app-role`.
- Per-package Vitest project discovery (`vitest.config.ts:15-24`) and the `scripts` project as the home of repo-wide static tests.
- CI order and "no live sandbox in CI" (R0). gitleaks stays.
- The brief skeleton (Model, Branch, Read first, lead-checked facts, binding decisions, Do, Tests, Done when, Allowed dependencies, Never, Report). The connector template extends it.
- "Stop and ask".

## 7. Open questions

1. **Replay mechanism.**
   - Options: MSW replay in the kit, or A3's injected `FixtureTransport`.
   - Recommend MSW. The barsy client calls global `fetch` (`client.ts:172`), so no client change is needed. `onUnhandledRequest: 'error'` is also the no-network guard.
2. **Vendor-word strictness.**
   - Options: a wall everywhere now, or ratchet where hits exist.
   - Recommend ratchet where hits exist and wall elsewhere. Comments are exempt.
3. **Package layout.**
   - Options: nested `packages/connectors/<kind>`, or flat `packages/connector-<kind>`.
   - Recommend nested with G1 first. The flat form needs no config edits but makes the `connector-kit` and `connector-barsy` regexes awkward.
4. **Where write approvals live.** Recommend the tracker line plus the `APPROVED_WRITES` constant, with a test that the two agree. CODEOWNERS is unavailable (F9).
5. **Mistral before docs exist.** Recommend allowing a skeleton on handmade cassettes with every shape marked `assumed`. No capability is declared true until a recording verifies it.
6. **Record the principle as D66**: "a rule is done when a test pins it; baselines only shrink; guardrails are changed only with Martin's or the lead's explicit OK".
7. **Guide location.** `docs/guides/connectors.md` is safe: the admin serves only the guides named in `GUIDES` (`apps/web/src/server/guides.ts`, today `qr-links`). Fact.

## 8. Outline: connector guide, CLAUDE.md section, brief template

**Written only after the foundation lands (CF-13), and after one dry run with the reference connector.**

**8.1 `docs/guides/connectors.md`** (for coding agents)
0. Read first: what a connector is and is not (a venue with no till has none). The files you touch and the ones that mean stop and ask.
1. Principles: the nine rules as connector duties, consolidated from the A1-A5, B1, R0 and A2 rule lists.
2. Anatomy: package layout, data manifest in `core/connectors/<kind>.ts`, one worker registry line, message keys `connectors.<kind>.*`, `fixtures/`, `testing/`, empty `write/`.
3. Manifest: kind, label, capabilities (declared, then granted at connect), credential and option fields, link types per node type, deletion signal, rounding, policy (hosts, production hosts, concurrency, rps, timeout, page size), outbound allowlist, `mappingVersion`, delivery poll or push.
4. Connect and locations: rights list, `discover`, stable text ids, a person links each location to a venue.
5. Read: full, since-cursor (opaque), by ids. Completeness. Paging, `Retry-After`, time zones.
6. Translate and quarantine: pure and deterministic, `deriveId`, `till` layer, `venue:<vn_>` scope, money, languages, field coverage.
7. Webhooks: not before D41 lifts. Hint, then fetch; verify in the worker.
8. Write: Stage 4 and after. Idempotency key is our id, `unknown_reconcile`, write mode off, test or live, D33.
9. Errors and limits: kit error kinds, secrets in messages, host policy.
10. Tests and fixtures: K and E checks, fixture standard, recorder, facts.
11. Go-live: staging dry run with hold or plan, readiness report on the venue's data, rights list to the venue, consent, Martin's sign-off, deploy windows.
12. Maintenance: bumping `mappingVersion`, replay, vendor API changes.
Appendices: barsy as the worked example (file map); the checklist; the stop-and-ask list.

**8.2 CLAUDE.md "Connectors" section (about 12 lines):**
- when it applies;
- read order: guide, then template, then the barsy example;
- layout in one line;
- three non-negotiables: no vendor word outside the allow-list, conformance green, every outbound call on the allowlist;
- stop-and-ask triggers: editing `apply()`, the resolver, a migration or web code beyond message keys;
- the gate command.

**8.3 `docs/agent-briefs/_template-connector.md` sections:** Model, Branch, Read first; Source facts (lead-checked, with the `assumed` list); Goal; Capabilities declared (each with evidence); Scope (exact files); Done-when checklist; Tests that must exist; Allowed dependencies (none by default); Needs Martin; Never; Stop and ask; Report back (CLAUDE.md format plus the conformance output, the count of `assumed` facts, fixtures with label and consent).

**8.4 Checklist the agent ticks:**
1. Every used field has a recorded non-empty sample, or an `assumed` facts entry.
2. Manifest valid (K1), outbound allowlist with doc or recording.
3. Registry line and manifest only; no other core file changed.
4. Message keys in BG and EN, with BG flagged for T44.
5. Fixtures follow the standard: label, redaction, `empty` and `unauthorised` variants, no other customers' data.
6. K2-K16 green.
7. Engine tier E1-E6 green for the kind.
8. The vendor-word baseline did not grow and no dependency rule changed.
9. No new dependency, or Martin's OK is recorded.
10. UI: no web code; a component test over the manifest.
11. Connector README: rights, quirks.
12. Tracker note and report.

**8.5 Acceptance.**
- `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build`, with DB tests on your own database (CLAUDE.md "Database tests").
- Quick loop: `pnpm exec vitest run --project packages/connectors/<kind>`.
- `pnpm test:e2e` only if the web app was touched, which it should not be.
- No live call except Martin's recording session.

**8.6 Needs Martin:**
- credentials and the API user (rule 9);
- a test installation (D33);
- each write allowlist entry;
- any new dependency;
- pilot-venue fixtures and consent;
- BG wording (T44);
- vendor terms and fees (Q6);
- the production host list;
- write mode `live`;
- webhook subscriptions (D41);
- deploys.

**8.7 Order of work:**
0. Intake: docs or access, test installation, terms (Martin).
1. Lead's facts pass and brief from the template.
2. Recording session, then redaction and lint.
3. Skeleton: package, manifest, registry, empty `write/`, message stubs, conformance test red.
4. Connect and discover.
5. Read, with completeness and `FakeSource`.
6. Translate, with field coverage.
7. Pure tier green.
8. Engine tier.
9. Staging dry run, reviewing the hold.
10. Go-live checklist.
11. Tracker maintenance entry.

Tiers: Opus for the first real connector's contract fit; Sonnet for translate and tests; Haiku for message keys.

### Critical Files for Implementation
- E:\Restro\.dependency-cruiser.cjs
- E:\Restro\scripts\depcruise-rules.test.ts
- E:\Restro\vitest.config.ts
- E:\Restro\packages\shell\testing\contract.ts
- E:\Restro\packages\barsy\src\testing\mock-server.ts
