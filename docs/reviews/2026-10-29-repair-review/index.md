# A1 index: repair-review of or/foundation

**Agent:** A1 Indexer (Haiku, medium), subagent of the lead session. **Plan:** `docs/deliverables/2026-10-29-repair-review-plan.md` §4 (A1) and §6.
**Pinned commit:** `16b59a82` (checked with `git rev-parse --short HEAD` in `E:\Restro\.claude\worktrees\rr-pinned` before any list was made: match). Read-only: no code edited, no test run, nothing committed.
**Method:** every list below is produced by a script or a `git grep` / `git ls-files` command over the pinned tree. No judgement is added to a list. Where a count is interpreted, the text says so.
**Re-running:** every list names its command. The scripts that need more than one command (job options, i18n, glossary terms, constant scan) are kept in the agent's scratchpad, `C:\Users\Martin\AppData\Local\Temp\claude\E--Restro\431635f7-7037-4fc0-a8b3-62042a7942bc\scratchpad\` (`build.sh`, `jobs.mjs`, `i18n.mjs`, `unused.mjs`, `terms.mjs`). They read the pinned worktree only.

## Deviations from the brief (stated, not silently fixed)

- The brief names `apps/web/src/app`. That folder does not exist. The route files live in **`apps/web/app/`** (the Next.js app router sits beside `src`). Route lists use `apps/web/app`.
- The brief's `/t/[token]` page is a `route.ts` (GET), not a `page.tsx`. No `page.tsx` exists under `/t/`. The guest page is `apps/web/app/m/[...address]/page.tsx`.
- Route handler bodies were not followed: a route that delegates to a helper (the three `/api/guest/*` routes) shows no `parse` call here. Their validation sits in the helper, which is not indexed.
- The decision regex `D1[0-2][0-9]` covers decisions 100 to 129 only. The menu designer's numbers 128 to 131 (plan §9; their files exist only on `st/foundation`) are out of range and not counted.

## 0. Summary counts

| List | Count | Notes |
|---|---|---|
| Entry points: `'use server'` files (apps/web/src) | 22 files, **134** exported async functions | §1a |
| Entry points: route handlers (apps/web/app) | **13** `route.ts` files (GET in 10, POST in 4; `api/auth` exports both); **14** `page.tsx` | §1b |
| Entry points: worker jobs | **37** job registrations (36 `JOB_NAMES` definitions plus `WORKER_HEARTBEAT_JOB`); **19** carry a `schedule: { cron` | §1c |
| Entry points: queue send sites | **21** send call sites, 5 of which forward a variable name (wrappers) | §1c |
| Entry points: Zod parse calls | **146** `.parse`/`.safeParse` lines in entry files (3 are a generic variable named `schema`), plus **10** chained `)`.`safeParse` calls | §1d |
| Decisions cited | **20** decisions (D105, D107, D109 to D113, D115 to D127); D114, D106, D108 are never cited in code or tests | §2 |
| Files citing a decision | **367** distinct code or test files (markdown excluded) | §2 |
| Code files with no citation | **80** of 185 in scope (62 `apps/web/src/server`, 5 `apps/worker/src/jobs`, 13 `packages/core/src/service`; tests excluded) | §2 |
| i18n: keys in bg.json / en.json | **2123 / 2123** | §3 |
| i18n: keys in one file and not the other | **0 / 0** | §3 |
| i18n: keys with no word match in apps/web/src | **66**: 40 built at runtime from a variable (checked by hand), 21 under a `family.${` template (not checked key by key), **5** with no reference | §3 |
| Glossary: terms with a wrong-form list | **66** terms, **175** wrong forms (59 appear as a word in some en.json string) | §4a |
| Constants: same exported name in 2+ files | **3** names (REFUSAL_CODES, SIM_PAY_SIGNATURE_HEADER, VENUE_ID) | §4b |
| Constants: timing names in 2+ files | **7** names (TIMEOUT_MS, DAY_MS, MINUTE_MS, CALL_TIMEOUT_MS, ONE_YEAR_SECONDS, REFRESH_MS, SETTLED) | §4b |
| Constants: timing-like definitions outside packages/core/src/timings.ts | **154** | §4b |

## 1. Entry points

### 1a. `'use server'` files and their exported async functions

Command: `git grep -l -E "^['\"]use server['\"]" -- apps/web/src | sort` (22 files), then `git grep -n -E '^export async function' -- <those files>`. Output: `file:line  name`. Full list in the block below.

Per folder: `apps/web/src/composer` 18, `apps/web/src/i18n` 1, `apps/web/src/server` 115 (total 134).

```
(see §1a block at the end of this file)
```

### 1b. Route handlers and pages under `apps/web/app`

Command: `git ls-files apps/web/app | grep -E '/(route|page)\.tsx?$'` (27 files), then `git grep -n -E '^export ' -- apps/web/app`.

Route handlers (`route.ts`, 13):

| File | Methods |
|---|---|
| `apps/web/app/api/assets/file/[...key]/route.ts` | GET |
| `apps/web/app/api/assets/route.ts` | POST |
| `apps/web/app/api/auth/[...all]/route.ts` | GET, POST (re-exported `handle`; Better Auth) |
| `apps/web/app/api/guest/actions/route.ts` | POST (`export function`, not async) |
| `apps/web/app/api/guest/payment/route.ts` | GET (`export function`, not async) |
| `apps/web/app/api/guest/state/route.ts` | GET (`export function`, not async) |
| `apps/web/app/api/health/route.ts` | GET (`export function`) |
| `apps/web/app/api/payments/notices/[kind]/route.ts` | POST |
| `apps/web/app/api/tables/[tableId]/qr/route.ts` | GET |
| `apps/web/app/api/venues/[venueId]/export/route.ts` | GET |
| `apps/web/app/api/venues/[venueId]/night/route.ts` | GET |
| `apps/web/app/cdn/[...path]/route.ts` | GET |
| `apps/web/app/t/[token]/route.ts` | GET |

Pages (`page.tsx`, 14; the guest page is `m/[...address]`): `(admin)/guides/qr-links`, `(admin)/settings/deleted-venues`, `(admin)/settings/general`, `(admin)/settings/integrations`, `(admin)/settings/page`, `(admin)/venues/[venueId]`, `(admin)/venues/page`, `(print)/venues/[venueId]/tables/print`, `dev/fields`, `dev/item-sheet`, `login`, `m/[...address]`, `no-organization`, root `page.tsx`. The raw `export` lines are in the §1b block.

### 1c. Worker jobs and queue sends

Commands: `git grep -n -E 'name: JOB_NAMES\.' -- apps/worker/src/jobs` and the `defineJob` options, read by `jobs.mjs` (the first 18 lines after each name, cut at `handler`); `git grep -n -E 'queue\.send\(|boss\.send\(|\.send\(' -- apps/worker/src apps/web/src/server/jobs.ts`. Registration point: `apps/worker/src/registry.ts:53` (`createQueue`), `:125` (`work`), `:127` (`schedule`).

The option values are as written at the registration. Four things a reader must know:

- A value that is a variable is printed as the variable (`...queue`, `PAYMENT_PREPARE_EXPIRE_SECONDS`). Resolved by hand here: `payments.ts:2177` (`queue`): retryLimit 5, retryDelay 2, retryBackoff true, expireInSeconds 60, retentionSeconds 3600, deleteAfterSeconds 86400. Used by `paymentPrepare` (expire overridden at `:2210`) and `paymentCheck` (`:2218`).
- `service-hours.ts:261` and `:274` use `queue: TICK_QUEUE` (`service-hours.ts:250`): retryLimit 0, expireInSeconds 120, retentionSeconds 600, deleteAfterSeconds 3600. The scanner printed "none stated" for these two; that is wrong and is corrected here.
- `worker-heartbeat.ts:19` (`WORKER_HEARTBEAT_JOB`, not in the scanner): retryLimit 0, expireInSeconds 60, retentionSeconds 900, deleteAfterSeconds 3600.
- Send-site values are cut at the first comma by the scanner (for example `startAfter=Math.max(0` is the start of a longer expression). The full call is at the file:line shown.
- The web's enqueue helper `apps/web/src/server/jobs.ts:80` and the worker's `enqueue` wrappers (`barsy.ts:275`, `publish.ts:355`, `publish.ts:394`, `payment-recovery.ts:330`) forward a variable name. Their real name and options come from `prepareJob` in `packages/core/src/jobs.ts`, which is not indexed.

Full list: the §1c block.

### 1d. Zod parse calls in entry files

Command: `git grep -n -o -E '[A-Za-z_][A-Za-z0-9_]*\.(safeParse|parse)\(' -- <entry files>` where the entry files are the 22 `'use server'` files, `apps/web/app/**/route.ts` and `page.tsx`, and `apps/worker/src/jobs/*.ts`, `registry.ts`, `worker.ts`, `apps/web/src/server/jobs.ts`. Then the chained form `git grep -n -o -E '\)\.(safeParse|parse)\('` (10 hits). `JSON.parse` and `Date.parse` lines are removed (4 lines). The `schema` rows are generic names (`barsy.ts:127`, `publish.ts:53`, `purge.ts:1193`) and were not resolved.

Per folder: `apps/web/src` 126, `apps/worker/src` 20. No direct parse call in any `apps/web/app` route file: the only route-level parses are the chained `idSchema('vn').safeParse` calls in `apps/web/app/api/venues/[venueId]/export/route.ts:36` and `night/route.ts:27`.

Full list: the §1d block.

## 2. Decision citations

Command: `git grep -n -o -E 'D1[0-2][0-9]( §[0-9]+)?' -- packages apps ':!*.md'` (1188 lines; markdown excluded, tests included). Per-file pairs by `sort | uniq -c`. Scope for "no citation": `git ls-files packages/core/src/service apps/worker/src/jobs apps/web/src/server | grep -v -E '\.test\.tsx?$'` (185 files) minus the files matched by `git grep -l -E 'D1[0-2][0-9]'` over the same paths (138 files cited).

| Decision | Citations | Files citing it |
|---|---|---|
| D105 | 2 | 2 |
| D107 | 1 | 1 |
| D109 | 9 | 5 |
| D110 | 21 | 13 |
| D111 | 27 | 18 |
| D112 | 2 | 2 |
| D113 | 20 | 19 |
| D115 | 52 | 33 |
| D116 | 25 | 22 |
| D117 | 30 | 22 |
| D118 | 26 | 13 |
| D119 | 11 | 9 |
| D120 | 97 | 54 |
| D121 | 47 | 32 |
| D122 | 349 | 196 |
| D123 | 7 | 7 |
| D124 | 62 | 35 |
| D125 | 103 | 43 |
| D126 | 5 | 3 |
| D127 | 292 | 122 |

"Citations" counts matches, a `§n` reference counts with its decision. Per folder for all 651 (decision, file) pairs: `packages/core` 324, `apps/web` 114, `apps/worker` 79, `packages/db` 37, `packages/shell` 28, `packages/connectors` 26, `packages/faces` 18, `packages/payments` 16, `packages/barsy` 8, `packages/assets` 1 (the full pair list is in the appendix block).

Code files in the three named folders that cite **no** decision (80, tests excluded). Command: as above.

Per folder: `apps/web/src/server` 62, `apps/worker/src/jobs` 5, `packages/core/src/service` 13.

```
(see §2b block)
```

## 3. i18n

Commands: `apps/web/messages/bg.json` and `en.json` flattened by `i18n.mjs` (every leaf path). Usage: `git grep -o -h -E '[A-Za-z_][A-Za-z0-9_]*' -- apps/web/src | sort -u` (11,664 distinct tokens); a key is "used" when its last segment is one of those tokens. Template prefixes: `git grep -o -h -E '`[A-Za-z0-9_.-]*\.\$\{' -- apps/web/src`.

- Total keys: **bg.json 2123, en.json 2123**. Keys only in bg: **0**. Keys only in en: **0**. Keys in both: 2123.
- Keys whose last segment matches a word in apps/web/src: **2057**. This is an upper bound: a common last segment (for example `title`) counts as used everywhere.
- Keys with no word match: **66**. Split by hand (each family checked in the code):
  - **40 built at runtime from a variable** (checked by hand in the code): `options.allergens.*` (9) and `options.dietary.*` (4) via `fields/option-label.ts` (`t(key)`); `fields.units.kg`, `fields.units.pcs` via `fields/types/numbers.tsx` (`t(unit)`); `connectors.barsy.price.actualHelp`, `currentHelp` via `connectors/barsy/venue-part.tsx:80` (`` t(`${key}Help`) ``); `tonight.ck_*` (7) via `tonight/call-kinds.ts` (`ck_${kind}`); `tonight.st_waiting`, `st_sending`, `st_checking` (3) via `tonight/sent-row.tsx:39` (`st_${state}`); `tonight.rs_*` (5) via `sent-row.tsx:46`; `tonight.lg_g_*` (5) via `tonight/log-sentence.ts:115`; `ownerSettings.st_password_*` (3) via `settings/use-settings-run.tsx:202`.
  - **21 maybe dynamic**: no word match, but a `family.${` template exists in the code for that key's family (`errors.${`, `visibility.${`, `sync.${`, `afterSync.${`, `st_day.${`, `st_day_short.${`, `row.${`, `errors.${` under `tonight`, and others). Not checked key by key. The list is in the §3 block (MAYBE_DYNAMIC).
  - **5 with no reference in apps/web/src** (candidates for removal; the other packages were not searched): `auth.inviteOnly`, `workspace.comingInStage`, `tonight.nt_fix_so`, `tonight.nt_tg_pay`, `ownerSettings.sf_e_pins`.

Full list of the 66 keys: the §3 block (lists UNUSED and MAYBE_DYNAMIC from `unused.mjs`).

## 4. Terms and duplicates

### 4a. Glossary wrong forms in interface strings and code identifiers

Command: `GLOSSARY.md` parsed by `terms.mjs`: each `**Term**:` block and its `_Avoid_:` line (parenthetical notes dropped). For each wrong form: en.json values matched as a whole word (singular or plural), case-insensitive; code identifiers in `git ls-files apps packages` (ts, tsx, mjs; tests and e2e excluded) split into words at camel-case and underscore boundaries, matched as consecutive words with a trailing `s` ignored.

- 66 terms, 175 wrong forms. 59 wrong forms appear in at least one en.json string; 116 appear in none.
- Code identifier counts are not evidence of a violation on their own. Most wrong forms are ordinary code words (`store`, `import`, `label`, `link`, `user`, `list`, `sync`, `provider`), and some are glossary terms themselves: `area` (avoided under Bar, but the Area term), `sync` (avoided under Reading, but the Sync term), `check` (avoided under Bill, but the Pre-opening check and Location check terms), `location` (avoided under Venue, but Location check and Location pass), `deleted` (avoided under Archived, but the Deleted term). Treat those rows as homonyms unless the en string is the wrong use.
- Candidates in en.json (counts only; the key names are in the §4a block): `failed` (Sent order state; 5 keys), `unknown` (Sent order state; 3 keys), `accepted` and `rejected` (1 key each), `template` (13 keys; the Item schema term avoids it, but the Template term uses the word for the phone design, so check which sense each string uses), `group` (13 keys, Section), `club` (4 keys; the visible ones are the slug example "demo-club"), `provider` (30 keys, POS system; the Payment provider term uses the same word), `connection` (55 keys, Instance; the Connection pause term uses it too).

The full table (one row per wrong form, with en key count, code count and file count, and up to four en keys) is in the §4a block.

### 4b. Constants duplicated across packages

Command 1: `git grep -n -E 'export const [A-Z][A-Z0-9_]+ =' -- packages/core apps/worker apps/web packages/payments packages/connectors` (non-test; 523 lines, in the appendix). Duplicates by name:

| Name | Files |
|---|---|
| `REFUSAL_CODES` | `packages/core/src/connectors/service/schemas.ts:52`, `packages/core/src/service/results.ts:14` |
| `SIM_PAY_SIGNATURE_HEADER` | `apps/web/src/connectors/sim-pay/notices.ts:13`, `packages/payments/sim-pay/src/notices.ts:14` |
| `VENUE_ID` | `apps/web/src/connectors/test-view.ts:12`, `apps/web/src/publish/test-view.ts:13`, `apps/web/src/tables/test-view.ts:7`, `packages/core/src/resolve/fixtures.ts:23` (test fixtures) |

Command 2 (duplicate values): the same scan, values compared textually: 53 values appear in two or more exported constants (for example `15` in six constants and `30` in six, five of the `30`s being purge retention constants in `packages/core/src/purge.ts`); see the appendix.

Command 3 (timing names outside `packages/core/src/timings.ts`): `git grep -n -E '(const|export const) [A-Z_]*(_MS|_SECONDS|_MINUTES|_HOURS|_DAYS|TIMEOUT|INTERVAL|DELAY|TTL|EXPIRE|BACKOFF|WINDOW|GRACE|TICK|RETRY)[A-Z_]* ='` (non-test): **154** definitions outside `packages/core/src/timings.ts`, which exports 2 names. Per folder: `packages/core/src` 65, `apps/worker/src` 46, `apps/web/src` 31, `apps/web/e2e` 4, others 8. Same name in 2+ files: `TIMEOUT_MS` (4: `apps/web/src/server/payments-connection.ts`, `reveal.ts`, `telegram-link.ts`, `turnstile.ts`), `DAY_MS` (7), `MINUTE_MS` (3), `CALL_TIMEOUT_MS` (2: `apps/worker/src/alerts/telegram.ts`, `receipts/email-sender.ts`), `ONE_YEAR_SECONDS` (2), `REFRESH_MS` (2), and `SETTLED` (3, e2e specs, which are not a shared value).

Other timing modules outside `timings.ts`: `packages/core/src/service/send-timings.ts` and `packages/core/src/connectors/service/timings.ts`. Not read.

## 5. What the scripts could not cover

- Route handler bodies and helper-level validation (see the deviations above).
- Zod parse calls wrapped in a helper (for example `readingSchema(X).safeParse` in `apps/worker/src/jobs/payments.ts:788` is counted only as `readingSchema(...)`); the `schema` name is generic and unresolved.
- Job options spread from constants are resolved here only for `TICK_QUEUE`, `worker-heartbeat` and `payments.ts:2177`. Send-site values are truncated at the first comma. `prepareJob` in `packages/core/src/jobs.ts` (the real name and options of web-enqueued jobs) is not indexed.
- Decision citations written without the `D` prefix (for example "decision 122") are not matched.
- i18n: `apps/web/app` was not searched (the brief said `apps/web/src`); a key used only from `apps/web/app` would show as unused. A word match is not a use of the key.
- i18n: values in bg.json were not compared against en.json (for example untranslated strings).
- Glossary: identifiers in test files and e2e specs were excluded; Bulgarian interface text was not checked for English wrong forms.
- Constants: non-exported constants and constants in `apps/web/scripts` (outside the five named packages) were not counted in the duplicate check.
- No test, build, migration, staging, production, POS or Stripe call was made.

---

## Blocks (generated; the commands are in the sections above)

### §1a block: exported functions of the `'use server'` files (134)
```
apps/web/src/composer/actions.ts:217  placeItemAction
apps/web/src/composer/actions.ts:228  moveSectionAction
apps/web/src/composer/actions.ts:239  createSectionAction
apps/web/src/composer/actions.ts:261  createItemAction
apps/web/src/composer/actions.ts:305  setItemHiddenAction
apps/web/src/composer/actions.ts:317  setSectionHiddenAction
apps/web/src/composer/actions.ts:331  setSectionLayoutAction
apps/web/src/composer/actions.ts:355  renameSectionAction
apps/web/src/composer/actions.ts:380  deleteSectionAction
apps/web/src/composer/actions.ts:417  renameItemAction
apps/web/src/composer/actions.ts:442  deleteItemAction
apps/web/src/composer/payment-mode-actions.ts:28  setItemPaymentModeAction
apps/web/src/composer/sold-out-actions.ts:31  setItemsSoldOutAction
apps/web/src/composer/tag-actions.ts:91  createTagAction
apps/web/src/composer/tag-actions.ts:101  updateTagAction
apps/web/src/composer/tag-actions.ts:111  moveTagAction
apps/web/src/composer/tag-actions.ts:127  setTagArchivedAction
apps/web/src/composer/tag-actions.ts:142  setItemTagsAction
apps/web/src/i18n/actions.ts:11  setAdminLocale
apps/web/src/server/actions.ts:15  switchOrganization
apps/web/src/server/composer/guest-features-actions.ts:45  saveGuestFeaturesAction
apps/web/src/server/composer/guest-features-actions.ts:71  saveFeatureOptionsAction
apps/web/src/server/design/actions.ts:42  saveLookAction
apps/web/src/server/design/actions.ts:62  chooseTemplateAction
apps/web/src/server/integration/actions.ts:134  saveSystemsAction
apps/web/src/server/integration/actions.ts:141  addInstanceAction
apps/web/src/server/integration/actions.ts:148  saveConnectionAction
apps/web/src/server/integration/actions.ts:155  renameInstanceAction
apps/web/src/server/integration/actions.ts:162  removeInstanceAction
apps/web/src/server/integration/actions.ts:169  checkConnectionAction
apps/web/src/server/integration/actions.ts:178  saveInstanceSettingsAction
apps/web/src/server/integration/actions.ts:185  syncAllAction
apps/web/src/server/integration/actions.ts:194  saveVenueSourceAction
apps/web/src/server/integration/actions.ts:202  syncNowAction
apps/web/src/server/item-sheet/actions.ts:119  loadItemSheetAction
apps/web/src/server/item-sheet/actions.ts:130  loadItemHistoryAction
apps/web/src/server/item-sheet/actions.ts:143  saveItemFieldAction
apps/web/src/server/item-sheet/actions.ts:158  revertItemFieldAction
apps/web/src/server/item-sheet/actions.ts:172  keepItemOverrideAction
apps/web/src/server/item-sheet/actions.ts:186  saveItemTranslationAction
apps/web/src/server/item-sheet/actions.ts:208  setItemImageAction
apps/web/src/server/item-sheet/actions.ts:233  setItemSoldOutAction
apps/web/src/server/item-sheet/actions.ts:268  removeItemImageAction
apps/web/src/server/menus-actions.ts:89  createMenuAction
apps/web/src/server/menus-actions.ts:102  renameMenuAction
apps/web/src/server/menus-actions.ts:119  moveMenuAction
apps/web/src/server/menus-actions.ts:140  setMenuSettingsAction
apps/web/src/server/menus-actions.ts:157  deleteMenuAction
apps/web/src/server/menus-actions.ts:168  restoreMenuAction
apps/web/src/server/menus-actions.ts:184  setLiveMenuAction
apps/web/src/server/menus-actions.ts:221  importMenuAction
apps/web/src/server/menus-actions.ts:253  listImportSourcesAction
apps/web/src/server/organization-actions.ts:121  updateOrganizationAction
apps/web/src/server/publish/actions.ts:78  publishNowAction
apps/web/src/server/publish/actions.ts:87  approveHeldAction
apps/web/src/server/publish/actions.ts:95  rejectHeldAction
apps/web/src/server/publish/actions.ts:103  rollbackAction
apps/web/src/server/publish/actions.ts:120  saveAutomationAction
apps/web/src/server/publish/actions.ts:128  resumeAutoPublishAction
apps/web/src/server/publish/actions.ts:136  previewDraftAction
apps/web/src/server/settings/alerts-actions.ts:38  setRecipientsAction
apps/web/src/server/settings/alerts-actions.ts:52  unlinkGroupAction
apps/web/src/server/settings/alerts-actions.ts:66  unlinkPersonAction
apps/web/src/server/settings/alerts-actions.ts:112  linkGroupAction
apps/web/src/server/settings/alerts-actions.ts:120  linkPersonAction
apps/web/src/server/settings/alerts-actions.ts:131  testTelegramAction
apps/web/src/server/settings/ordering-actions.ts:20  saveOrderingAction
apps/web/src/server/settings/paying-actions.ts:78  startConnectionAction
apps/web/src/server/settings/paying-actions.ts:98  finishConnectionAction
apps/web/src/server/settings/paying-actions.ts:116  disconnectPayingAction
apps/web/src/server/settings/paying-actions.ts:127  tickPayingCheckAction
apps/web/src/server/settings/paying-actions.ts:156  savePayingAction
apps/web/src/server/settings/paying-actions.ts:189  savePayFirstAction
apps/web/src/server/settings/staff-actions.ts:106  addPersonAction
apps/web/src/server/settings/staff-actions.ts:129  revealPinAction
apps/web/src/server/settings/staff-actions.ts:146  newPinAction
apps/web/src/server/settings/staff-actions.ts:168  renamePersonAction
apps/web/src/server/settings/staff-actions.ts:176  assignRoleAction
apps/web/src/server/settings/staff-actions.ts:184  removeFromVenueAction
apps/web/src/server/settings/staff-actions.ts:194  removeForGoodAction
apps/web/src/server/settings/staff-actions.ts:201  linkAccountAction
apps/web/src/server/settings/staff-actions.ts:209  copyRoleAction
apps/web/src/server/settings/staff-actions.ts:217  updateRoleAction
apps/web/src/server/settings/staff-actions.ts:225  archiveRoleAction
apps/web/src/server/settings/staff-actions.ts:232  markSharedDeviceAction
apps/web/src/server/settings/staff-actions.ts:239  revokeSharedDeviceAction
apps/web/src/server/tables/actions.ts:135  revealCodesAction
apps/web/src/server/tables/actions.ts:164  createAllCodesAction
apps/web/src/server/tables/actions.ts:171  issueCodeAction
apps/web/src/server/tables/actions.ts:180  turnOffCodeAction
apps/web/src/server/tables/actions.ts:189  renameTableAction
apps/web/src/server/tables/actions.ts:200  createAreaAction
apps/web/src/server/tables/actions.ts:207  renameAreaAction
apps/web/src/server/tables/actions.ts:216  setAreaHiddenAction
apps/web/src/server/tables/actions.ts:225  moveAreaAction
apps/web/src/server/tables/actions.ts:234  deleteAreaAction
apps/web/src/server/tables/actions.ts:245  createTableAction
apps/web/src/server/tables/actions.ts:257  setTableNumberAction
apps/web/src/server/tables/actions.ts:266  setTableHiddenAction
apps/web/src/server/tables/actions.ts:275  moveTableAction
apps/web/src/server/tables/actions.ts:284  deleteTableAction
apps/web/src/server/tables/actions.ts:298  setMenuRouteAction
apps/web/src/server/tonight/actions.ts:100  openTableAction
apps/web/src/server/tonight/actions.ts:114  closeTableAction
apps/web/src/server/tonight/actions.ts:128  newGuestsAction
apps/web/src/server/tonight/actions.ts:142  openAllTablesAction
apps/web/src/server/tonight/actions.ts:149  closeAllTablesAction
apps/web/src/server/tonight/actions.ts:156  markPaymentTableAction
apps/web/src/server/tonight/actions.ts:178  handleWaiterCallAction
apps/web/src/server/tonight/actions.ts:192  receiptBroughtAction
apps/web/src/server/tonight/actions.ts:201  receiptUnbroughtAction
apps/web/src/server/tonight/actions.ts:215  pauseOrderingAction
apps/web/src/server/tonight/actions.ts:229  liftOrderingAction
apps/web/src/server/tonight/actions.ts:243  resumeTableAction
apps/web/src/server/tonight/actions.ts:256  answerSentOrderAction
apps/web/src/server/tonight/actions.ts:273  undoOpenAllAction
apps/web/src/server/tonight/actions.ts:283  tableBillAction
apps/web/src/server/tonight/actions.ts:311  stornoDoneAction
apps/web/src/server/tonight/actions.ts:323  stornoUndoAction
apps/web/src/server/tonight/actions.ts:346  doneAlertAction
apps/web/src/server/tonight/actions.ts:359  answerPaymentAction
apps/web/src/server/tonight/night-actions.ts:76  sentOrdersAction
apps/web/src/server/tonight/night-actions.ts:95  sentOrderDetailAction
apps/web/src/server/tonight/night-actions.ts:108  logAction
apps/web/src/server/tonight/payment-actions.ts:66  nightPaymentsAction
apps/web/src/server/tonight/payment-actions.ts:82  paymentDetailAction
apps/web/src/server/venues-actions.ts:174  createVenueAction
apps/web/src/server/venues-actions.ts:204  loadNewVenueSourcesAction
apps/web/src/server/venues-actions.ts:231  renameVenueSlugAction
apps/web/src/server/venues-actions.ts:297  renameVenueAction
apps/web/src/server/venues-actions.ts:336  deleteVenueAction
apps/web/src/server/venues-actions.ts:396  restoreVenueAction
apps/web/src/server/venues-actions.ts:432  unpublishVenueAction
apps/web/src/server/venues-actions.ts:491  purgeVenueAction
```

### §1b block: every `export` line under apps/web/app (route methods and page exports)
Command: `git grep -n -E '^export ' -- apps/web/app | grep -v '\.test\.'`
```
apps/web/app/(admin)/guides/qr-links/page.tsx:14:export async function generateMetadata() {
apps/web/app/(admin)/guides/qr-links/page.tsx:18:export default async function QrLinksGuidePage({ searchParams }: PageProps<'/guides/qr-links'>) {
apps/web/app/(admin)/layout.tsx:12:export default async function AdminLayout({ children }: { children: ReactNode }) {
apps/web/app/(admin)/settings/deleted-venues/page.tsx:12:export async function generateMetadata() {
apps/web/app/(admin)/settings/deleted-venues/page.tsx:21:export default async function SettingsDeletedVenuesPage() {
apps/web/app/(admin)/settings/general/page.tsx:10:export async function generateMetadata() {
apps/web/app/(admin)/settings/general/page.tsx:19:export default async function SettingsGeneralPage() {
apps/web/app/(admin)/settings/integrations/page.tsx:10:export async function generateMetadata() {
apps/web/app/(admin)/settings/integrations/page.tsx:19:export default async function SettingsIntegrationsPage() {
apps/web/app/(admin)/settings/layout.tsx:9:export async function generateMetadata() {
apps/web/app/(admin)/settings/layout.tsx:19:export default async function SettingsLayout({ children }: { children: ReactNode }) {
apps/web/app/(admin)/settings/page.tsx:7:export default async function SettingsPage() {
apps/web/app/(admin)/venues/[venueId]/page.tsx:38:export async function generateMetadata({ params }: PageProps<'/venues/[venueId]'>) {
apps/web/app/(admin)/venues/[venueId]/page.tsx:44:export default async function VenueWorkspacePage({
apps/web/app/(admin)/venues/page.tsx:22:export async function generateMetadata() {
apps/web/app/(admin)/venues/page.tsx:27:export default async function VenuesPage() {
apps/web/app/(print)/venues/[venueId]/tables/print/page.tsx:23:export const metadata: Metadata = { robots: { index: false, follow: false } }
apps/web/app/(print)/venues/[venueId]/tables/print/page.tsx:25:export default async function PrintTablesPage({
apps/web/app/api/assets/file/[...key]/route.ts:7:export async function GET(
apps/web/app/api/assets/route.ts:13:export async function POST(request: Request): Promise<Response> {
apps/web/app/api/auth/[...all]/route.ts:11:export { handle as GET, handle as POST }
apps/web/app/api/guest/actions/route.ts:6:export function POST(request: Request): Promise<Response> {
apps/web/app/api/guest/payment/route.ts:6:export function GET(request: Request): Promise<Response> {
apps/web/app/api/guest/state/route.ts:6:export function GET(request: Request): Promise<Response> {
apps/web/app/api/health/route.ts:2:export function GET() {
apps/web/app/api/payments/notices/[kind]/handle.ts:23:export const MAX_NOTICE_BYTES = 1024 * 1024
apps/web/app/api/payments/notices/[kind]/handle.ts:26:export interface NoticeInbox {
apps/web/app/api/payments/notices/[kind]/handle.ts:42:export async function readCappedBody(request: Request, cap: number): Promise<string | null> {
apps/web/app/api/payments/notices/[kind]/handle.ts:67:export async function handleNotice(
apps/web/app/api/payments/notices/[kind]/route.ts:11:export async function POST(
apps/web/app/api/tables/[tableId]/qr/route.ts:13:export async function GET(
apps/web/app/api/venues/[venueId]/export/route.ts:29:export async function GET(
apps/web/app/api/venues/[venueId]/night/route.ts:20:export async function GET(
apps/web/app/cdn/[...path]/route.ts:7:export async function GET(
apps/web/app/dev/fields/page.tsx:7:export async function generateMetadata() {
apps/web/app/dev/fields/page.tsx:18:export default async function DevFieldsPage() {
apps/web/app/dev/item-sheet/item-sheet-host.tsx:9:export function ItemSheetHost({ itemId, venueId }: { itemId: string; venueId: string }) {
apps/web/app/dev/item-sheet/page.tsx:18:export async function generateMetadata() {
apps/web/app/dev/item-sheet/page.tsx:31:export default async function DevItemSheetPage({ searchParams }: PageProps<'/dev/item-sheet'>) {
apps/web/app/layout.tsx:17:export async function generateMetadata(): Promise<Metadata> {
apps/web/app/layout.tsx:25:export default async function RootLayout({ children }: { children: ReactNode }) {
apps/web/app/login/page.tsx:10:export async function generateMetadata() {
apps/web/app/login/page.tsx:15:export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
apps/web/app/m/[...address]/page.tsx:14:export const metadata: Metadata = {
apps/web/app/m/[...address]/page.tsx:20:export default async function GuestMenuPage({ params }: PageProps<'/m/[...address]'>) {
apps/web/app/no-organization/page.tsx:8:export async function generateMetadata() {
apps/web/app/no-organization/page.tsx:14:export default async function NoOrganizationPage() {
apps/web/app/page.tsx:5:export default function HomePage() {
apps/web/app/t/[token]/route.ts:9:export async function GET(
```

### §1c block: worker job registrations (36 from `jobs.mjs`, plus `WORKER_HEARTBEAT_JOB`, corrected in §1c) and queue send sites (21)
Command: `node jobs.mjs` (scratchpad), over `git grep -l -E "JOB_NAMES\.|defineJob|queue\.send|boss\.send"` in apps/worker/src and apps/web/src/server/jobs.ts, minus tests.
```
REGISTRATIONS (36)
apps/worker/src/jobs/alerts.ts:104 | JOB_NAMES.alertDelivery | retryLimit=0; expireInSeconds=120; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60
apps/worker/src/jobs/alerts.ts:143 | JOB_NAMES.healthcheckPing | retryLimit=0; expireInSeconds=60; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60
apps/worker/src/jobs/barsy.ts:284 | JOB_NAMES.barsyConnect | retryLimit=2; retryDelay=30; retryBackoff=true; expireInSeconds=10 * 60; policy='exclusive'; deleteAfterSeconds=24 * 60 * 60; pollingIntervalSeconds=2
apps/worker/src/jobs/barsy.ts:379 | JOB_NAMES.barsyFullPull | retryLimit=2; retryDelay=60; retryBackoff=true; expireInSeconds=45 * 60; policy='exclusive'; deleteAfterSeconds=24 * 60 * 60; pollingIntervalSeconds=2
apps/worker/src/jobs/barsy.ts:469 | JOB_NAMES.barsyIncremental | retryLimit=0; expireInSeconds=10 * 60; policy='exclusive'; retentionSeconds=30 * 60; deleteAfterSeconds=60 * 60; pollingIntervalSeconds=2
apps/worker/src/jobs/barsy.ts:571 | JOB_NAMES.placesRead | retryLimit=1; retryDelay=60; expireInSeconds=5 * 60; policy='exclusive'; retentionSeconds=30 * 60; deleteAfterSeconds=24 * 60 * 60; pollingIntervalSeconds=2
apps/worker/src/jobs/barsy.ts:620 | JOB_NAMES.assetFetch | retryLimit=3; retryDelay=20; retryBackoff=true; expireInSeconds=5 * 60; policy='exclusive'; deleteAfterSeconds=24 * 60 * 60; pollingIntervalSeconds=2
apps/worker/src/jobs/barsy.ts:763 | JOB_NAMES.barsySyncTick | retryLimit=0; expireInSeconds=120; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60
apps/worker/src/jobs/connection.ts:250 | JOB_NAMES.connectionProbe | retryLimit=0; expireInSeconds=60; policy='stately'; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60; pollingIntervalSeconds=1
apps/worker/src/jobs/connection.ts:279 | JOB_NAMES.connectionTick | retryLimit=0; expireInSeconds=120; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60
apps/worker/src/jobs/floor.ts:390 | JOB_NAMES.floorRead | retryLimit=1; retryDelay=60; expireInSeconds=2 * 60; policy='exclusive'; retentionSeconds=30 * 60; deleteAfterSeconds=24 * 60 * 60; pollingIntervalSeconds=2
apps/worker/src/jobs/floor.ts:418 | JOB_NAMES.floorReadTick | retryLimit=0; expireInSeconds=120; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60
apps/worker/src/jobs/order-send.ts:595 | JOB_NAMES.orderSend | retryLimit=0; expireInSeconds=5 * 60; policy='stately'; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60; pollingIntervalSeconds=1
apps/worker/src/jobs/order-send.ts:627 | JOB_NAMES.orderSlotSweep | retryLimit=0; expireInSeconds=120; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60
apps/worker/src/jobs/order-tidy.ts:140 | JOB_NAMES.orderTidyTick | retryLimit=0; expireInSeconds=120; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60
apps/worker/src/jobs/payment-recovery.ts:349 | JOB_NAMES.paymentRecoveryTick | retryLimit=0; expireInSeconds=120; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60
apps/worker/src/jobs/payments.ts:2207 | JOB_NAMES.paymentPrepare | expireInSeconds=PAYMENT_PREPARE_EXPIRE_SECONDS; policy='stately'; pollingIntervalSeconds=1; ...queue
apps/worker/src/jobs/payments.ts:2217 | JOB_NAMES.paymentCheck | policy='stately'; pollingIntervalSeconds=1
apps/worker/src/jobs/provider-notices.ts:419 | JOB_NAMES.providerNotices | retryLimit=0; expireInSeconds=5 * 60; policy='exclusive'; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60
apps/worker/src/jobs/publish.ts:128 | JOB_NAMES.publishMenu | retryLimit=2; retryDelay=30; retryBackoff=true; expireInSeconds=5 * 60; policy='stately'; deleteAfterSeconds=24 * 60 * 60; pollingIntervalSeconds=2
apps/worker/src/jobs/publish.ts:263 | JOB_NAMES.publishFiles | retryLimit=2; retryDelay=30; retryBackoff=true; expireInSeconds=5 * 60; policy='stately'; deleteAfterSeconds=24 * 60 * 60; pollingIntervalSeconds=2
apps/worker/src/jobs/publish.ts:308 | JOB_NAMES.publishLive | retryLimit=3; retryDelay=5; retryBackoff=true; expireInSeconds=2 * 60; policy='stately'; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60; pollingIntervalSeconds=1
apps/worker/src/jobs/publish.ts:339 | JOB_NAMES.publishLiveTick | retryLimit=0; expireInSeconds=120; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60
apps/worker/src/jobs/publish.ts:367 | JOB_NAMES.assetVariants | retryLimit=3; retryDelay=20; retryBackoff=true; expireInSeconds=5 * 60; policy='exclusive'; deleteAfterSeconds=24 * 60 * 60; pollingIntervalSeconds=2
apps/worker/src/jobs/publish.ts:407 | JOB_NAMES.publishTableTokens | retryLimit=3; retryDelay=10; retryBackoff=true; expireInSeconds=2 * 60; policy='stately'; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60; pollingIntervalSeconds=1
apps/worker/src/jobs/publish.ts:441 | JOB_NAMES.publishOrganizationIndex | retryLimit=2; retryDelay=30; retryBackoff=true; expireInSeconds=5 * 60; policy='stately'; deleteAfterSeconds=24 * 60 * 60; pollingIntervalSeconds=2
apps/worker/src/jobs/purge.ts:1203 | JOB_NAMES.purgeVenue | retryLimit=2; retryDelay=60; retryBackoff=true; expireInSeconds=10 * 60; policy='stately'; deleteAfterSeconds=7 * 24 * 60 * 60; pollingIntervalSeconds=5
apps/worker/src/jobs/purge.ts:1249 | JOB_NAMES.purgeTick | retryLimit=1; retryDelay=15 * 60; expireInSeconds=60 * 60; retentionSeconds=24 * 60 * 60; pollingIntervalSeconds=30
apps/worker/src/jobs/readings.ts:349 | JOB_NAMES.tableRead | retryLimit=0; expireInSeconds=60; policy='exclusive'; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60; pollingIntervalSeconds=1
apps/worker/src/jobs/readings.ts:377 | JOB_NAMES.tableReadTick | retryLimit=0; expireInSeconds=120; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60
apps/worker/src/jobs/seal-table-codes.ts:75 | JOB_NAMES.sealTableCodes | retryLimit=3; retryDelay=5 * 60; retryBackoff=true; expireInSeconds=60 * 60; retentionSeconds=24 * 60 * 60; pollingIntervalSeconds=30
apps/worker/src/jobs/service-day.ts:223 | JOB_NAMES.serviceDayTick | retryLimit=0; expireInSeconds=30 * 60; retentionSeconds=60 * 60; deleteAfterSeconds=24 * 60 * 60
apps/worker/src/jobs/service-hours.ts:259 | JOB_NAMES.serviceHoursTick | none stated
apps/worker/src/jobs/service-hours.ts:272 | JOB_NAMES.preOpeningTick | none stated
apps/worker/src/jobs/stock.ts:326 | JOB_NAMES.stockTick | retryLimit=0; expireInSeconds=4 * 60; retentionSeconds=10 * 60; deleteAfterSeconds=60 * 60
apps/worker/src/jobs/wallet-domain.ts:60 | JOB_NAMES.walletDomain | retryLimit=0; expireInSeconds=10 * 60; policy='exclusive'; retentionSeconds=60 * 60; deleteAfterSeconds=60 * 60

SENDS (21)
apps/worker/src/jobs/barsy.ts:275 | name | none stated
apps/worker/src/jobs/barsy.ts:796 | JOB_NAMES.placesRead | singletonKey=job.singletonKey
apps/worker/src/jobs/barsy.ts:810 | JOB_NAMES.barsyIncremental | singletonKey=job.singletonKey
apps/worker/src/jobs/barsy.ts:820 | JOB_NAMES.barsyFullPull | singletonKey=job.singletonKey
apps/worker/src/jobs/breaker.ts:344 | JOB_NAMES.connectionProbe | singletonKey=job.singletonKey; startAfter=Math.max(0
apps/worker/src/jobs/connection.ts:221 | JOB_NAMES.connectionProbe | singletonKey=job.singletonKey; startAfter=Math.max(0
apps/worker/src/jobs/connection.ts:302 | JOB_NAMES.connectionProbe | singletonKey=job.singletonKey; startAfter=Math.max(0
apps/worker/src/jobs/floor.ts:444 | JOB_NAMES.floorRead | singletonKey=job.singletonKey
apps/worker/src/jobs/order-send.ts:657 | JOB_NAMES.orderSend | singletonKey=job.singletonKey
apps/worker/src/jobs/payment-recovery.ts:330 | name | singletonKey=job.singletonKey; startAfter=afterSeconds
apps/worker/src/jobs/payments.ts:2031 | JOB_NAMES.paymentCheck | singletonKey=`${job.singletonKey; startAfter=Math.max(1
apps/worker/src/jobs/payments.ts:2040 | JOB_NAMES.paymentPrepare | singletonKey=job.singletonKey; startAfter=afterSeconds
apps/worker/src/jobs/provider-notices.ts:257 | JOB_NAMES.paymentCheck | singletonKey=job.singletonKey; ...about
apps/worker/src/jobs/publish.ts:117 | JOB_NAMES.publishTableTokens | singletonKey=tokens.singletonKey
apps/worker/src/jobs/publish.ts:355 | name | none stated
apps/worker/src/jobs/publish.ts:394 | name | none stated
apps/worker/src/jobs/readings.ts:402 | JOB_NAMES.tableRead | singletonKey=job.singletonKey
apps/worker/src/jobs/stock.ts:158 | JOB_NAMES.publishLive | singletonKey=job.singletonKey
apps/worker/src/worker.ts:158 | WORKER_HEARTBEAT_JOB | none stated
apps/worker/src/worker.ts:161 | JOB_NAMES.sealTableCodes | none stated
apps/worker/src/worker.ts:165 | JOB_NAMES.paymentRecoveryTick | none stated
```

### §1d block: Zod parse call sites in entry files (146 direct, 10 chained)
Command: `git grep -n -o -E '[A-Za-z_][A-Za-z0-9_]*\.(safeParse|parse)\(' -- <entry files>` and `git grep -n -o -E '\)\.(safeParse|parse)\('`. JSON.parse and Date.parse removed.
```
apps/web/src/composer/actions.ts:218  PlaceItemInput
apps/web/src/composer/actions.ts:229  MoveSectionInput
apps/web/src/composer/actions.ts:240  CreateSectionInput
apps/web/src/composer/actions.ts:262  CreateItemInput
apps/web/src/composer/actions.ts:280  CurrencySchema
apps/web/src/composer/actions.ts:306  SetItemHiddenInput
apps/web/src/composer/actions.ts:318  SetSectionHiddenInput
apps/web/src/composer/actions.ts:332  SetSectionLayoutInput
apps/web/src/composer/actions.ts:356  RenameSectionInput
apps/web/src/composer/actions.ts:381  SectionInput
apps/web/src/composer/actions.ts:418  RenameItemInput
apps/web/src/composer/actions.ts:443  ItemInput
apps/web/src/composer/payment-mode-actions.ts:29  SetItemPaymentModeInput
apps/web/src/composer/sold-out-actions.ts:32  SetSoldOutInput
apps/web/src/composer/tag-actions.ts:92  CreateTagInput
apps/web/src/composer/tag-actions.ts:102  UpdateTagInput
apps/web/src/composer/tag-actions.ts:112  MoveTagInput
apps/web/src/composer/tag-actions.ts:128  ArchiveTagInput
apps/web/src/composer/tag-actions.ts:143  SetItemTagsInput
apps/web/src/server/composer/guest-features-actions.ts:46  SaveFeaturesInput
apps/web/src/server/composer/guest-features-actions.ts:72  SaveOptionsInput
apps/web/src/server/design/actions.ts:43  LookInput
apps/web/src/server/design/actions.ts:63  TemplateInput
apps/web/src/server/integration/actions.ts:135  Systems
apps/web/src/server/integration/actions.ts:142  NewInstance
apps/web/src/server/integration/actions.ts:149  Connect
apps/web/src/server/integration/actions.ts:156  Rename
apps/web/src/server/integration/actions.ts:163  InstanceOnly
apps/web/src/server/integration/actions.ts:170  InstanceOnly
apps/web/src/server/integration/actions.ts:179  InstanceSettings
apps/web/src/server/integration/actions.ts:186  InstanceOnly
apps/web/src/server/integration/actions.ts:195  VenueSource
apps/web/src/server/integration/actions.ts:203  VenueOnly
apps/web/src/server/item-sheet/actions.ts:49  Ids
apps/web/src/server/item-sheet/actions.ts:150  FieldKey
apps/web/src/server/item-sheet/actions.ts:164  FieldKey
apps/web/src/server/item-sheet/actions.ts:178  FieldKey
apps/web/src/server/item-sheet/actions.ts:194  FieldKey
apps/web/src/server/item-sheet/actions.ts:195  LocaleKey
apps/web/src/server/item-sheet/actions.ts:220  LocalizedTextSchema
apps/web/src/server/item-sheet/actions.ts:221  Focal
apps/web/src/server/menus-actions.ts:90  CreateInput
apps/web/src/server/menus-actions.ts:103  RenameInput
apps/web/src/server/menus-actions.ts:120  MoveInput
apps/web/src/server/menus-actions.ts:141  SettingsInput
apps/web/src/server/menus-actions.ts:158  MenuInput
apps/web/src/server/menus-actions.ts:169  MenuInput
apps/web/src/server/menus-actions.ts:185  MenuInput
apps/web/src/server/menus-actions.ts:222  ImportInput
apps/web/src/server/organization-actions.ts:125  UpdateOrganizationInput
apps/web/src/server/publish/actions.ts:42  venueIdSchema
apps/web/src/server/publish/actions.ts:70  venueIdSchema
apps/web/src/server/publish/actions.ts:121  AutomationSchema
apps/web/src/server/settings/alerts-actions.ts:39  SetRecipients
apps/web/src/server/settings/alerts-actions.ts:53  OnVenue
apps/web/src/server/settings/alerts-actions.ts:67  OnPerson
apps/web/src/server/settings/alerts-actions.ts:113  OnVenue
apps/web/src/server/settings/alerts-actions.ts:121  OnPerson
apps/web/src/server/settings/alerts-actions.ts:132  OnVenue
apps/web/src/server/settings/ordering-actions.ts:21  Save
apps/web/src/server/settings/paying-actions.ts:79  OnVenue
apps/web/src/server/settings/paying-actions.ts:101  OnVenue
apps/web/src/server/settings/paying-actions.ts:117  OnVenue
apps/web/src/server/settings/paying-actions.ts:128  Tick
apps/web/src/server/settings/paying-actions.ts:157  Save
apps/web/src/server/settings/paying-actions.ts:190  SavePayFirst
apps/web/src/server/settings/staff-actions.ts:107  AddPerson
apps/web/src/server/settings/staff-actions.ts:130  OnPerson
apps/web/src/server/settings/staff-actions.ts:147  OnPerson
apps/web/src/server/settings/staff-actions.ts:169  RenamePerson
apps/web/src/server/settings/staff-actions.ts:177  AssignRole
apps/web/src/server/settings/staff-actions.ts:185  OnPerson
apps/web/src/server/settings/staff-actions.ts:195  OnPerson
apps/web/src/server/settings/staff-actions.ts:202  LinkAccount
apps/web/src/server/settings/staff-actions.ts:210  CopyRole
apps/web/src/server/settings/staff-actions.ts:218  UpdateRole
apps/web/src/server/settings/staff-actions.ts:226  OnRole
apps/web/src/server/settings/staff-actions.ts:233  MarkDevice
apps/web/src/server/settings/staff-actions.ts:240  OnDevice
apps/web/src/server/tables/actions.ts:136  RevealTables
apps/web/src/server/tables/actions.ts:165  OnVenue
apps/web/src/server/tables/actions.ts:172  OnTable
apps/web/src/server/tables/actions.ts:181  OnTable
apps/web/src/server/tables/actions.ts:190  Rename
apps/web/src/server/tables/actions.ts:201  CreateArea
apps/web/src/server/tables/actions.ts:208  RenameArea
apps/web/src/server/tables/actions.ts:217  HideArea
apps/web/src/server/tables/actions.ts:226  MoveArea
apps/web/src/server/tables/actions.ts:235  OnArea
apps/web/src/server/tables/actions.ts:246  CreateTable
apps/web/src/server/tables/actions.ts:258  Renumber
apps/web/src/server/tables/actions.ts:267  HideTable
apps/web/src/server/tables/actions.ts:276  MoveTable
apps/web/src/server/tables/actions.ts:285  OnVenueTable
apps/web/src/server/tables/actions.ts:299  MenuRoute
apps/web/src/server/tonight/actions.ts:101  OnTableUndo
apps/web/src/server/tonight/actions.ts:115  OnTableUndo
apps/web/src/server/tonight/actions.ts:129  NewGuests
apps/web/src/server/tonight/actions.ts:143  OnVenue
apps/web/src/server/tonight/actions.ts:150  OnVenue
apps/web/src/server/tonight/actions.ts:157  MarkPayment
apps/web/src/server/tonight/actions.ts:179  OnCall
apps/web/src/server/tonight/actions.ts:193  OnReceipt
apps/web/src/server/tonight/actions.ts:202  OnReceipt
apps/web/src/server/tonight/actions.ts:216  OnBar
apps/web/src/server/tonight/actions.ts:230  OnPause
apps/web/src/server/tonight/actions.ts:244  OnTable
apps/web/src/server/tonight/actions.ts:257  OnSentOrder
apps/web/src/server/tonight/actions.ts:274  UndoOpenAll
apps/web/src/server/tonight/actions.ts:286  OnTableRead
apps/web/src/server/tonight/actions.ts:312  OnRefund
apps/web/src/server/tonight/actions.ts:324  OnRefundUndo
apps/web/src/server/tonight/actions.ts:347  OnAlert
apps/web/src/server/tonight/actions.ts:360  OnPayment
apps/web/src/server/tonight/night-actions.ts:79  SentOrders
apps/web/src/server/tonight/night-actions.ts:98  SentOrder
apps/web/src/server/tonight/night-actions.ts:109  Log
apps/web/src/server/tonight/payment-actions.ts:69  Payments
apps/web/src/server/tonight/payment-actions.ts:85  Payment
apps/web/src/server/venues-actions.ts:175  CreateVenueInput
apps/web/src/server/venues-actions.ts:232  RenameVenueSlugInput
apps/web/src/server/venues-actions.ts:298  RenameVenueInput
apps/web/src/server/venues-actions.ts:337  DeleteVenueInput
apps/web/src/server/venues-actions.ts:397  RestoreVenueInput
apps/web/src/server/venues-actions.ts:433  UnpublishVenueInput
apps/web/src/server/venues-actions.ts:492  PurgeVenueInput
apps/worker/src/jobs/barsy.ts:127  schema
apps/worker/src/jobs/breaker.ts:123  BreakerStateSchema
apps/worker/src/jobs/breaker.ts:342  ConnectionProbeJobSchema
apps/worker/src/jobs/connection.ts:145  ProbeResultSchema
apps/worker/src/jobs/connection.ts:220  ConnectionProbeJobSchema
apps/worker/src/jobs/connection.ts:264  ConnectionProbeJobSchema
apps/worker/src/jobs/connection.ts:296  ConnectionProbeJobSchema
apps/worker/src/jobs/floor.ts:404  VenueSyncJobSchema
apps/worker/src/jobs/order-send.ts:611  OrderSendJobSchema
apps/worker/src/jobs/order-send.ts:656  OrderSendJobSchema
apps/worker/src/jobs/payment-breaker.ts:74  BreakerStateSchema
apps/worker/src/jobs/payments.ts:521  PaymentIdSchema
apps/worker/src/jobs/payments.ts:603  PaymentIdSchema
apps/worker/src/jobs/payments.ts:988  PaymentIdSchema
apps/worker/src/jobs/payments.ts:1803  PaymentStepLinesSchema
apps/worker/src/jobs/payments.ts:1905  PaymentStepLinesSchema
apps/worker/src/jobs/payments.ts:2190  PaymentJobSchema
apps/worker/src/jobs/publish.ts:53  schema
apps/worker/src/jobs/purge.ts:1193  schema
apps/worker/src/jobs/readings.ts:363  TableReadJobSchema
--- chained ---
apps/web/app/api/venues/[venueId]/export/route.ts:36:).safeParse(
apps/web/app/api/venues/[venueId]/night/route.ts:27:).safeParse(
apps/web/src/server/item-sheet/actions.ts:136:).safeParse(
apps/web/src/server/item-sheet/actions.ts:196:).safeParse(
apps/web/src/server/item-sheet/actions.ts:239:).safeParse(
apps/worker/src/jobs/order-send.ts:309:).safeParse(
apps/worker/src/jobs/payments.ts:788:).safeParse(
apps/worker/src/jobs/payments.ts:1421:).safeParse(
apps/worker/src/jobs/readings.ts:217:).safeParse(
apps/worker/src/jobs/stock.ts:191:).safeParse(
```

### §2b block: code files in packages/core/src/service, apps/worker/src/jobs, apps/web/src/server that cite no decision (80; tests excluded)
Command: `git ls-files packages/core/src/service apps/worker/src/jobs apps/web/src/server | grep -v -E '\.test\.tsx?$'`, minus `git grep -l -E 'D1[0-2][0-9]' -- <same paths>`.
```
apps/web/src/server/actions.ts
apps/web/src/server/assets/index.ts
apps/web/src/server/assets/serve-local.ts
apps/web/src/server/assets/upload-handler.ts
apps/web/src/server/assets/upload.ts
apps/web/src/server/composer/guest-features-actions.ts
apps/web/src/server/composer/menu.ts
apps/web/src/server/composer/structure.ts
apps/web/src/server/cookie-prefix.ts
apps/web/src/server/db.ts
apps/web/src/server/design/actions.ts
apps/web/src/server/design/service.ts
apps/web/src/server/guides.ts
apps/web/src/server/ids.ts
apps/web/src/server/integration/actions.ts
apps/web/src/server/integration/gating.ts
apps/web/src/server/integration/service.ts
apps/web/src/server/integration/view.ts
apps/web/src/server/item-sheet/layers.ts
apps/web/src/server/item-sheet/plan.ts
apps/web/src/server/jobs.ts
apps/web/src/server/log.ts
apps/web/src/server/menus-actions.ts
apps/web/src/server/menus.ts
apps/web/src/server/organization-actions-result.ts
apps/web/src/server/organization-actions.ts
apps/web/src/server/payments-connection.ts
apps/web/src/server/publish/actions.ts
apps/web/src/server/publish/cdn.ts
apps/web/src/server/publish/load.ts
apps/web/src/server/publish/service.ts
apps/web/src/server/publish/store.ts
apps/web/src/server/publish/summary.ts
apps/web/src/server/publish/view.ts
apps/web/src/server/roles.ts
apps/web/src/server/settings/alerts-actions.ts
apps/web/src/server/settings/alerts-view.ts
apps/web/src/server/settings/ordering-actions.ts
apps/web/src/server/settings/ordering-view.ts
apps/web/src/server/settings/scope.ts
apps/web/src/server/settings/staff-actions.ts
apps/web/src/server/settings/staff-view.ts
apps/web/src/server/tables/actions.ts
apps/web/src/server/tables/address.ts
apps/web/src/server/tables/download.ts
apps/web/src/server/tables/qr-image.ts
apps/web/src/server/telegram-link.ts
apps/web/src/server/test-database.ts
apps/web/src/server/till-label.ts
apps/web/src/server/tonight/export-csv.ts
apps/web/src/server/tonight/landing.ts
apps/web/src/server/tonight/load.ts
apps/web/src/server/tonight/night-actions.ts
apps/web/src/server/tonight/night-csv.ts
apps/web/src/server/tonight/night-load.ts
apps/web/src/server/tonight/night-view.ts
apps/web/src/server/tonight/payment-actions.ts
apps/web/src/server/tonight/payment-load.ts
apps/web/src/server/tonight/payment-view.ts
apps/web/src/server/venues-actions.ts
apps/web/src/server/venues-result.ts
apps/web/src/server/venues.ts
apps/worker/src/jobs/barsy.ts
apps/worker/src/jobs/index.ts
apps/worker/src/jobs/publish.ts
apps/worker/src/jobs/types.ts
apps/worker/src/jobs/worker-heartbeat.ts
packages/core/src/service/apply-service.ts
packages/core/src/service/night-export.ts
packages/core/src/service/night-payments.ts
packages/core/src/service/night-report-sent.ts
packages/core/src/service/pay-first-sent-order.ts
packages/core/src/service/payment-todos.ts
packages/core/src/service/receipt-rows.ts
packages/core/src/service/receipts.ts
packages/core/src/service/send-timings.ts
packages/core/src/service/sent-lines.ts
packages/core/src/service/staff-amount.ts
packages/core/src/service/telegram-link-text.ts
packages/core/src/service/undo.ts
```

### §3 block: i18n key lists (from unused.mjs; UNUSED = no family and no word match; MAYBE_DYNAMIC = a family template exists)
Command: `node unused.mjs` (scratchpad) over both.txt (2123 keys in both files) and the word set of `git grep -o -h -E '[A-Za-z_][A-Za-z0-9_]*' -- apps/web/src`.
```
keys 2123 used-by-last-segment 2057 maybe-dynamic(unmatched, family prefix) 21 unused 45
UNUSED
fields.units.kg
fields.units.pcs
options.allergens.crustaceans
options.allergens.fish
options.allergens.peanuts
options.allergens.soybeans
options.allergens.nuts
options.allergens.celery
options.allergens.mustard
options.allergens.sesame
options.allergens.lupin
options.dietary.vegetarian
options.dietary.lactose_free
options.dietary.halal
options.dietary.kosher
auth.inviteOnly
workspace.comingInStage
connectors.barsy.price.actualHelp
connectors.barsy.price.currentHelp
tonight.ck_waiter
tonight.ck_bill
tonight.ck_ice
tonight.ck_water
tonight.ck_glasses
tonight.ck_clean_table
tonight.ck_terminal
tonight.st_waiting
tonight.st_sending
tonight.st_checking
tonight.rs_soldout
tonight.rs_refused
tonight.rs_paused
tonight.rs_closed
tonight.rs_hours
tonight.nt_fix_so
tonight.lg_g_cap
tonight.lg_g_pace
tonight.lg_g_rate
tonight.lg_g_pin
tonight.lg_g_other
tonight.nt_tg_pay
ownerSettings.st_password_invalid
ownerSettings.st_password_tooMany
ownerSettings.st_password_unknown
ownerSettings.sf_e_pins
MAYBE_DYNAMIC
composer.visibility.sectionHidden
publish.automation.sync.autoHelp
publish.automation.sync.manualHelp
publish.automation.afterSync.autoHelp
publish.automation.afterSync.manualHelp
venueMenus.errors.unknown_source
tables.row.menuNone
tonight.errors.call_missing
tonight.errors.call_lapsed
tonight.errors.pause_missing
tonight.errors.restro_pause
tonight.errors.bar_missing
tonight.errors.alert_missing
ownerSettings.st_day.mon
ownerSettings.st_day.tue
ownerSettings.st_day.wed
ownerSettings.st_day.sun
ownerSettings.st_day_short.mon
ownerSettings.st_day_short.tue
ownerSettings.st_day_short.wed
ownerSettings.st_day_short.sun
```

### §4a block: glossary wrong forms (one row per wrong form: term | wrong form | en.json hits | code identifier hits in N files | up to 4 en keys | up to 4 files)
Command: `node terms.mjs` (scratchpad) over GLOSSARY.md.
```
TERMS WITH AN AVOID LIST: 66; wrong forms: 175
Organisation | tenant | en:1 | code:3511 in 261 files | en keys: devItemSheet.noMenu | files: apps/web/app/(admin)/guides/qr-links/page.tsx, apps/web/app/(admin)/layout.tsx, apps/web/app/(admin)/settings/deleted-venues/page.tsx, apps/web/app/(admin)/settings/general/page.tsx
Organisation | account | en:13 | code:1480 in 114 files | en keys: tonight.errors.permission_denied, tonight.pb_lost, tonight.pb_restricted, ownerSettings.err.account_unknown | files: apps/web/scripts/seed-design-e2e.ts, apps/web/scripts/seed-dev.ts, apps/web/scripts/seed-integration-e2e.ts, apps/web/scripts/seed-lifecycle-e2e.ts
Organisation | company | en:1 | code:4 in 3 files | en keys: ownerSettings.pa_eik | files: packages/core/src/legal-details.ts, packages/shell/src/services.ts, packages/shell/src/strings.ts
Venue | location | en:2 | code:374 in 41 files | en keys: ownerSettings.st_spot_unset, ownerSettings.st_loc_denied | files: apps/web/playwright.config.ts, apps/web/scripts/seed-order-e2e.ts, apps/web/scripts/seed-send-e2e.ts, apps/web/src/composer/item-param.ts
Venue | club | en:4 | code:150 in 38 files | en keys: venues.new.slugInvalid, workspace.settings.slug.help, workspace.settings.slug.invalid, connectors.barsy.connect.hostExample | files: apps/web/scripts/lib/guard.ts, apps/web/scripts/publish-e2e.ts, apps/web/scripts/seed-design-e2e.ts, apps/web/scripts/seed-dev.ts
Venue | restaurant | en:0 | code:1 in 1 files | files: packages/core/src/floor-source.ts
Venue | store | en:0 | code:743 in 135 files | files: apps/web/app/(print)/venues/[venueId]/tables/print/page.tsx, apps/web/app/api/assets/file/[...key]/route.ts, apps/web/app/api/assets/route.ts, apps/web/app/api/health/route.ts
Source | menu source | en:4 | code:32 in 7 files | en keys: venues.new.sources.legend, menuSource.title, menuSource.readOnly, tables.empty.action | files: apps/web/src/components/admin/venue-settings-general.tsx, apps/web/src/connectors/test-view.ts, apps/web/src/integration/menu-source-card.tsx, apps/web/src/integration/menu-source-skeleton.tsx
POS venue | barsy venue | en:0 | code:127 in 30 files | files: apps/web/scripts/lib/seed-demo-bar.ts, apps/web/scripts/seed-integration-e2e.ts, apps/web/scripts/seed-lifecycle-e2e.ts, apps/web/scripts/seed-paying-e2e.ts
POS venue | till venue | en:2 | code:175 in 30 files | en keys: settings.deletedVenues.errors.till_taken, workspace.settings.danger.dialog.effects.till | files: apps/web/src/components/admin/new-venue-dialog.tsx, apps/web/src/components/admin/venue-card.tsx, apps/web/src/composer/action-result.ts, apps/web/src/composer/actions.ts
POS venue | synced venue | en:0 | code:0 in 0 files
Hand-made venue | by-hand venue | en:0 | code:0 in 0 files
Hand-made venue | Restro venue | en:1 | code:1 in 1 files | en keys: auth.description | files: packages/payments/stripe/src/provider.ts
Hand-made venue | manual venue | en:0 | code:0 in 0 files
Archived | deleted | en:36 | code:457 in 102 files | en keys: itemSheet.linkState.deleted, itemSheet.issues.link_deleted, settings.sections.deletedVenues, settings.deletedVenues.description | files: apps/web/app/(admin)/settings/deleted-venues/page.tsx, apps/web/app/(admin)/settings/layout.tsx, apps/web/scripts/seed-integration-e2e.ts, apps/web/src/components/admin/delete-venue-dialog.tsx
Archived | binned | en:0 | code:50 in 18 files | files: apps/web/src/components/admin/menus-card.tsx, apps/web/src/composer/actions.ts, apps/web/src/composer/menu-bar.tsx, apps/web/src/server/composer/menu.ts
Deleted | archived | en:3 | code:537 in 97 files | en keys: fields.tags.kept, composer.errors.rejected, composer.tags.archivedTitle | files: apps/web/app/(admin)/settings/deleted-venues/page.tsx, apps/web/app/dev/item-sheet/page.tsx, apps/web/scripts/seed-tables-e2e.ts, apps/web/scripts/seed-tonight-e2e.ts
Deleted | removed | en:7 | code:283 in 82 files | en keys: itemSheet.imageRemoved, itemSheet.history.cleared, publish.changes.summary.hidden, publish.changes.lists.hidden | files: apps/web/scripts/seed-integration-e2e.ts, apps/web/scripts/seed-lifecycle-e2e.ts, apps/web/scripts/seed-navigation-e2e.ts, apps/web/scripts/seed-no-till-e2e.ts
Purge | hard delete | en:0 | code:0 in 0 files
Purge | wipe | en:0 | code:4 in 3 files | files: apps/web/src/server/tonight/actions.ts, packages/barsy/src/mapping/catalogue.ts, packages/core/src/service/payment-refunds.ts
POS | till | en:24 | code:1899 in 196 files | en keys: settings.deletedVenues.description, settings.deletedVenues.purgeDialog.effects.kept, settings.deletedVenues.restoredLinked, settings.deletedVenues.errors.till_taken | files: apps/web/app/(admin)/settings/deleted-venues/page.tsx, apps/web/app/(admin)/venues/[venueId]/page.tsx, apps/web/playwright.config.ts, apps/web/scripts/lib/demo-bar.ts
POS | cash register | en:0 | code:0 in 0 files
POS | ERP | en:0 | code:0 in 0 files
POS system | vendor | en:0 | code:18 in 13 files | files: apps/web/src/connectors/card-form-types.ts, apps/web/src/connectors/card-forms.ts, apps/web/src/connectors/notices.ts, apps/web/src/connectors/providers.ts
POS system | provider | en:30 | code:1982 in 161 files | en keys: tonight.mr_d_charged, tonight.pb_paused, tonight.pb_lost, tonight.pb_restricted | files: apps/web/app/(admin)/layout.tsx, apps/web/app/api/payments/notices/[kind]/handle.ts, apps/web/app/api/payments/notices/[kind]/route.ts, apps/web/app/api/venues/[venueId]/night/route.ts
Instance | integration | en:6 | code:2130 in 175 files | en keys: settings.sections.integrations, venues.new.sources.connect, venues.new.instance.noVenues, composer.empty.noSections.description | files: apps/web/app/(admin)/layout.tsx, apps/web/app/(admin)/settings/integrations/page.tsx, apps/web/app/(admin)/venues/page.tsx, apps/web/app/(print)/venues/[venueId]/tables/print/page.tsx
Instance | connection | en:55 | code:803 in 126 files | en keys: itemSheet.media.errors.network, settings.integrations.description, venues.new.instance.noVenues, publish.automation.inherited | files: apps/web/app/(admin)/settings/integrations/page.tsx, apps/web/app/(admin)/venues/[venueId]/page.tsx, apps/web/scripts/seed-design-e2e.ts, apps/web/scripts/seed-integration-e2e.ts
Instance | account | en:13 | code:1480 in 114 files | en keys: tonight.errors.permission_denied, tonight.pb_lost, tonight.pb_restricted, ownerSettings.err.account_unknown | files: apps/web/scripts/seed-design-e2e.ts, apps/web/scripts/seed-dev.ts, apps/web/scripts/seed-integration-e2e.ts, apps/web/scripts/seed-lifecycle-e2e.ts
Connector | plugin | en:0 | code:10 in 6 files | files: apps/web/next.config.ts, apps/web/postcss.config.mjs, apps/web/src/server/auth.ts, apps/web/src/server/organization-actions.ts
Connector | driver | en:0 | code:14 in 8 files | files: packages/connectors/sim-pos/src/testing/test-harness.ts, packages/core/src/apply/provision.ts, packages/core/src/connectors/payment/testing/harness.ts, packages/core/src/connectors/service/testing/checks-write.ts
Sync | import | en:4 | code:5206 in 878 files | en keys: venueMenus.import.open, venueMenus.import.title, venueMenus.import.none, venueMenus.import.submit | files: apps/web/app/(admin)/guides/qr-links/page.tsx, apps/web/app/(admin)/layout.tsx, apps/web/app/(admin)/settings/deleted-venues/page.tsx, apps/web/app/(admin)/settings/general/page.tsx
Sync | pull | en:0 | code:563 in 65 files | files: apps/web/scripts/lib/demo-bar.ts, apps/web/scripts/lib/demo-menu.ts, apps/web/scripts/lib/seed-demo-bar.ts, apps/web/scripts/lib/seed-demo-menu.ts
Full read | full pull | en:0 | code:142 in 19 files | files: apps/web/scripts/seed-integration-e2e.ts, apps/web/src/connectors/barsy/server.ts, apps/web/src/connectors/sync-reads.ts, apps/web/src/connectors/test-view.ts
Full read | full sync | en:8 | code:0 in 0 files | en keys: integration.status.held.title, integration.status.held.titleNoVenue, integration.status.held.too_many_missing, integration.status.held.empty_read
Menu | catalogue | en:0 | code:302 in 35 files | files: apps/web/scripts/lib/demo-bar.ts, apps/web/scripts/lib/demo-menu.ts, apps/web/scripts/lib/seed-demo-menu.ts, apps/web/src/connectors/barsy/server.ts
Menu | card | en:45 | code:1212 in 211 files | en keys: composer.guestFeatures.kinds.terminal, tables.intro, tables.print.pages, design.colours.secondary.help | files: apps/web/app/(admin)/settings/integrations/page.tsx, apps/web/app/(admin)/venues/[venueId]/page.tsx, apps/web/app/(admin)/venues/page.tsx, apps/web/app/(print)/venues/[venueId]/tables/print/page.tsx
Live menu | main menu | en:0 | code:3 in 1 files | files: apps/web/src/tables/test-view.ts
Live menu | default menu | en:0 | code:7 in 2 files | files: apps/web/src/composer/menu-bar.tsx, packages/core/src/snapshot/build.ts
Section | category | en:1 | code:241 in 40 files | en keys: design.roles.accent_text.help | files: apps/web/scripts/lib/demo-bar.ts, apps/web/scripts/lib/demo-menu.ts, apps/web/scripts/lib/seed-demo-menu.ts, apps/web/scripts/seed-item-sheet.ts
Section | group | en:13 | code:1262 in 160 files | en keys: settings.general.address.help, settings.general.address.invalid, composer.issues.group_min_max, ownerSettings.err.no_group | files: apps/web/scripts/lib/demo-bar.ts, apps/web/scripts/seed-integration-e2e.ts, apps/web/scripts/seed-visual-e2e.ts, apps/web/src/components/admin/app-sidebar.tsx
Item | product | en:0 | code:11 in 4 files | files: packages/barsy/src/mapping/allergens.ts, packages/core/src/money.ts, packages/payments/stripe/src/testing/test-harness.ts, packages/shell/src/money.ts
Item | article | en:3 | code:816 in 60 files | en keys: integration.history.counters.articles_seen, connectors.barsy.settings.allergen.help, connectors.barsy.price.actualHelp | files: apps/web/scripts/lib/demo-bar.ts, apps/web/scripts/lib/demo-menu.ts, apps/web/scripts/lib/seed-demo-bar.ts, apps/web/scripts/lib/seed-demo-menu.ts
Item | dish | en:1 | code:141 in 25 files | en keys: design.roles.background.help | files: apps/web/scripts/seed-visual-e2e.ts, apps/web/src/guest/context.ts, apps/web/src/guest/guest-menu.tsx, apps/web/src/publish/phone-frame.tsx
Item | drink | en:0 | code:26 in 13 files | files: apps/web/scripts/lib/demo-menu.ts, apps/web/scripts/seed-design-e2e.ts, apps/web/scripts/seed-guest-e2e.ts, apps/web/scripts/seed-order-e2e.ts
Item schema | template | en:13 | code:503 in 103 files | en keys: devFields.description, design.errors.unknown_face, design.templates.title, design.templates.use | files: apps/web/app/dev/fields/page.tsx, apps/web/app/layout.tsx, apps/web/playwright.config.ts, apps/web/scripts/seed-design-e2e.ts
Dictionary | translations | en:4 | code:570 in 183 files | en keys: itemSheet.description, itemSheet.tabs.translations, itemSheet.translations.intro, composer.itemSheet.stub | files: apps/web/app/(admin)/guides/qr-links/page.tsx, apps/web/app/(admin)/settings/deleted-venues/page.tsx, apps/web/app/(admin)/settings/general/page.tsx, apps/web/app/(admin)/settings/integrations/page.tsx
Tag | badge | en:3 | code:436 in 67 files | en keys: design.colours.tertiary.help, design.roles.accent.help, design.roles.on_accent.help | files: apps/web/scripts/seed-visual-e2e.ts, apps/web/src/components/admin/menus-card.tsx, apps/web/src/components/admin/stage-placeholder.tsx, apps/web/src/components/admin/venue-card.tsx
Tag | label | en:2 | code:1873 in 278 files | en keys: composer.tags.description, composer.chips.moreDietary | files: apps/web/app/(admin)/guides/qr-links/page.tsx, apps/web/app/(admin)/venues/[venueId]/page.tsx, apps/web/app/(print)/venues/[venueId]/tables/print/page.tsx, apps/web/app/api/payments/notices/[kind]/handle.ts
Sold out | unavailable | en:0 | code:106 in 39 files | files: apps/web/scripts/seed-tonight-e2e.ts, apps/web/src/guest/use-table-services.ts, apps/web/src/server/integration/service.ts, apps/web/src/server/integration/view.ts
Sold out | out of stock | en:2 | code:72 in 20 files | en keys: tonight.notices.item_out_of_stock, tonight.oos_t | files: apps/web/scripts/seed-tonight-e2e.ts, apps/web/src/server/tonight/view.ts, apps/web/src/tonight/action-rows.tsx, apps/web/src/tonight/tonight-panel.tsx
Composer | editor | en:1 | code:160 in 31 files | en keys: devFields.description | files: apps/web/src/composer/composer.tsx, apps/web/src/composer/item-sheet-details-tab.tsx, apps/web/src/composer/item-sheet-translations-tab.tsx, apps/web/src/composer/item-sheet.tsx
Composer | builder | en:0 | code:97 in 38 files | files: apps/web/scripts/seed-visual-e2e.ts, apps/web/src/composer/actions.ts, apps/web/src/composer/composer.tsx, apps/web/src/composer/item-sheet.tsx
Template | face | en:0 | code:691 in 113 files | files: apps/web/playwright.config.ts, apps/web/scripts/lib/seed-demo-menu.ts, apps/web/scripts/seed-guest-e2e.ts, apps/web/scripts/seed-order-e2e.ts
Template | theme | en:1 | code:686 in 67 files | en keys: user.theme | files: apps/web/app/layout.tsx, apps/web/scripts/seed-design-e2e.ts, apps/web/scripts/seed-guest-e2e.ts, apps/web/scripts/seed-visual-e2e.ts
Template | skin; never for the item schema | en:0 | code:0 in 0 files
Guest page | guest menu | en:4 | code:22 in 8 files | en keys: itemSheet.issues.V3, itemSheet.issues.V6, composer.soldOut.liveLater, workspace.settings.rename.help | files: apps/web/app/m/[...address]/page.tsx, apps/web/src/components/admin/organization-general.tsx, apps/web/src/components/admin/venue-address.tsx, apps/web/src/guest/guest-menu.tsx
Guest page | public page | en:1 | code:0 in 0 files | en keys: tables.queuedLate
Guest page | shell | en:0 | code:210 in 105 files | files: apps/web/app/m/[...address]/page.tsx, apps/web/next.config.ts, apps/web/scripts/seed-guest-e2e.ts, apps/web/scripts/seed-order-e2e.ts
Guest feature | guest function | en:0 | code:0 in 0 files
Guest feature | service screen | en:0 | code:0 in 0 files
Area | hall | en:1 | code:214 in 39 files | en keys: tables.emptyHand.description | files: apps/web/app/(print)/venues/[venueId]/tables/print/page.tsx, apps/web/scripts/lib/seed-demo-bar.ts, apps/web/scripts/seed-lifecycle-e2e.ts, apps/web/scripts/seed-order-e2e.ts
Area | salon | en:0 | code:88 in 12 files | files: apps/web/scripts/seed-lifecycle-e2e.ts, apps/web/scripts/seed-paying-e2e.ts, apps/web/scripts/seed-tables-e2e.ts, packages/barsy/src/mapping/places.ts
Area | zone | en:3 | code:308 in 75 files | en keys: venues.new.defaults, workspace.settings.timezone, workspace.settings.danger.title | files: apps/web/src/components/admin/deleted-venues-list.tsx, apps/web/src/components/admin/menus-card.tsx, apps/web/src/components/admin/new-venue-dialog.tsx, apps/web/src/components/admin/venue-danger-zone.tsx
Area | room | en:0 | code:10 in 7 files | files: apps/web/src/composer/composer.tsx, apps/web/src/fields/tag-chip.tsx, apps/web/src/settings/paying-legal.tsx, packages/core/src/service/send-timings.ts
Table code | QR token | en:0 | code:44 in 12 files | files: apps/web/scripts/seed-lifecycle-e2e.ts, apps/web/scripts/seed-order-e2e.ts, apps/web/scripts/seed-send-e2e.ts, apps/web/scripts/seed-tables-e2e.ts
Table code | QR link | en:0 | code:1 in 1 files | files: apps/web/app/(admin)/guides/qr-links/page.tsx
Table code | sticker | en:6 | code:20 in 16 files | en keys: tables.confirmDeleteArea.description, tables.confirmNew.description, tables.confirmOff.description, tables.confirmDeleteTable.description | files: apps/web/app/t/[token]/route.ts, apps/web/src/server/reveal.ts, apps/web/src/server/tables/actions.ts, apps/web/src/server/tables/service.ts
Open for phones | open table | en:0 | code:26 in 13 files | files: apps/web/src/server/tonight/actions.ts, apps/web/src/settings/ordering-panel.tsx, apps/web/src/tonight/table-sheet.tsx, apps/web/src/tonight/tables-grid.tsx
Open for phones | seated table | en:0 | code:0 in 0 files
Open for phones | active table | en:0 | code:0 in 0 files
Open for phones | occupied table | en:0 | code:0 in 0 files
Sitting | visit | en:0 | code:24 in 10 files | files: apps/web/src/composer/composer.tsx, apps/web/src/composer/reducer.ts, apps/web/src/guest/services-client.ts, apps/web/src/server/composer/structure.ts
Sitting | session | en:0 | code:441 in 107 files | files: apps/web/app/(admin)/guides/qr-links/page.tsx, apps/web/app/(admin)/layout.tsx, apps/web/app/(admin)/settings/deleted-venues/page.tsx, apps/web/app/(admin)/settings/general/page.tsx
Sitting | occupancy | en:0 | code:0 in 0 files
Bar | area | en:41 | code:1091 in 76 files | en keys: publish.publishConfirm.notLive, publish.publishConfirm.notLiveUnrouted, venueMenus.description, tables.intro | files: apps/web/app/(print)/venues/[venueId]/tables/print/page.tsx, apps/web/scripts/seed-lifecycle-e2e.ts, apps/web/scripts/seed-no-till-e2e.ts, apps/web/scripts/seed-order-e2e.ts
Bar | station | en:0 | code:0 in 0 files
Bar | counter | en:0 | code:176 in 27 files | files: apps/web/scripts/seed-integration-e2e.ts, apps/web/src/connectors/sync-reads.ts, apps/web/src/connectors/test-view.ts, apps/web/src/integration/format.ts
Payment table | virtual table | en:0 | code:0 in 0 files
Payment table | buffer table | en:0 | code:0 in 0 files
Payment table | QR table | en:0 | code:0 in 0 files
Guest address | URL | en:0 | code:1175 in 190 files | files: apps/web/app/(print)/venues/[venueId]/tables/print/page.tsx, apps/web/app/api/assets/file/[...key]/route.ts, apps/web/app/api/tables/[tableId]/qr/route.ts, apps/web/app/api/venues/[venueId]/export/route.ts
Guest address | link | en:24 | code:2339 in 224 files | en keys: settings.general.address.keep, workspace.settings.danger.dialog.effects.till, workspace.settings.slug.keep, integration.history.refusedCodes.unknown_link | files: apps/web/app/(admin)/guides/qr-links/page.tsx, apps/web/app/(admin)/venues/[venueId]/page.tsx, apps/web/app/(print)/venues/[venueId]/tables/print/page.tsx, apps/web/app/dev/item-sheet/page.tsx
Guest address | slug | en:0 | code:954 in 71 files | files: apps/web/app/(admin)/settings/general/page.tsx, apps/web/app/(admin)/venues/[venueId]/page.tsx, apps/web/app/api/venues/[venueId]/export/route.ts, apps/web/app/api/venues/[venueId]/night/route.ts
Service day | day | en:12 | code:1591 in 157 files | en keys: fields.availability.nextDay, itemSheet.details.sale.markNote, itemSheet.details.sale.lapsesNote, settings.deletedVenues.description | files: apps/web/app/(admin)/settings/deleted-venues/page.tsx, apps/web/app/(admin)/venues/[venueId]/page.tsx, apps/web/app/api/payments/notices/[kind]/handle.ts, apps/web/app/api/venues/[venueId]/export/route.ts
Service day | night | en:25 | code:868 in 94 files | en keys: settings.general.address.help, settings.general.address.invalid, tonight.tab_night, tonight.lg_empty | files: apps/web/app/api/venues/[venueId]/export/route.ts, apps/web/app/api/venues/[venueId]/night/route.ts, apps/web/scripts/lib/demo-bar.ts, apps/web/scripts/seed-guest-e2e.ts
Service day | shift | en:0 | code:15 in 10 files | files: apps/web/src/fields/types/time.tsx, apps/web/src/publish/draft-face.tsx, apps/web/src/tonight/day-picker.tsx, apps/web/src/tonight/log-export.tsx
Order | bag | en:2 | code:242 in 26 files | en keys: design.preview.servicesHint, tonight.lg_g_rate | files: apps/web/src/guest/use-table-services.ts, packages/faces/editorial-market/src/detail.tsx, packages/faces/editorial-market/src/face.tsx, packages/faces/editorial-market/src/icons.tsx
Order | cart | en:0 | code:1 in 1 files | files: packages/core/src/service/sittings.ts
Order | basket | en:0 | code:0 in 0 files
Order | the table's order | en:0 | code:0 in 0 files
Earlier order | earlier bag | en:0 | code:0 in 0 files
Earlier order | old cart | en:0 | code:0 in 0 files
Earlier order | saved order | en:0 | code:0 in 0 files
Sent order | round | en:1 | code:476 in 97 files | en keys: design.style.radiusHelp | files: apps/web/playwright.config.ts, apps/web/src/composer/actions.ts, apps/web/src/composer/item-sheet-media-tab.tsx, apps/web/src/composer/item-sheet-upload.ts
Sent order | request | en:4 | code:1177 in 165 files | en keys: itemSheet.media.errors.bad_origin, composer.guestFeatures.kinds.legend, publish.errors.invalid, venueMenus.errors.invalid | files: apps/web/app/api/assets/file/[...key]/route.ts, apps/web/app/api/assets/route.ts, apps/web/app/api/auth/[...all]/route.ts, apps/web/app/api/guest/actions/route.ts
Sent order | ticket | en:0 | code:170 in 82 files | files: apps/web/src/guest/turnstile.ts, apps/web/src/server/guard/bad-codes.ts, apps/web/src/server/guest-api.ts, apps/web/src/server/reveal.ts
Sent order state | pending | en:0 | code:355 in 72 files | files: apps/web/src/components/admin/delete-venue-dialog.tsx, apps/web/src/components/admin/deleted-venues-list.tsx, apps/web/src/components/admin/menus-card.tsx, apps/web/src/components/admin/new-venue-dialog.tsx
Sent order state | accepted | en:1 | code:311 in 90 files | en keys: itemSheet.media.errors.unsupported_type | files: apps/web/src/composer/item-sheet-media-tab.tsx, apps/web/src/connectors/signed-notices.ts, apps/web/src/fields/money-input.ts, apps/web/src/guest/services-client.ts
Sent order state | rejected | en:1 | code:198 in 63 files | en keys: publish.history.rejected | files: apps/web/scripts/lib/seed-demo-bar.ts, apps/web/scripts/lib/seed-demo-menu.ts, apps/web/scripts/seed-design-e2e.ts, apps/web/scripts/seed-guest-e2e.ts
Sent order state | failed | en:5 | code:1057 in 241 files | en keys: itemSheet.errors.failed, itemSheet.media.errors.server_error, auth.error.unknown, integration.history.status.failed | files: apps/web/app/api/payments/notices/[kind]/handle.ts, apps/web/app/api/venues/[venueId]/export/route.ts, apps/web/app/api/venues/[venueId]/night/route.ts, apps/web/scripts/publish-e2e.ts
Sent order state | unknown | en:3 | code:1371 in 343 files | en keys: integration.history.refusedCodes.unknown_field, integration.history.refusedCodes.unknown_node, integration.history.refusedCodes.unknown_link | files: apps/web/scripts/lib/demo-bar.ts, apps/web/scripts/lib/demo-menu.ts, apps/web/scripts/publish-e2e.ts, apps/web/scripts/seed-design-e2e.ts
Read-back | reconcile | en:0 | code:13 in 7 files | files: packages/core/src/service/payment-observe.ts, packages/core/src/service/payment-refunds.ts, packages/core/src/theme/derive.ts, packages/faces/editorial-market/src/services/pay-sheet.tsx
Read-back | lookup | en:0 | code:7 in 5 files | files: apps/web/src/components/admin/app-sidebar.tsx, apps/web/src/guest/context.ts, packages/core/src/service/guest.ts, packages/db/src/schema.ts
Reading | snapshot | en:0 | code:1373 in 117 files | files: apps/web/app/api/health/route.ts, apps/web/scripts/publish-e2e.ts, apps/web/scripts/seed-design-e2e.ts, apps/web/scripts/seed-guest-e2e.ts
Reading | cache | en:0 | code:76 in 47 files | files: apps/web/app/api/health/route.ts, apps/web/app/api/payments/notices/[kind]/handle.ts, apps/web/app/api/tables/[tableId]/qr/route.ts, apps/web/app/api/venues/[venueId]/export/route.ts
Reading | sync | en:43 | code:839 in 117 files | en keys: itemSheet.history.tillSync, publish.actor.sync, publish.live.reason.auto_sync, publish.held.text | files: apps/web/next.config.ts, apps/web/playwright.config.ts, apps/web/scripts/lib/demo-bar.ts, apps/web/scripts/lib/guard.ts
Approval | confirmation | en:2 | code:158 in 31 files | en keys: design.roles.success.help, design.roles.success_text.help | files: apps/web/src/components/admin/unpublish-venue-dialog.tsx, apps/web/src/composer/composer-context.tsx, apps/web/src/connectors/stripe/card-form.ts, apps/web/src/integration/error-note.tsx
Approval | acceptance | en:0 | code:4 in 4 files | files: apps/web/scripts/lib/guard.ts, apps/web/scripts/seed-dev.ts, packages/faces/editorial-market/src/services/provider.tsx, packages/payments/stripe/src/config.ts
Table pause | table lock | en:0 | code:0 in 0 files
Table pause | blocked table | en:0 | code:0 in 0 files
Venue pause | breaker | en:0 | code:388 in 24 files | files: apps/web/scripts/seed-tonight-e2e.ts, apps/worker/src/jobs/breaker.ts, apps/worker/src/jobs/connection.ts, apps/worker/src/jobs/floor.ts
Venue pause | outage mode | en:0 | code:0 in 0 files
Venue pause | menu-only | en:0 | code:0 in 0 files
Venue pause | offline | en:0 | code:41 in 14 files | files: apps/web/src/guest/services-client.ts, packages/connectors/sim-pos/src/connector.ts, packages/connectors/sim-pos/src/control/ops.ts, packages/connectors/sim-pos/src/control/view.ts
Pre-opening check | health check | en:0 | code:0 in 0 files
Pre-opening check | smoke test | en:0 | code:0 in 0 files
Log | history | en:12 | code:252 in 49 files | en keys: itemSheet.description, itemSheet.tabs.history, itemSheet.details.editorDescription, itemSheet.history.error | files: apps/web/scripts/seed-integration-e2e.ts, apps/web/scripts/seed-item-sheet.ts, apps/web/scripts/seed-lifecycle-e2e.ts, apps/web/scripts/seed-no-till-e2e.ts
Log | audit trail | en:0 | code:0 in 0 files
Log | orphaned-orders list | en:0 | code:0 in 0 files
Log | activity feed | en:0 | code:0 in 0 files
Tonight | operations panel | en:0 | code:0 in 0 files
Tonight | staff app | en:0 | code:0 in 0 files
Tonight | waiter screen | en:0 | code:0 in 0 files
Tonight | dashboard | en:0 | code:39 in 21 files | files: apps/web/src/guest/turnstile.ts, apps/web/src/server/tonight/view.ts, apps/worker/src/jobs/types.ts, packages/core/src/connectors/payment/capabilities.ts
Connection pause | breaker | en:0 | code:388 in 24 files | files: apps/web/scripts/seed-tonight-e2e.ts, apps/worker/src/jobs/breaker.ts, apps/worker/src/jobs/connection.ts, apps/worker/src/jobs/floor.ts
Connection pause | circuit | en:0 | code:0 in 0 files
Capability | feature flag | en:0 | code:0 in 0 files
Capability | support level | en:0 | code:0 in 0 files
Bill | tab | en:8 | code:712 in 179 files | en keys: itemSheet.details.editorDescription, itemSheet.details.readOnly.sold_out_control, workspace.switchTab, workspace.settings.slug.openTitle | files: apps/web/app/(admin)/guides/qr-links/page.tsx, apps/web/app/(admin)/settings/integrations/page.tsx, apps/web/app/(admin)/venues/[venueId]/page.tsx, apps/web/app/(admin)/venues/page.tsx
Bill | check | en:61 | code:1890 in 344 files | en keys: itemSheet.issueCount, itemSheet.issues.title, itemSheet.issues.translation_review, settings.general.errors.invalid | files: apps/web/app/(admin)/layout.tsx, apps/web/app/(admin)/settings/general/page.tsx, apps/web/app/(admin)/settings/integrations/page.tsx, apps/web/app/(admin)/settings/layout.tsx
Bill | ticket | en:0 | code:170 in 82 files | files: apps/web/src/guest/turnstile.ts, apps/web/src/server/guard/bad-codes.ts, apps/web/src/server/guest-api.ts, apps/web/src/server/reveal.ts
Bill | account | en:13 | code:1480 in 114 files | en keys: tonight.errors.permission_denied, tonight.pb_lost, tonight.pb_restricted, ownerSettings.err.account_unknown | files: apps/web/scripts/seed-design-e2e.ts, apps/web/scripts/seed-dev.ts, apps/web/scripts/seed-integration-e2e.ts, apps/web/scripts/seed-lifecycle-e2e.ts
Bill | visit | en:0 | code:24 in 10 files | files: apps/web/src/composer/composer.tsx, apps/web/src/composer/reducer.ts, apps/web/src/guest/services-client.ts, apps/web/src/server/composer/structure.ts
POS bill | account | en:13 | code:1480 in 114 files | en keys: tonight.errors.permission_denied, tonight.pb_lost, tonight.pb_restricted, ownerSettings.err.account_unknown | files: apps/web/scripts/seed-design-e2e.ts, apps/web/scripts/seed-dev.ts, apps/web/scripts/seed-integration-e2e.ts, apps/web/scripts/seed-lifecycle-e2e.ts
POS bill | сметка | en:0 | code:0 in 0 files
POS bill | check | en:61 | code:1890 in 344 files | en keys: itemSheet.issueCount, itemSheet.issues.title, itemSheet.issues.translation_review, settings.general.errors.invalid | files: apps/web/app/(admin)/layout.tsx, apps/web/app/(admin)/settings/general/page.tsx, apps/web/app/(admin)/settings/integrations/page.tsx, apps/web/app/(admin)/settings/layout.tsx
Payment mode | payment type | en:2 | code:44 in 14 files | en keys: tonight.mf_storno, ownerSettings.pa_m_till | files: apps/web/scripts/seed-paying-e2e.ts, apps/worker/src/jobs/payments.ts, packages/barsy/src/service/capabilities.ts, packages/connectors/sim-pos/src/connector.ts
Payment mode | prepaid flag | en:0 | code:0 in 0 files
Split | divide | en:0 | code:26 in 15 files | files: apps/web/src/components/admin/menus-card.tsx, apps/web/src/fields/field-row.tsx, apps/web/src/fields/samples.ts, apps/web/src/integration/run-history.tsx
Split | separate | en:0 | code:6 in 6 files | files: apps/web/src/faces/chosen-face.tsx, apps/web/src/server/assets/upload.ts, packages/core/src/apply/index.ts, packages/core/src/seal/index.ts
Part payment | partial | en:0 | code:175 in 82 files | files: apps/web/src/components/admin/workspace-tabs.tsx, apps/web/src/composer/actions.ts, apps/web/src/composer/composer-context.tsx, apps/web/src/composer/item-row.tsx
Part payment | instalment | en:0 | code:0 in 0 files
Group payment | split payment | en:0 | code:0 in 0 files
Group payment | split tender | en:0 | code:0 in 0 files
Location check | geofence | en:0 | code:0 in 0 files
Location check | geolocation | en:0 | code:4 in 2 files | files: apps/web/src/guest/use-table-services.ts, apps/web/src/settings/ordering-panel.tsx
Location check | GPS check | en:0 | code:0 in 0 files
Location pass | location token | en:0 | code:0 in 0 files
Location pass | geo session | en:0 | code:0 in 0 files
Location pass | verified device | en:0 | code:0 in 0 files
Song request | bid | en:0 | code:387 in 47 files | files: apps/web/scripts/lib/demo-bar.ts, apps/web/scripts/lib/seed-demo-bar.ts, apps/web/scripts/seed-integration-e2e.ts, apps/web/scripts/seed-lifecycle-e2e.ts
Song request | track | en:0 | code:2 in 2 files | files: apps/web/src/components/ui/switch.tsx, packages/shell/testing/html.ts
Song request | song | en:0 | code:0 in 0 files
Boost | bid up | en:0 | code:0 in 0 files
Boost | top up | en:0 | code:0 in 0 files
Backer | contributor | en:0 | code:0 in 0 files
Backer | bidder | en:0 | code:0 in 0 files
Request queue | playlist | en:0 | code:0 in 0 files
Request queue | bids | en:0 | code:387 in 47 files | files: apps/web/scripts/lib/demo-bar.ts, apps/web/scripts/lib/seed-demo-bar.ts, apps/web/scripts/seed-integration-e2e.ts, apps/web/scripts/seed-lifecycle-e2e.ts
Request queue | list | en:19 | code:951 in 281 files | en keys: fields.types.enum, fields.types.enum_set, itemSheet.linkState.missing, itemSheet.issues.link_missing | files: apps/web/app/(admin)/layout.tsx, apps/web/app/(admin)/settings/deleted-venues/page.tsx, apps/web/app/(admin)/venues/page.tsx, apps/web/app/api/venues/[venueId]/export/route.ts
Lock window | freeze | en:0 | code:42 in 18 files | files: apps/web/src/composer/composer.tsx, packages/connectors/sim-pos/src/connector.ts, packages/connectors/sim-pos/src/switches.ts, packages/connectors/sim-pos/src/waiter-actions.ts
Lock window | buffer | en:0 | code:79 in 25 files | files: apps/web/app/api/payments/notices/[kind]/handle.ts, apps/web/scripts/seed-guest-e2e.ts, apps/web/scripts/seed-visual-e2e.ts, apps/web/src/connectors/signed-notices.ts
Hold | authorisation | en:0 | code:37 in 11 files | files: apps/worker/src/jobs/payments.ts, packages/barsy/src/errors.ts, packages/barsy/src/read-methods.ts, packages/barsy/src/record/run.ts
Hold | pre-auth | en:0 | code:0 in 0 files
Hold | freeze | en:0 | code:42 in 18 files | files: apps/web/src/composer/composer.tsx, packages/connectors/sim-pos/src/connector.ts, packages/connectors/sim-pos/src/switches.ts, packages/connectors/sim-pos/src/waiter-actions.ts
Release | cancel | en:22 | code:211 in 55 files | en keys: fields.editor.cancel, fields.editor.shortcutHint, fields.tags.cancel, settings.deletedVenues.purgeDialog.cancel | files: apps/web/app/api/payments/notices/[kind]/handle.ts, apps/web/src/components/admin/delete-venue-dialog.tsx, apps/web/src/components/admin/menus-card.tsx, apps/web/src/components/admin/new-venue-dialog.tsx
Release | void | en:0 | code:751 in 259 files | files: apps/web/scripts/lib/guard.ts, apps/web/scripts/publish-e2e.ts, apps/web/scripts/seed-design-e2e.ts, apps/web/scripts/seed-dev.ts
Payment provider | PSP | en:0 | code:0 in 0 files
Payment provider | gateway | en:0 | code:0 in 0 files
Payment provider | acquirer | en:0 | code:0 in 0 files
Payment account | merchant account | en:0 | code:0 in 0 files
Payment account | wallet | en:0 | code:66 in 16 files | files: apps/web/src/tonight/money-rows.tsx, apps/worker/src/jobs/index.ts, apps/worker/src/jobs/wallet-domain.ts, apps/worker/src/payments/connection-api.ts
Guest session | user | en:4 | code:938 in 148 files | en keys: integration.connect.description, integration.connect.user, integration.connect.changeHelp, integration.statusDetail.wrong_credentials | files: apps/web/app/(admin)/layout.tsx, apps/web/app/(admin)/venues/[venueId]/page.tsx, apps/web/app/(admin)/venues/page.tsx, apps/web/app/(print)/venues/[venueId]/tables/print/page.tsx
Guest session | account | en:13 | code:1480 in 114 files | en keys: tonight.errors.permission_denied, tonight.pb_lost, tonight.pb_restricted, ownerSettings.err.account_unknown | files: apps/web/scripts/seed-design-e2e.ts, apps/web/scripts/seed-dev.ts, apps/web/scripts/seed-integration-e2e.ts, apps/web/scripts/seed-lifecycle-e2e.ts
Guest session | login | en:0 | code:363 in 43 files | files: apps/web/app/(print)/venues/[venueId]/tables/print/page.tsx, apps/web/app/login/page.tsx, apps/web/app/page.tsx, apps/web/proxy.ts
```

---

## Appendix A: decision citation pairs (651 rows: decision, file, citations)
Command: `git grep -n -o -E 'D1[0-2][0-9]( §[0-9]+)?' -- packages apps ':!*.md'`, then `sort | uniq -c` per (decision, file).
```
D105	apps/worker/src/receipts/email-sender.ts	1
D105	packages/faces/qr-phone/src/pay-panel.tsx	1
D107	apps/web/src/settings/paying-panel.tsx	1
D109	apps/web/e2e/faces-visual.spec.ts	3
D109	packages/shell/testing/contract.test.ts	2
D109	packages/shell/testing/fixtures.ts	2
D109	apps/web/e2e/visual-fixtures.ts	1
D109	apps/web/scripts/seed-visual-e2e.ts	1
D110	packages/core/src/connectors/service/testing/guard.ts	4
D110	packages/core/src/connectors/service/waiter-actions.ts	4
D110	packages/connectors/sim-pos/src/write/index.ts	2
D110	packages/core/src/connectors/service/connector.ts	2
D110	packages/barsy/src/service/reader.ts	1
D110	packages/barsy/src/service/waiter-actions.ts	1
D110	packages/connectors/sim-pos/src/connector.ts	1
D110	packages/connectors/sim-pos/src/switches.test.ts	1
D110	packages/connectors/sim-pos/src/waiter-actions.ts	1
D110	packages/core/src/connectors/service/schemas.test.ts	1
D110	packages/core/src/connectors/service/testing/checks-write.ts	1
D110	packages/core/src/connectors/service/testing/kit.test.ts	1
D110	packages/core/src/connectors/service/testing/suite.ts	1
D111	apps/worker/src/jobs/purge.ts	3
D111	apps/worker/src/jobs/readings.ts	3
D111	packages/core/src/service/service-day-close.ts	3
D111	packages/core/src/service/bill.ts	2
D111	packages/core/src/service/pay.ts	2
D111	packages/db/src/schema.ts	2
D111	apps/worker/src/jobs/service-day.ts	1
D111	apps/worker/tests/purge-service.test.ts	1
D111	packages/core/src/jobs.ts	1
D111	packages/core/src/service/bill.test.ts	1
D111	packages/core/src/service/context.ts	1
D111	packages/core/src/service/dispute-evidence.ts	1
D111	packages/core/src/service/read.ts	1
D111	packages/core/src/service/readings.ts	1
D111	packages/core/src/service/service-day-close.test.ts	1
D111	packages/db/src/table-access.ts	1
D111	packages/shell/src/guest-api.ts	1
D111	packages/shell/src/services.ts	1
D112	packages/db/migrations/0032_payment_commands.sql	1
D112	packages/db/tests/payment-tables.test.ts	1
D113	packages/core/src/templates/venue-menu.ts	2
D113	apps/web/src/composer/composer-context.tsx	1
D113	apps/web/src/composer/item-sheet-payment-mode.tsx	1
D113	apps/web/src/composer/payment-mode-actions.ts	1
D113	apps/web/src/server/composer/pay-first.ts	1
D113	apps/web/src/settings/paying-pay-first.tsx	1
D113	apps/web/src/tables/pay-first-picker.tsx	1
D113	packages/core/src/apply/pay-first-settings.ts	1
D113	packages/core/src/apply/payment-mode.test.ts	1
D113	packages/core/src/apply/payment-mode.ts	1
D113	packages/core/src/pay-first-settings.ts	1
D113	packages/core/src/service/pay-first-settings.test.ts	1
D113	packages/core/src/service/pay-first-settings.ts	1
D113	packages/core/src/service/pay-first.ts	1
D113	packages/core/src/service/send-menu.ts	1
D113	packages/core/src/snapshot/build.ts	1
D113	packages/core/src/snapshot/schema.ts	1
D113	packages/core/src/template.test.ts	1
D113	packages/shell/src/services.ts	1
D115	packages/core/src/connectors/service/schemas.ts	5
D115	apps/worker/src/jobs/payments.ts	4
D115	packages/core/src/connectors/service/testing/checks-write.ts	4
D115	apps/worker/src/jobs/order-send.ts	3
D115	packages/connectors/sim-pos/src/connector.ts	3
D115	packages/core/src/timings.ts	3
D115	apps/worker/tests/payment-route.test.ts	2
D115	packages/core/src/connectors/service/timings.ts	2
D115	packages/core/src/service/sent-order.ts	2
D115	apps/web/e2e/guest-send.spec.ts	1
D115	apps/worker/tests/late-landing.test.ts	1
D115	apps/worker/tests/order-send.test.ts	1
D115	packages/connectors/sim-pos/src/engine/faults.ts	1
D115	packages/connectors/sim-pos/src/switches.ts	1
D115	packages/connectors/sim-pos/src/tip.test.ts	1
D115	packages/core/src/connectors/service/capabilities.ts	1
D115	packages/core/src/connectors/service/connector.ts	1
D115	packages/core/src/connectors/service/landed.test.ts	1
D115	packages/core/src/connectors/service/landed.ts	1
D115	packages/core/src/connectors/service/target-bill.test.ts	1
D115	packages/core/src/connectors/service/target-bill.ts	1
D115	packages/core/src/connectors/service/testing/checks-read.ts	1
D115	packages/core/src/connectors/service/testing/harness.ts	1
D115	packages/core/src/jobs.ts	1
D115	packages/core/src/landing-match.ts	1
D115	packages/core/src/service/bill.ts	1
D115	packages/core/src/service/late-landing.ts	1
D115	packages/core/src/service/leases.ts	1
D115	packages/core/src/service/pay-route.ts	1
D115	packages/core/src/service/send.test.ts	1
D115	packages/core/src/service/send.ts	1
D115	packages/db/src/schema.ts	1
D115	packages/shell/src/strings.ts	1
D116	packages/core/src/service/read.ts	2
D116	packages/core/src/service/sent-order.ts	2
D116	packages/faces/qr-phone/src/table-order.tsx	2
D116	apps/web/e2e/guest-send.spec.ts	1
D116	apps/web/src/server/tonight/view.ts	1
D116	apps/web/src/tonight/action-rows.tsx	1
D116	apps/worker/src/jobs/order-send.ts	1
D116	apps/worker/tests/late-landing.test.ts	1
D116	apps/worker/tests/order-send.test.ts	1
D116	packages/core/src/connectors/service/capabilities.ts	1
D116	packages/core/src/connectors/service/landed.ts	1
D116	packages/core/src/connectors/service/timings.ts	1
D116	packages/core/src/landing-match.ts	1
D116	packages/core/src/service/late-landing.ts	1
D116	packages/core/src/service/send-menu.ts	1
D116	packages/core/src/service/sent-order-answer.test.ts	1
D116	packages/core/src/service/sent-order-answer.ts	1
D116	packages/core/src/table-order.ts	1
D116	packages/core/src/timings.ts	1
D116	packages/db/src/schema.ts	1
D116	packages/shell/src/services.ts	1
D116	packages/shell/src/strings.ts	1
D117	packages/core/src/table-order.ts	4
D117	packages/faces/qr-phone/src/table-order.tsx	3
D117	packages/core/src/service/leases.ts	2
D117	packages/core/src/service/send-guards.ts	2
D117	packages/db/src/schema.ts	2
D117	packages/core/src/connectors/service/timings.ts	1
D117	packages/core/src/ids.ts	1
D117	packages/core/src/service/engine.ts	1
D117	packages/core/src/service/leases.test.ts	1
D117	packages/core/src/service/lock-order.ts	1
D117	packages/core/src/service/no-outbound.test.ts	1
D117	packages/core/src/service/order.ts	1
D117	packages/core/src/service/pay-first.ts	1
D117	packages/core/src/service/rows.ts	1
D117	packages/core/src/service/send-guards.test.ts	1
D117	packages/core/src/service/send.test.ts	1
D117	packages/core/src/service/send.ts	1
D117	packages/core/src/service/sent-order.ts	1
D117	packages/core/src/timings.ts	1
D117	packages/shell/src/services.ts	1
D117	packages/shell/src/strings.test.ts	1
D117	packages/shell/src/strings.ts	1
D118	packages/core/src/ordering-settings.ts	8
D118	packages/core/src/service/send-guards.ts	4
D118	packages/core/src/location-check.ts	3
D118	apps/web/src/settings/ordering-panel.tsx	2
D118	apps/web/src/settings/ordering-panels.test.tsx	1
D118	packages/core/src/ordering-settings.test.ts	1
D118	packages/core/src/service/alert-rules.ts	1
D118	packages/core/src/service/guest-limits.ts	1
D118	packages/core/src/service/guest.ts	1
D118	packages/core/src/service/owner-settings.ts	1
D118	packages/core/src/service/send-guards.test.ts	1
D118	packages/core/src/service/waiter-call.ts	1
D118	packages/shell/src/services.ts	1
D119	packages/core/src/location-check.ts	2
D119	packages/core/src/service/guest.ts	2
D119	apps/web/src/guest/turnstile.ts	1
D119	apps/web/src/server/env.ts	1
D119	apps/web/src/server/turnstile.ts	1
D119	packages/core/src/service/context.ts	1
D119	packages/core/src/service/definition.ts	1
D119	packages/db/src/schema.ts	1
D119	packages/shell/src/strings.ts	1
D120	packages/core/src/service/alert-rules.ts	8
D120	packages/core/src/connectors/service/schemas.ts	5
D120	packages/db/src/schema.ts	5
D120	apps/worker/tests/payments.test.ts	4
D120	packages/core/src/jobs.ts	4
D120	packages/core/src/ordering-settings.ts	4
D120	packages/core/src/service/alerts.ts	4
D120	packages/core/src/service/pauses.ts	4
D120	packages/core/src/service/paying-pause.ts	4
D120	apps/worker/src/jobs/payment-breaker.ts	3
D120	apps/worker/src/jobs/service-hours.ts	3
D120	packages/core/src/service/breaker.ts	3
D120	packages/core/src/service/sent-order.ts	3
D120	packages/core/src/ids.ts	2
D120	packages/core/src/service/alert-delivery.ts	2
D120	apps/web/src/server/tonight/log-kinds.test.ts	1
D120	apps/web/src/server/tonight/view.ts	1
D120	apps/web/src/tonight/log-sentence.ts	1
D120	apps/worker/src/alerts/deliver.ts	1
D120	apps/worker/src/alerts/push-targets.ts	1
D120	apps/worker/src/alerts/push.ts	1
D120	apps/worker/src/config.ts	1
D120	apps/worker/src/jobs/alerts.ts	1
D120	apps/worker/src/jobs/breaker.ts	1
D120	apps/worker/src/jobs/connection.ts	1
D120	apps/worker/src/jobs/floor.ts	1
D120	apps/worker/src/jobs/order-send.ts	1
D120	apps/worker/src/jobs/readings.ts	1
D120	apps/worker/tests/alerts.test.ts	1
D120	apps/worker/tests/connection-breaker.test.ts	1
D120	apps/worker/tests/order-send.test.ts	1
D120	apps/worker/tests/service-hours.test.ts	1
D120	packages/barsy/src/service/capabilities.ts	1
D120	packages/barsy/src/service/reader.ts	1
D120	packages/core/src/connectors/service/connector.ts	1
D120	packages/core/src/connectors/service/testing/checks-read.ts	1
D120	packages/core/src/service/alert-delivery.test.ts	1
D120	packages/core/src/service/alert-rules.test.ts	1
D120	packages/core/src/service/alert-text.ts	1
D120	packages/core/src/service/alerts.test.ts	1
D120	packages/core/src/service/floor-pause.ts	1
D120	packages/core/src/service/log-view.ts	1
D120	packages/core/src/service/log.ts	1
D120	packages/core/src/service/pause-scope.ts	1
D120	packages/core/src/service/pauses.test.ts	1
D120	packages/core/src/service/pre-opening.test.ts	1
D120	packages/core/src/service/pre-opening.ts	1
D120	packages/core/src/service/readings.ts	1
D120	packages/core/src/service/retention.test.ts	1
D120	packages/core/src/service/send.test.ts	1
D120	packages/core/src/service/send.ts	1
D120	packages/core/src/timings.ts	1
D120	packages/faces/qr-phone/src/css.ts	1
D120	packages/faces/qr-phone/src/table-order.tsx	1
D121	packages/core/src/service/guest.ts	5
D121	packages/core/src/service/commands.ts	3
D121	packages/core/src/service/results.ts	3
D121	packages/core/src/table-order.ts	3
D121	packages/core/src/location-check.ts	2
D121	packages/db/migrations/0029_table_code_hash.sql	2
D121	packages/db/src/index.ts	2
D121	packages/db/tests/rls-guard.test.ts	2
D121	packages/shell/src/services.ts	2
D121	apps/web/app/api/guest/actions/route.ts	1
D121	apps/web/app/api/guest/state/route.ts	1
D121	apps/web/src/guest/services-client.ts	1
D121	apps/web/src/guest/turnstile.ts	1
D121	apps/web/src/server/env.ts	1
D121	apps/web/src/server/guest-api.ts	1
D121	apps/web/src/server/turnstile.ts	1
D121	apps/worker/src/jobs/order-tidy.ts	1
D121	packages/core/src/jobs.ts	1
D121	packages/core/src/qr.ts	1
D121	packages/core/src/service/action-ring.ts	1
D121	packages/core/src/service/context.ts	1
D121	packages/core/src/service/definition.ts	1
D121	packages/core/src/service/location-pass.ts	1
D121	packages/core/src/service/order-rate.ts	1
D121	packages/core/src/service/order.ts	1
D121	packages/core/src/service/read.ts	1
D121	packages/core/src/service/sittings.ts	1
D121	packages/db/src/schema.ts	1
D121	packages/db/src/table-access.ts	1
D121	packages/db/tests/guest-table-lookup.test.ts	1
D121	packages/faces/qr-phone/src/table-order.tsx	1
D121	packages/shell/src/guest-api.ts	1
D122	packages/db/src/schema.ts	22
D122	packages/core/src/connectors/service/schemas.ts	11
D122	packages/core/src/service/guest.ts	10
D122	packages/core/src/apply/tables.ts	7
D122	packages/core/src/connectors/service/capabilities.ts	6
D122	packages/core/src/service/permissions.ts	6
D122	packages/core/src/service/staff.ts	6
D122	packages/core/src/ordering-settings.ts	5
D122	packages/core/src/service/commands.ts	5
D122	packages/core/src/service/context.ts	5
D122	packages/core/src/service/results.ts	5
D122	apps/web/src/server/tables/view.ts	4
D122	packages/core/src/apply/floor.ts	4
D122	packages/core/src/ids.ts	4
D122	packages/core/src/seal/envelope.ts	4
D122	packages/shell/src/strings.ts	4
D122	apps/web/src/guest/services-client.ts	3
D122	apps/web/src/server/guard/bad-codes.ts	3
D122	apps/web/src/server/publish/table-token.ts	3
D122	apps/worker/src/jobs/purge.ts	3
D122	packages/connectors/sim-pos/src/switches.ts	3
D122	packages/core/src/connectors/service/connector.ts	3
D122	packages/core/src/jobs.ts	3
D122	packages/core/src/pay-first-settings.ts	3
D122	packages/core/src/service-capabilities-config.ts	3
D122	packages/core/src/service-hours.ts	3
D122	packages/core/src/service/guest-limits.ts	3
D122	packages/core/src/service/pay.test.ts	3
D122	packages/core/src/service/send-guards.ts	3
D122	packages/core/src/service/sittings.ts	3
D122	packages/faces/qr-phone/src/table-order.tsx	3
D122	packages/shell/src/services.ts	3
D122	apps/web/src/server/item-sheet/service.ts	2
D122	apps/web/src/server/settings/paying-offer.ts	2
D122	apps/web/src/server/tonight/actions.ts	2
D122	apps/worker/src/alerts/push.ts	2
D122	apps/worker/src/jobs/connection.ts	2
D122	apps/worker/src/reveal.ts	2
D122	packages/barsy/src/service/capabilities.ts	2
D122	packages/connectors/sim-pos/src/engine/engine.ts	2
D122	packages/core/src/location-check.ts	2
D122	packages/core/src/seal/index.ts	2
D122	packages/core/src/seal/open/open.ts	2
D122	packages/core/src/seal/staff-pin.ts	2
D122	packages/core/src/service/alert-rules.ts	2
D122	packages/core/src/service/alerts.ts	2
D122	packages/core/src/service/breaker.ts	2
D122	packages/core/src/service/closing-hour.test.ts	2
D122	packages/core/src/service/closing-hour.ts	2
D122	packages/core/src/service/definition.ts	2
D122	packages/core/src/service/dispute-evidence.ts	2
D122	packages/core/src/service/leases.ts	2
D122	packages/core/src/service/log.ts	2
D122	packages/core/src/service/night-read.ts	2
D122	packages/core/src/service/pay-first.ts	2
D122	packages/core/src/service/pay-route.ts	2
D122	packages/core/src/service/sittings.test.ts	2
D122	packages/core/src/service/staff-read.ts	2
D122	packages/core/src/service/waiter-call.ts	2
D122	packages/db/src/table-access.ts	2
D122	packages/shell/src/guest-api.ts	2
D122	apps/web/app/(admin)/venues/[venueId]/page.tsx	1
D122	apps/web/e2e/guest.spec.ts	1
D122	apps/web/e2e/payment-tables-state.ts	1
D122	apps/web/e2e/tonight-refunds.spec.ts	1
D122	apps/web/scripts/lib/seed-demo-bar.ts	1
D122	apps/web/src/components/admin/workspace-tab-defs.ts	1
D122	apps/web/src/composer/composer-context.tsx	1
D122	apps/web/src/composer/composer-tab.tsx	1
D122	apps/web/src/composer/composer.tsx	1
D122	apps/web/src/composer/item-sheet-payment-mode.tsx	1
D122	apps/web/src/composer/payment-mode-actions.ts	1
D122	apps/web/src/guest/context.ts	1
D122	apps/web/src/guest/headers.ts	1
D122	apps/web/src/guest/load.test.ts	1
D122	apps/web/src/guest/use-table-services.ts	1
D122	apps/web/src/server/auth.test.ts	1
D122	apps/web/src/server/auth.ts	1
D122	apps/web/src/server/composer/pay-first.ts	1
D122	apps/web/src/server/env.ts	1
D122	apps/web/src/server/guard/bad-codes.test.ts	1
D122	apps/web/src/server/guest-api.ts	1
D122	apps/web/src/server/item-sheet/service.test.ts	1
D122	apps/web/src/server/item-sheet/types.ts	1
D122	apps/web/src/server/reveal.ts	1
D122	apps/web/src/server/session.ts	1
D122	apps/web/src/server/settings/access.ts	1
D122	apps/web/src/server/staff/service.ts	1
D122	apps/web/src/server/tables/service.ts	1
D122	apps/web/src/server/tonight/tables.ts	1
D122	apps/web/src/settings/paying-pay-first.tsx	1
D122	apps/web/src/settings/section-notices.tsx	1
D122	apps/web/src/settings/staff-roles.tsx	1
D122	apps/web/src/settings/use-settings-run.tsx	1
D122	apps/web/src/tables/pay-first-picker.tsx	1
D122	apps/web/src/tonight/action-rows.tsx	1
D122	apps/web/src/tonight/dispute-evidence.tsx	1
D122	apps/web/src/tonight/night-page.tsx	1
D122	apps/web/src/tonight/pause-banners.tsx	1
D122	apps/worker/src/alerts/deliver.ts	1
D122	apps/worker/src/alerts/night-report.ts	1
D122	apps/worker/src/alerts/push-targets.ts	1
D122	apps/worker/src/alerts/telegram-poller.ts	1
D122	apps/worker/src/alerts/telegram.ts	1
D122	apps/worker/src/config.ts	1
D122	apps/worker/src/jobs/alerts.ts	1
D122	apps/worker/src/jobs/breaker.ts	1
D122	apps/worker/src/jobs/order-send.ts	1
D122	apps/worker/src/jobs/readings.ts	1
D122	apps/worker/src/jobs/seal-table-codes.ts	1
D122	apps/worker/src/jobs/service-hours.ts	1
D122	apps/worker/src/jobs/stock.ts	1
D122	apps/worker/src/jobs/waiter-call-lapse.ts	1
D122	apps/worker/src/logger.ts	1
D122	apps/worker/src/publish/table-tokens.ts	1
D122	apps/worker/tests/alerts.test.ts	1
D122	apps/worker/tests/connection-breaker.test.ts	1
D122	apps/worker/tests/late-landing.test.ts	1
D122	apps/worker/tests/purge-service.test.ts	1
D122	apps/worker/tests/seal-table-codes.test.ts	1
D122	apps/worker/tests/service-hours.test.ts	1
D122	packages/assets/src/publish-paths.ts	1
D122	packages/connectors/sim-pos/src/engine/errors.ts	1
D122	packages/connectors/sim-pos/src/engine/state.ts	1
D122	packages/connectors/sim-pos/src/testing/test-harness.ts	1
D122	packages/core/src/apply/ordering-settings.ts	1
D122	packages/core/src/apply/pay-first-settings.ts	1
D122	packages/core/src/apply/payment-mode.test.ts	1
D122	packages/core/src/apply/payment-mode.ts	1
D122	packages/core/src/apply/stock.test.ts	1
D122	packages/core/src/apply/stock.ts	1
D122	packages/core/src/apply/tables.test.ts	1
D122	packages/core/src/connectors/payment/capabilities.ts	1
D122	packages/core/src/connectors/service/testing/checks-read.ts	1
D122	packages/core/src/connectors/service/testing/checks-write.ts	1
D122	packages/core/src/floor-source.ts	1
D122	packages/core/src/guest-files.ts	1
D122	packages/core/src/pin-guard.test.ts	1
D122	packages/core/src/pin-guard.ts	1
D122	packages/core/src/qr.ts	1
D122	packages/core/src/seal/table-code.ts	1
D122	packages/core/src/service/alerts.test.ts	1
D122	packages/core/src/service/bill.ts	1
D122	packages/core/src/service/commands.test.ts	1
D122	packages/core/src/service/dispute-evidence.test.ts	1
D122	packages/core/src/service/engine.ts	1
D122	packages/core/src/service/floor-pause.ts	1
D122	packages/core/src/service/grants.ts	1
D122	packages/core/src/service/guest-limits.test.ts	1
D122	packages/core/src/service/guest.test.ts	1
D122	packages/core/src/service/identify.ts	1
D122	packages/core/src/service/index.ts	1
D122	packages/core/src/service/late-landing.ts	1
D122	packages/core/src/service/location-pass.ts	1
D122	packages/core/src/service/owner-settings.ts	1
D122	packages/core/src/service/pauses.test.ts	1
D122	packages/core/src/service/pauses.ts	1
D122	packages/core/src/service/pay-first-settings.test.ts	1
D122	packages/core/src/service/pay-first-settings.ts	1
D122	packages/core/src/service/pay.ts	1
D122	packages/core/src/service/payment-connection.ts	1
D122	packages/core/src/service/payment-observe.ts	1
D122	packages/core/src/service/payment-refunds.test.ts	1
D122	packages/core/src/service/payment-refunds.ts	1
D122	packages/core/src/service/pins.test.ts	1
D122	packages/core/src/service/pins.ts	1
D122	packages/core/src/service/pre-opening.ts	1
D122	packages/core/src/service/read.ts	1
D122	packages/core/src/service/readings.ts	1
D122	packages/core/src/service/receipt-brought.ts	1
D122	packages/core/src/service/retention.test.ts	1
D122	packages/core/src/service/send-guards.test.ts	1
D122	packages/core/src/service/service-day-close.ts	1
D122	packages/core/src/service/staff.test.ts	1
D122	packages/core/src/service/stock.ts	1
D122	packages/core/src/service/table-capabilities.ts	1
D122	packages/core/src/service/table-codes.test.ts	1
D122	packages/core/src/service/table-codes.ts	1
D122	packages/core/src/service/waiter-call.test.ts	1
D122	packages/core/src/stock.test.ts	1
D122	packages/core/src/stock.ts	1
D122	packages/core/src/table-order.ts	1
D122	packages/core/src/templates/venue-menu.ts	1
D122	packages/core/src/testing/service-world.ts	1
D122	packages/core/src/timings.ts	1
D122	packages/core/src/write-targets.test.ts	1
D122	packages/db/migrations/0028_service_tables.sql	1
D122	packages/db/migrations/0029_table_code_hash.sql	1
D122	packages/db/migrations/0042_pay_refunds_disputes.sql	1
D122	packages/db/tests/guest-table-lookup.test.ts	1
D122	packages/db/tests/service-tables.test.ts	1
D122	packages/faces/editorial-market/src/services/pay-sheet.tsx	1
D122	packages/faces/qr-phone/src/face.test.tsx	1
D122	packages/faces/qr-phone/src/pay-panel.tsx	1
D122	packages/payments/stripe/src/testing/sandbox-checks.test.ts	1
D122	packages/shell/src/stock.ts	1
D123	apps/web/app/globals.css	1
D123	apps/web/e2e/touch-targets.spec.ts	1
D123	apps/web/src/components/ui/switch.tsx	1
D123	apps/web/src/composer/badges.tsx	1
D123	apps/web/src/composer/item-row.tsx	1
D123	apps/web/src/composer/item-toolbar.tsx	1
D123	apps/web/src/settings/paying-panel.tsx	1
D124	packages/core/src/connectors/service/schemas.ts	9
D124	packages/core/src/connectors/service/capabilities.ts	5
D124	packages/db/src/schema.ts	4
D124	packages/connectors/sim-pos/src/switches.ts	3
D124	packages/core/src/connectors/service/target-bill.ts	3
D124	packages/core/src/connectors/service/testing/checks-write.ts	3
D124	packages/connectors/sim-pos/src/connector.ts	2
D124	packages/core/src/apply/floor.ts	2
D124	packages/core/src/apply/sold-out.ts	2
D124	packages/core/src/connectors/service/testing/suite.ts	2
D124	packages/core/src/ids.ts	2
D124	packages/core/src/service/pay-route.ts	2
D124	apps/web/src/composer/composer-tab.tsx	1
D124	apps/web/src/server/item-sheet/actions.ts	1
D124	apps/web/src/server/sold-out/service.ts	1
D124	apps/web/src/server/tables/view.ts	1
D124	apps/worker/src/jobs/stock.ts	1
D124	apps/worker/tests/publish.test.ts	1
D124	packages/barsy/src/service/capabilities.ts	1
D124	packages/barsy/src/service/reader.ts	1
D124	packages/connectors/sim-pos/src/connector.test.ts	1
D124	packages/connectors/sim-pos/src/engine/engine.ts	1
D124	packages/connectors/sim-pos/src/switches.test.ts	1
D124	packages/core/src/apply/floor.test.ts	1
D124	packages/core/src/apply/sold-out.test.ts	1
D124	packages/core/src/apply/stock.ts	1
D124	packages/core/src/connectors/index.ts	1
D124	packages/core/src/connectors/service/schemas.test.ts	1
D124	packages/core/src/connectors/service/target-bill.test.ts	1
D124	packages/core/src/connectors/service/testing/checks-read.ts	1
D124	packages/core/src/connectors/service/testing/kit.test.ts	1
D124	packages/core/src/service/bill.ts	1
D124	packages/core/src/stock.ts	1
D124	packages/db/migrations/0028_service_tables.sql	1
D124	packages/db/src/table-access.ts	1
D125	packages/core/src/service/payment-connection.ts	17
D125	packages/core/src/connectors/payment/schemas.ts	9
D125	packages/core/src/payment-connection.ts	9
D125	packages/core/src/service/payment-connection.test.ts	7
D125	apps/worker/src/payments/connection.ts	6
D125	packages/core/src/connectors/payment/provider.ts	5
D125	apps/web/src/settings/paying-panel.tsx	3
D125	packages/db/src/schema.ts	3
D125	apps/web/src/server/settings/paying-actions.ts	2
D125	apps/web/src/server/settings/paying-view.ts	2
D125	apps/worker/tests/payment-connection.test.ts	2
D125	packages/core/src/payment-connection.test.ts	2
D125	packages/core/src/service/alert-rules.ts	2
D125	packages/core/src/service/pay.test.ts	2
D125	packages/core/src/service/pay.ts	2
D125	packages/core/src/service/permissions.ts	2
D125	packages/payments/stripe/src/provider.ts	2
D125	apps/web/app/api/payments/notices/[kind]/handle.ts	1
D125	apps/web/e2e/guest-pay-card.spec.ts	1
D125	apps/web/src/connectors/stripe/notices.ts	1
D125	apps/worker/src/e2e/pay-harness.ts	1
D125	apps/worker/src/jobs/provider-notices.ts	1
D125	apps/worker/src/jobs/wallet-domain.ts	1
D125	apps/worker/src/payments/connection-api.ts	1
D125	apps/worker/tests/pay-first.test.ts	1
D125	apps/worker/tests/payment-route.test.ts	1
D125	apps/worker/tests/payments.test.ts	1
D125	packages/core/src/connectors/payment/capabilities.ts	1
D125	packages/core/src/connectors/payment/testing/guard.ts	1
D125	packages/core/src/connectors/payment/testing/harness.ts	1
D125	packages/core/src/paying-settings.ts	1
D125	packages/core/src/service-capabilities-config.ts	1
D125	packages/core/src/service/commands.ts	1
D125	packages/core/src/service/notices.ts	1
D125	packages/core/src/service/paying-settings.ts	1
D125	packages/core/src/service/payment-observe.ts	1
D125	packages/core/src/service/payment-refunds.ts	1
D125	packages/db/migrations/0031_payment_observed.sql	1
D125	packages/db/migrations/0035_pay_connection.sql	1
D125	packages/payments/sim-pay/src/engine.ts	1
D125	packages/payments/stripe/src/conformance.test.ts	1
D125	packages/payments/stripe/src/errors.ts	1
D125	packages/payments/stripe/src/testing/test-harness.ts	1
D126	packages/payments/stripe/src/provider.ts	3
D126	apps/web/src/connectors/stripe/notices.ts	1
D126	packages/payments/stripe/src/index.ts	1
D127	packages/core/src/service/guest.ts	13
D127	packages/db/src/schema.ts	13
D127	packages/shell/src/guest-api.ts	13
D127	packages/shell/src/services.ts	13
D127	apps/worker/src/jobs/payments.ts	12
D127	packages/core/src/service/pay.ts	9
D127	packages/core/src/connectors/service/schemas.ts	8
D127	packages/shell/src/paying.ts	8
D127	packages/faces/editorial-market/src/services/pay-sheet.tsx	7
D127	packages/core/src/connectors/payment/schemas.ts	6
D127	packages/faces/qr-phone/src/pay-panel.tsx	6
D127	packages/core/src/connectors/payment/provider.ts	5
D127	packages/core/src/service/pay-first.ts	5
D127	packages/faces/editorial-market/src/services/pay.test.tsx	5
D127	packages/faces/qr-phone/src/pay-panel.test.tsx	5
D127	packages/shell/src/paying.test.ts	5
D127	apps/web/src/guest/services-client.ts	4
D127	packages/connectors/sim-pos/src/connector.ts	4
D127	packages/core/src/connectors/service/capabilities.ts	4
D127	packages/core/src/connectors/service/testing/checks-write.ts	4
D127	packages/shell/src/strings.ts	4
D127	apps/web/src/connectors/stripe/card-form.ts	3
D127	packages/core/src/paying-settings.ts	3
D127	packages/core/src/service/pay-route.ts	3
D127	packages/core/src/service/read.ts	3
D127	packages/db/src/table-access.ts	3
D127	packages/shell/src/confirmation.ts	3
D127	packages/shell/testing/paying.ts	3
D127	apps/web/e2e/faces-preview.ts	2
D127	apps/web/src/guest/services-client.test.ts	2
D127	apps/web/src/guest/use-table-services.ts	2
D127	apps/worker/tests/payments.test.ts	2
D127	packages/connectors/sim-pos/src/receipt.test.ts	2
D127	packages/connectors/sim-pos/src/tip.test.ts	2
D127	packages/core/src/connectors/payment/capabilities.ts	2
D127	packages/core/src/connectors/payment/testing/harness.ts	2
D127	packages/core/src/connectors/service/connector.ts	2
D127	packages/core/src/connectors/service/testing/kit.test.ts	2
D127	packages/core/src/ids.ts	2
D127	packages/core/src/payment-connection.ts	2
D127	packages/core/src/service-capabilities-config.ts	2
D127	packages/core/src/service/alert-rules.ts	2
D127	packages/core/src/service/pay-first-route.test.ts	2
D127	packages/core/src/service/pay.test.ts	2
D127	packages/db/migrations/0030_payment_tables.sql	2
D127	packages/db/migrations/0032_payment_commands.sql	2
D127	packages/db/tests/payment-tables.test.ts	2
D127	packages/faces/editorial-market/src/services/services-css.ts	2
D127	packages/faces/qr-phone/src/css.ts	2
D127	packages/payments/stripe/src/errors.ts	2
D127	packages/payments/stripe/src/provider.ts	2
D127	packages/shell/src/service-vocabulary.ts	2
D127	apps/web/app/api/guest/payment/route.ts	1
D127	apps/web/app/api/payments/notices/[kind]/handle.ts	1
D127	apps/web/app/api/payments/notices/[kind]/records-only.test.ts	1
D127	apps/web/e2e/guest-pay-return.spec.ts	1
D127	apps/web/src/connectors/card-form-types.ts	1
D127	apps/web/src/connectors/card-forms.ts	1
D127	apps/web/src/connectors/return-address.test.ts	1
D127	apps/web/src/connectors/return-address.ts	1
D127	apps/web/src/connectors/signed-notices.ts	1
D127	apps/web/src/connectors/stripe/card-form.test.ts	1
D127	apps/web/src/connectors/stripe/notices.ts	1
D127	apps/web/src/connectors/stripe/provider.ts	1
D127	apps/web/src/guest/headers.test.ts	1
D127	apps/web/src/guest/headers.ts	1
D127	apps/web/src/server/guest-api.ts	1
D127	apps/web/src/server/turnstile.ts	1
D127	apps/web/src/settings/paying-panel.tsx	1
D127	apps/worker/src/config.ts	1
D127	apps/worker/src/jobs/payment-breaker.ts	1
D127	apps/worker/src/jobs/payment-recovery.ts	1
D127	apps/worker/src/jobs/provider-notices.ts	1
D127	apps/worker/src/jobs/purge.ts	1
D127	apps/worker/src/jobs/wallet-domain.ts	1
D127	apps/worker/src/payments/connection.ts	1
D127	apps/worker/src/receipts/email-sender.ts	1
D127	apps/worker/tests/receipt-email.test.ts	1
D127	packages/barsy/src/service/capabilities.ts	1
D127	packages/connectors/sim-pos/scenarios/receipt-file.json	1
D127	packages/connectors/sim-pos/scenarios/receipt-sent.json	1
D127	packages/connectors/sim-pos/scenarios/tip-on-close.json	1
D127	packages/connectors/sim-pos/src/conformance.test.ts	1
D127	packages/connectors/sim-pos/src/write/index.ts	1
D127	packages/core/src/apply/paying-settings.ts	1
D127	packages/core/src/connectors/payment/index.ts	1
D127	packages/core/src/connectors/payment/testing/checks.ts	1
D127	packages/core/src/connectors/payment/testing/guard.ts	1
D127	packages/core/src/connectors/payment/testing/suite.ts	1
D127	packages/core/src/connectors/service/schemas.test.ts	1
D127	packages/core/src/connectors/service/testing/harness.ts	1
D127	packages/core/src/connectors/service/testing/toy-pos.ts	1
D127	packages/core/src/legal-details.ts	1
D127	packages/core/src/payment-connection.test.ts	1
D127	packages/core/src/service/bill.test.ts	1
D127	packages/core/src/service/bill.ts	1
D127	packages/core/src/service/guest-limits.test.ts	1
D127	packages/core/src/service/notices.ts	1
D127	packages/core/src/service/pay-amount.test.ts	1
D127	packages/core/src/service/paying-pause.ts	1
D127	packages/core/src/service/paying-settings.ts	1
D127	packages/core/src/service/payment-connection.ts	1
D127	packages/core/src/service/payment-number.ts	1
D127	packages/core/src/service/payment-observe.ts	1
D127	packages/core/src/service/provider-notices.ts	1
D127	packages/core/src/service/receipt-brought.ts	1
D127	packages/core/src/service/sittings.test.ts	1
D127	packages/core/src/service/sittings.ts	1
D127	packages/core/src/write-targets.test.ts	1
D127	packages/db/migrations/0031_payment_observed.sql	1
D127	packages/db/migrations/0036_paying_breaker.sql	1
D127	packages/db/migrations/0040_paid_lines.sql	1
D127	packages/db/migrations/0041_pay_receipt_email.sql	1
D127	packages/faces/editorial-market/src/services/bill-sheet.tsx	1
D127	packages/faces/editorial-market/src/services/sheets.test.tsx	1
D127	packages/payments/sim-pay/src/engine.ts	1
D127	packages/payments/sim-pay/src/index.ts	1
D127	packages/payments/sim-pay/src/provider.ts	1
D127	packages/payments/stripe/src/errors.test.ts	1
D127	packages/payments/stripe/src/index.ts	1
D127	packages/payments/stripe/src/testing/sandbox-checks.test.ts	1
D127	packages/shell/src/services.test.ts	1
```

## Appendix B: exported constants in the five packages (523 rows; non-test)
Command: `git grep -n -E 'export const [A-Z][A-Z0-9_]+ =' -- packages/core apps/worker apps/web packages/payments packages/connectors | grep -v -E '\.test\.tsx?:'`
```
apps/web/app/api/payments/notices/[kind]/handle.ts:23:export const MAX_NOTICE_BYTES = 1024 * 1024
apps/web/e2e/faces-preview.ts:31:export const FACE_ID = process.env.FACES_VISUAL_FACE || 'editorial-market'
apps/web/e2e/faces-preview.ts:37:export const PREVIEW_FACE = `[data-testid="phone-frame"] [data-face="${FACE_ID}"]:not([data-testid])`
apps/web/e2e/faces-preview.ts:40:export const SCREENS = ['bag', 'bill', 'call', 'pay'] as const
apps/web/e2e/support.ts:3:export const ADMIN_EMAIL = process.env.DEV_ADMIN_EMAIL ?? 'owner@demo-club.test'
apps/web/e2e/support.ts:4:export const ADMIN_PASSWORD = process.env.DEV_ADMIN_PASSWORD ?? 'local-only-not-a-secret'
apps/web/e2e/support.ts:5:export const VENUE_NAME = 'Demo Club Sofia'
apps/web/e2e/support.ts:7:export const ITEM_SHEET_ITEM = 'Негрони (e2e)'
apps/web/e2e/support.ts:11:export const INTEGRATION_OWNER_EMAIL = 'integration-owner@demo-club.test'
apps/web/e2e/support.ts:12:export const INTEGRATION_MEMBER_EMAIL = 'integration-member@demo-club.test'
apps/web/e2e/support.ts:13:export const INTEGRATION_VENUE_NAME = 'Integration Club Sofia'
apps/web/e2e/support.ts:17:export const PUBLISH_OWNER_EMAIL = 'publish-owner@demo-club.test'
apps/web/e2e/support.ts:18:export const PUBLISH_MEMBER_EMAIL = 'publish-member@demo-club.test'
apps/web/e2e/support.ts:19:export const PUBLISH_SLUG = 'publish-club'
apps/web/e2e/support.ts:26:export const GUEST_SLUG = 'demo-club'
apps/web/e2e/support.ts:27:export const GUEST_BRAND = '#2563eb'
apps/web/e2e/support.ts:28:export const GUEST_TABLE_TOKEN = 'tb_e2eGuestTable000001'
apps/web/e2e/support.ts:29:export const GUEST_TABLE_LABEL = '12'
apps/web/e2e/support.ts:30:export const TAG_SLUG = 'tag-fixture'
apps/web/e2e/support.ts:31:export const TAG_PUBLIC_ID = 'tagfixture01'
apps/web/e2e/support.ts:35:export const LOOK_SLUG = 'look-fixture'
apps/web/e2e/support.ts:36:export const LOOK_PUBLIC_ID = 'lookfixture1'
apps/web/e2e/support.ts:40:export const ORDER_SLUG = 'order-fixture'
apps/web/e2e/support.ts:41:export const ORDER_PUBLIC_ID = 'orderfixture'
apps/web/e2e/support.ts:43:export const ORDER_SPOT = { lat: 42.6977, lng: 23.3219 }
apps/web/e2e/support.ts:49:export const TONIGHT_OWNER_EMAIL = 'tonight-owner@demo-club.test'
apps/web/e2e/support.ts:50:export const TONIGHT_WAITER_EMAIL = 'tonight-waiter@demo-club.test'
apps/web/e2e/support.ts:51:export const TONIGHT_TABLET_EMAIL = 'tonight-tablet@demo-club.test'
apps/web/e2e/support.ts:52:export const TONIGHT_PIN_PEPPER = 'e2e-only-pin-pepper-not-used-anywhere-else-0123456789'
apps/web/e2e/visual-fixtures.ts:12:export const VISUAL_THEMES = [
apps/web/e2e/visual-fixtures.ts:26:export const CUSTOM_COLOURS = { primary: '#f6f1e9', secondary: '#e9dccb', tertiary: '#7a2e8c' }
apps/web/e2e/visual-fixtures.ts:32:export const VISUAL_SLUG = 'visual-fixture'
apps/web/e2e/visual-fixtures.ts:38:export const VISUAL_TABLE_LABEL = '12'
apps/web/e2e/visual-fixtures.ts:41:export const LONG_NAME_BG = `Негрони ${'и'.repeat(52)}`
apps/web/e2e/visual-fixtures.ts:43:export const LONG_NAME_EN = `Negroni ${'x'.repeat(52)}`
apps/web/e2e/visual-fixtures.ts:45:export const LONG_TEXT_NAME_BG = 'Агнешко печено с розмарин, чесън и зеленчуци на скара и лук.'
apps/web/e2e/visual-fixtures.ts:47:export const LONG_TEXT_NAME_EN = 'Roast lamb with rosemary, garlic and grilled vegetables (2x)'
apps/web/e2e/visual-fixtures.ts:54:export const LOGO_MARKS = {
apps/web/e2e/visual-fixtures.ts:61:export const VISUAL_ITEMS = {
apps/web/scripts/lib/demo-bar.ts:32:export const DEMO_BAR_MAPPING_VERSION = 1
apps/web/scripts/lib/demo-bar.ts:35:export const DEMO_BAR_SCENARIO = 'quiet-night'
apps/web/scripts/lib/demo-bar.ts:38:export const DEMO_BAR_VENUE = { name: 'Demo Bar', slug: 'demo-bar' } as const
apps/web/scripts/lib/demo-bar.ts:39:export const DEMO_BAR_INSTANCE_NAME = 'Simulated POS'
apps/web/scripts/lib/demo-bar.ts:42:export const DEMO_BAR_HOST = 'localhost:4010'
apps/web/scripts/lib/demo-bar.ts:45:export const DEMO_BAR_BID = 1
apps/web/scripts/lib/demo-menu.ts:22:export const DEMO_MAPPING_VERSION = 1
apps/web/scripts/lib/demo-menu.ts:25:export const DEMO_BARSY_HOST = 'dev-seed.test'
apps/web/scripts/lib/demo-menu.ts:172:export const DEMO_OWNED_ITEM = {
apps/web/src/components/admin/settings-sections.ts:20:export const SETTINGS_SECTIONS = [
apps/web/src/components/admin/settings-sections.ts:33:export const SETTINGS_PATH = '/settings'
apps/web/src/components/admin/workspace-tab-defs.ts:36:export const WORKSPACE_TAB_DEFS = [
apps/web/src/components/admin/workspace-tab-defs.ts:72:export const SETTINGS_SECTION_DEFS = [
apps/web/src/composer/dnd.ts:13:export const UNSORTED_KEY = 'unsorted'
apps/web/src/composer/dnd.ts:125:export const DROP_TARGET_ATTR = 'data-drop-target'
apps/web/src/composer/item-chips.tsx:14:export const MAX_ROW_CHIPS = 3
apps/web/src/composer/item-param.ts:7:export const ITEM_PARAM = 'item'
apps/web/src/composer/item-param.ts:8:export const SECTION_PARAM = 'section'
apps/web/src/composer/item-sheet-upload.ts:10:export const IMAGE_ACCEPT = ASSET_IMAGE_TYPES.join(',')
apps/web/src/composer/menu-bar.tsx:45:export const MENU_PARAM = 'menu'
apps/web/src/composer/subtabs.ts:8:export const COMPOSER_SUBTAB_DEFS = [
apps/web/src/composer/subtabs.ts:17:export const SUBTAB_PARAM = 'sub'
apps/web/src/composer/tree.ts:10:export const ROOT_KEY = 'root'
apps/web/src/connectors/notice-types.ts:7:export const PAYMENTS_ENVS = ['development', 'test', 'staging', 'production'] as const
apps/web/src/connectors/signed-notices.ts:16:export const NOTICE_TOLERANCE_SECONDS = 300
apps/web/src/connectors/sim-pay/notices.ts:13:export const SIM_PAY_SIGNATURE_HEADER = 'sim-pay-signature'
apps/web/src/connectors/stripe/notices.ts:21:export const STRIPE_SIGNATURE_HEADER = 'stripe-signature'
apps/web/src/connectors/test-view.ts:12:export const VENUE_ID = 'vn_0123456789ABCDEFGHIJKL'
apps/web/src/connectors/test-view.ts:13:export const INSTANCE_ID = 'in_0123456789ABCDEFGHIJKL'
apps/web/src/design/look-state.ts:103:export const STRONG_PAGE_CHROMA = 0.05
apps/web/src/faces/manifests.ts:40:export const DEFAULT_FACE_ID = 'editorial-market'
apps/web/src/fields/item-groups.ts:7:export const ITEM_GROUPS = [
apps/web/src/fields/registry.tsx:21:export const FIELD_REGISTRY = {
apps/web/src/fields/types.ts:41:export const PROVENANCES = ['till', 'owned', 'overridden', 'stale', 'locked'] as const
apps/web/src/guest/cdn.ts:13:export const CDN_BASE = cdnBase({ NEXT_PUBLIC_CDN_BASE_URL: process.env.NEXT_PUBLIC_CDN_BASE_URL })
apps/web/src/guest/headers.ts:68:export const GUEST_PAGE_SOURCES = ['/m/:path*', '/t/:path*'] as const
apps/web/src/guest/load.ts:228:export const LIVE_REFETCH_ATTEMPTS = 3
apps/web/src/guest/load.ts:229:export const LIVE_REFETCH_DELAY_MS = 2_000
apps/web/src/guest/services-client.ts:80:export const POLL_BACKOFF_MS = [4_000, 8_000, 16_000, 30_000] as const
apps/web/src/guest/services-client.ts:83:export const OFFLINE_AFTER_MS = 10_000
apps/web/src/guest/services-client.ts:120:export const PASS_KEY = 'restro.locationPass'
apps/web/src/guest/services-client.ts:128:export const PAY_HANDLE_KEY = 'restro.payHandle'
apps/web/src/guest/services-client.ts:134:export const PAY_RETURNED_KEY = 'restro.payReturned'
apps/web/src/guest/services-client.ts:137:export const PAY_RECENT_KEY = 'restro.payRecent'
apps/web/src/guest/services-client.ts:147:export const PAY_EMAIL_KEY = 'restro.payEmail'
apps/web/src/guest/services-client.ts:156:export const CONSENT_KEY = 'restro.locationConsent'
apps/web/src/i18n/locales.ts:6:export const ADMIN_LOCALES = ['bg', 'en'] as const
apps/web/src/i18n/locales.ts:14:export const LOCALE_COOKIE = 'NEXT_LOCALE'
apps/web/src/integration/format.ts:6:export const COUNTER_KEYS = [
apps/web/src/integration/format.ts:64:export const KNOWN_REFUSAL_CODES = [
apps/web/src/integration/live-refresh.tsx:7:export const REFRESH_INTERVAL_MS = 3000
apps/web/src/lib/slug.ts:7:export const MAX_SUGGESTED_SLUG_LENGTH = 60
apps/web/src/lib/theme.ts:11:export const THEME_COOKIE = 'restro_theme'
apps/web/src/lib/theme.ts:46:export const THEME_INIT_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);var c=m?decodeURIComponent(m[1]):"system";var d=c==="dark"||(c!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`
apps/web/src/publish/held-banner.tsx:18:export const HELD_NAMES_SHOWN = 8
apps/web/src/publish/test-view.ts:13:export const VENUE_ID = 'vn_demoVenueForPublishTests'
apps/web/src/publish/use-publisher.ts:28:export const SLOW_AFTER_MS = 45_000
apps/web/src/server/auth.ts:54:export const SESSION_OPTIONS = {
apps/web/src/server/cookie-prefix.ts:2:export const AUTH_COOKIE_PREFIX = 'restro'
apps/web/src/server/guard/bad-codes.ts:19:export const BAD_CODE_LIMITS = {
apps/web/src/server/integration/service.ts:84:export const HISTORY_LENGTH = 20
apps/web/src/server/integration/service.ts:89:export const HISTORY_EXCLUDED_KINDS = ['asset_fetch'] as const
apps/web/src/server/publish/load.ts:76:export const HISTORY_PAGE_SIZE = 20
apps/web/src/server/session.ts:77:export const LOGIN_PATH = '/login'
apps/web/src/server/tables/qr-image.ts:18:export const DOWNLOAD_WIDTH = 1024
apps/web/src/server/tonight/night-view.ts:125:export const PAYMENT_ANSWER_CODES = [
apps/web/src/server/tonight/view.ts:15:export const ROW_RANK = {
apps/web/src/server/turnstile.ts:18:export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
apps/web/src/server/venues-result.ts:6:export const NEW_VENUE_TIMEZONE = 'Europe/Sofia'
apps/web/src/server/venues-result.ts:7:export const NEW_VENUE_CURRENCY = 'EUR'
apps/web/src/settings/hours.ts:46:export const LAST_ORDERS_MARGIN = LAST_ORDERS_BEFORE_DAY_END_MINUTES
apps/web/src/settings/hours.ts:77:export const CHOICES = {
apps/web/src/settings/hours.ts:88:export const SPOT_ACCURACY_LIMIT_METRES = 100
apps/web/src/settings/staff-people.tsx:54:export const PIN_SHOWN_MS = 30_000
apps/web/src/settings/staff-roles.tsx:45:export const PERMISSION_GROUPS = [
apps/web/src/tables/print-sheet.tsx:14:export const CARDS_PER_SHEET = 6
apps/web/src/tables/print-sheet.tsx:50:export const PRINT_CSS = `
apps/web/src/tables/test-view.ts:7:export const VENUE_ID = 'vn_0123456789ABCDEFGHIJKL'
apps/web/src/tables/test-view.ts:8:export const TOKEN_A = 'Ab3dEfGh1jKlMnOpQrStUv'
apps/web/src/tables/test-view.ts:9:export const SVG =
apps/web/src/tables/test-view.ts:12:export const MAIN_MENU = 'nd_0000000000000000000001'
apps/web/src/tables/test-view.ts:13:export const COCKTAILS = 'nd_0000000000000000000002'
apps/web/src/tables/test-view.ts:15:export const MENUS = [
apps/web/src/test-utils.tsx:12:export const MESSAGES = { bg, en } as const
apps/web/src/tonight/dispute-evidence.tsx:19:export const EVIDENCE_PRINT_CSS = `
apps/web/src/tonight/live-feed.ts:12:export const FEED_POLL_MS = 5000
apps/web/src/tonight/log-sentence.ts:81:export const SENTENCES = {
apps/web/src/tonight/money-rows.tsx:29:export const MONEY_ICONS = {
apps/web/src/tonight/night-slots.ts:13:export const NIGHT_SECTION_ACCESS = {
apps/web/src/tonight/pages.ts:3:export const PAGE = 100
apps/web/src/tonight/tonight-views.ts:5:export const TONIGHT_VIEW_NAMES = ['actions', 'sent', 'log', 'night'] as const
apps/worker/src/alerts/telegram-link-api.ts:27:export const TELEGRAM_PATH = '/internal/telegram'
apps/worker/src/alerts/telegram-link-api.ts:30:export const MAX_TELEGRAM_BODY_BYTES = 4 * 1024
apps/worker/src/alerts/telegram-link.ts:16:export const LINK_MINUTES = 15
apps/worker/src/alerts/telegram-poller.ts:41:export const POLL_SECONDS = 25
apps/worker/src/config.ts:24:export const DEFAULT_HEALTH_PORT = 8081
apps/worker/src/config.ts:27:export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
apps/worker/src/config.ts:156:export const DEFAULT_BARSY_HOST_SUFFIXES = ['.barsyonline.com'] as const
apps/worker/src/connection.ts:13:export const APP_POOL_MAX = 2
apps/worker/src/connection.ts:16:export const QUEUE_POOL_MAX = 3
apps/worker/src/connection.ts:19:export const QUEUE_SCHEMA = 'pgboss'
apps/worker/src/health-server.ts:38:export const HEALTH_PATH = '/health'
apps/worker/src/health.ts:10:export const HEARTBEAT_MAX_AGE_MS = 3 * 60_000
apps/worker/src/jobs/alerts.ts:27:export const PASS_EVERY_MS = 5_000
apps/worker/src/jobs/alerts.ts:29:export const PASS_BUDGET_MS = 55_000
apps/worker/src/jobs/alerts.ts:31:export const PING_TIMEOUT_MS = 10_000
apps/worker/src/jobs/breaker.ts:246:export const SHARED_BREAKERS = new ConnectionBreakers()
apps/worker/src/jobs/connection.ts:101:export const PROBE_CAUSES = { training: 'training_mode', fiscalDevice: 'fiscal_device' } as const
apps/worker/src/jobs/floor.ts:61:export const FLOOR_READ_INTERVAL_MS = 5 * MINUTE
apps/worker/src/jobs/floor.ts:64:export const FLOOR_RUN_KIND = 'floor_read'
apps/worker/src/jobs/floor.ts:329:export const SHARED_BUDGETS = new InstanceBudgets()
apps/worker/src/jobs/order-send.ts:103:export const SENDS_PER_RUN = 20
apps/worker/src/jobs/payment-breaker.ts:54:export const PROVIDER_UNREACHABLE_CAUSE = 'provider_unreachable'
apps/worker/src/jobs/payment-breaker.ts:225:export const SHARED_PAYMENT_BREAKERS = new PaymentBreakers()
apps/worker/src/jobs/payment-recovery.ts:51:export const PAYMENT_STALE_MS = 60_000
apps/worker/src/jobs/payment-recovery.ts:53:export const PAYMENT_STUCK_MS = 10 * 60_000
apps/worker/src/jobs/payment-recovery.ts:55:export const RELEASE_READ_BACK_SECONDS = 10 * 60
apps/worker/src/jobs/payment-recovery.ts:60:export const FINAL_TABLE_READ_SECONDS = 5 * 60
apps/worker/src/jobs/payment-recovery.ts:62:export const RECOVERY_EVERY_MS = 30_000
apps/worker/src/jobs/payments.ts:160:export const PAYMENT_RUN_MS = 120_000
apps/worker/src/jobs/payments.ts:172:export const RECEIPT_SEND_MS =
apps/worker/src/jobs/payments.ts:190:export const PAYMENT_PREPARE_EXPIRE_SECONDS = 6 * 60
apps/worker/src/jobs/provider-notices.ts:56:export const NOTICE_PAGE = 100
apps/worker/src/jobs/provider-notices.ts:59:export const NOTICE_RUN_CAP = 1_000
apps/worker/src/jobs/provider-notices.ts:62:export const NOTICE_RUN_BUDGET_MS = 45_000
apps/worker/src/jobs/provider-notices.ts:65:export const NOTICE_LATE_MS = 24 * 60 * 60 * 1000
apps/worker/src/jobs/provider-notices.ts:72:export const ACCOUNT_NOTICE_GRACE_MS = 10 * 60 * 1000
apps/worker/src/jobs/readings.ts:67:export const TABLE_READ_INTERVAL_MS = 60_000
apps/worker/src/jobs/readings.ts:70:export const TABLE_READ_MIN_GAP_MS = 15_000
apps/worker/src/jobs/readings.ts:78:export const INSTANCE_READ_BUDGET = { burst: 5, perSecond: 1 } as const
apps/worker/src/jobs/service-day.ts:129:export const NIGHT_REPORT_MAX_AGE_DAYS = 2
apps/worker/src/jobs/stock.ts:62:export const STOCK_TICK_CRON = '*/5 * * * *'
apps/worker/src/jobs/worker-heartbeat.ts:14:export const WORKER_HEARTBEAT_JOB = 'worker-heartbeat'
apps/worker/src/payments/connection-api.ts:31:export const CONNECTION_PATH = '/internal/payments/connection'
apps/worker/src/payments/connection-api.ts:34:export const MAX_CONNECTION_BODY_BYTES = 4 * 1024
apps/worker/src/publish/rollover.ts:27:export const REASSERT_AFTER_MS = 10 * 60 * 1000
apps/worker/src/receipts/email-sender.ts:67:export const RECEIPT_CALL_TIMEOUT_MS = 15_000
apps/worker/src/registry.ts:9:export const DEAD_LETTER_SUFFIX = '.dead'
apps/worker/src/reveal.ts:31:export const REVEAL_PATH = '/internal/reveal'
apps/worker/src/reveal.ts:34:export const MAX_REVEAL_BODY_BYTES = 32 * 1024
apps/worker/src/service-connectors.ts:42:export const SIM_SCENARIO_KEY = 'sim_scenario'
apps/worker/src/shutdown.ts:15:export const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const
apps/worker/src/shutdown.ts:18:export const FORCE_EXIT_AFTER_MS = 30_000
apps/worker/src/sync/catalogue.ts:108:export const SUPPLEMENT_CHUNK = 10
apps/worker/src/sync/chunk.ts:18:export const MAX_CHUNK_OPS = 200
apps/worker/src/sync/cursor.ts:9:export const CURSOR_OVERLAP_MINUTES = 65
apps/worker/src/sync/limiter.ts:10:export const BARSY_CONCURRENCY = 2
apps/worker/src/sync/paging.ts:24:export const FAILURES_AT_FLOOR = 3
apps/worker/src/sync/paging.ts:27:export const MAX_CONSECUTIVE_FAILED_PAGES = 3
apps/worker/src/sync/photos.ts:31:export const PHOTO_TIMEOUT_MS = 20_000
apps/worker/src/sync/pull-lock.ts:32:export const PULL_LOCK_WAIT_MS = 60_000
apps/worker/src/sync/pull-lock.ts:34:export const PULL_LOCK_POLL_MS = 2_000
apps/worker/src/sync/pull-lock.ts:36:export const PULL_LOCKS_MAX = APP_POOL_MAX - 1
apps/worker/src/sync/run.ts:44:export const WRONG_CREDENTIALS = 'wrong_credentials'
apps/worker/src/worker.ts:47:export const SHUTDOWN_TIMEOUT_MS = 20_000
apps/worker/tests/database.ts:49:export const SETUP_TIMEOUT_MS = 180_000
apps/worker/tests/world.ts:70:export const DEMO_ROOT_CAT = 1091
apps/worker/tests/world.ts:72:export const DEMO_PUBLIC_CAT = 1171
apps/worker/tests/world.ts:73:export const DEMO_BID = 10
packages/connectors/sim-pos/src/connector.ts:44:export const SIM_KIND = 'sim'
packages/connectors/sim-pos/src/control/page.ts:8:export const CONTROL_PAGE = `<!doctype html>
packages/connectors/sim-pos/src/control/server.ts:30:export const TOKEN_HEADER = 'x-sim-token'
packages/connectors/sim-pos/src/control/server.ts:33:export const DEFAULT_PORT = 4010
packages/connectors/sim-pos/src/control/view.ts:13:export const TICKETS_SHOWN = 15
packages/connectors/sim-pos/src/control/view.ts:14:export const CALLS_SHOWN = 100
packages/connectors/sim-pos/src/engine/errors.ts:24:export const POS_ERRORS = {
packages/connectors/sim-pos/src/engine/scenario.ts:26:export const SIM_PASSWORD = 'sim-pos-local'
packages/connectors/sim-pos/src/engine/units.ts:10:export const QUANTITY_SCALE = 3
packages/connectors/sim-pos/src/hosts.ts:6:export const SIM_ENVS = ['development', 'test', 'staging', 'production'] as const
packages/connectors/sim-pos/src/scenario-file.ts:22:export const SCENARIOS_DIR = fileURLToPath(new URL('../scenarios/', import.meta.url))
packages/connectors/sim-pos/src/scenario-file.ts:25:export const DEFAULT_SCENARIO_NAME = 'quiet-night'
packages/connectors/sim-pos/src/switches.ts:126:export const PROFILE_NAMES = ['cautious', 'pilot'] as const
packages/connectors/sim-pos/src/testing/test-harness.ts:22:export const STEP_MS = 200
packages/connectors/sim-pos/src/testing/test-harness.ts:25:export const READ_TABLE = 'T 8 hall'
packages/connectors/sim-pos/src/testing/test-harness.ts:28:export const READ_TABLE_CHARGE = 300
packages/connectors/sim-pos/src/waiter-actions.ts:6:export const SIM_WAITER_ACTIONS = Object.freeze({
packages/core/src/allergens.ts:5:export const ALLERGENS = [
packages/core/src/allergens.ts:29:export const DIETARY_LABELS = [
packages/core/src/apply/job-runs.ts:24:export const MAX_DETAIL_ENTRIES = 200
packages/core/src/apply/organization.ts:156:export const MAX_ORGANIZATION_NAME_LENGTH = 200
packages/core/src/apply/payment-mode.ts:23:export const MAX_PAYMENT_MODE_ITEMS = 1000
packages/core/src/apply/publish.ts:80:export const PUBLISH_REASONS = ['manual', 'auto_sync'] as const
packages/core/src/apply/sold-out.ts:37:export const MAX_SOLD_OUT_ITEMS = 200
packages/core/src/apply/sources.ts:24:export const INTEGRATION_STATUSES = ['new', 'connected', 'error'] as const
packages/core/src/apply/sources.ts:57:export const MAX_INTEGRATION_NAME_LENGTH = 80
packages/core/src/apply/stock.ts:39:export const STOCK_RECORD_TYPE = 'stock'
packages/core/src/apply/stock.ts:42:export const STOCK_MAPPING_VERSION = 1
packages/core/src/apply/tables.ts:73:export const MAX_AREA_NAME_LENGTH = 60
packages/core/src/apply/till-menus.ts:33:export const MENU_ROOT_LINK_TYPE = 'menu_root'
packages/core/src/apply/till-tables.ts:55:export const UNNAMED_AREA = 'Tables'
packages/core/src/apply/venue-lifecycle.ts:43:export const MAX_VENUE_NAME_LENGTH = 120
packages/core/src/assets.ts:6:export const ASSET_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
packages/core/src/assets.ts:12:export const ASSET_IMAGE_EXTENSIONS = {
packages/core/src/assets.ts:19:export const ASSET_ORIGINS = ['upload', 'connector'] as const
packages/core/src/assets.ts:25:export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
packages/core/src/assets.ts:28:export const MAX_IMAGE_SIDE = 16_383
packages/core/src/assets.ts:31:export const MAX_IMAGE_PIXELS = 100_000_000
packages/core/src/change-set.ts:21:export const TILL_SOURCE_PREFIX = 'till:'
packages/core/src/change-set.ts:284:export const LINK_STATES = ['active', 'missing', 'deleted'] as const
packages/core/src/change-set.ts:397:export const CHANGE_SET_OP_NAMES = [
packages/core/src/connectors/index.ts:16:export const INTEGRATION_KINDS = ['barsy', 'sim'] as const
packages/core/src/connectors/payment/capabilities.ts:11:export const PAYMENT_WALLETS = ['apple_pay', 'google_pay'] as const
packages/core/src/connectors/payment/provider.ts:34:export const PAYMENT_PROVIDER_STEPS = [
packages/core/src/connectors/payment/provider.ts:105:export const NOTICE_REFUSAL_REASONS = [
packages/core/src/connectors/payment/schemas.ts:51:export const PAYMENT_REFUSAL_SCOPES = ['payment', 'account'] as const
packages/core/src/connectors/payment/schemas.ts:59:export const PAYMENT_REFUSAL_CODES = [
packages/core/src/connectors/payment/schemas.ts:114:export const PROVIDER_PAYMENT_STATUSES = [
packages/core/src/connectors/payment/schemas.ts:127:export const THREE_DS_RESULTS = [
packages/core/src/connectors/payment/schemas.ts:143:export const PAYMENT_DISPUTE_STATES = ['open', 'won', 'lost'] as const
packages/core/src/connectors/payment/schemas.ts:223:export const PROVIDER_NOTICE_KINDS = [
packages/core/src/connectors/payment/schemas.ts:355:export const PAYMENT_ANSWER_SCHEMAS = {
packages/core/src/connectors/payment/testing/harness.ts:13:export const FAULT_STEPS = ['createHold', 'capture', 'release'] as const
packages/core/src/connectors/service/capabilities.ts:13:export const SERVICE_CAPABILITIES = [
packages/core/src/connectors/service/schemas.ts:44:export const REFUSAL_SCOPES = ['line', 'bill', 'login', 'venue'] as const
packages/core/src/connectors/service/schemas.ts:52:export const REFUSAL_CODES = [
packages/core/src/connectors/service/schemas.ts:374:export const RECEIPT_FILE_MAX_BYTES = 2_000_000
packages/core/src/connectors/service/testing/checks-write.ts:445:export const KIT_TIP_MINOR = 137
packages/core/src/connectors/service/testing/checks-write.ts:494:export const KIT_RECEIPT_EMAIL = 'kit-guest@example.test'
packages/core/src/connectors/service/testing/harness.ts:121:export const KIT_MARGIN_MS = 1_500
packages/core/src/connectors/service/testing/toy-pos.ts:60:export const TOY_PAYMENT_TABLE = 'tbl/pay'
packages/core/src/connectors/service/testing/toy-pos.ts:62:export const TOY_TIP_ITEM = 'art#tip'
packages/core/src/connectors/service/testing/toy-pos.ts:65:export const TOY_RECEIPT_FILE = {
packages/core/src/connectors/service/waiter-actions.ts:7:export const WAITER_ACTIONS = [
packages/core/src/connectors/service/waiter-actions.ts:25:export const SERVICE_WRITE_STEPS = {
packages/core/src/connectors/service/waiter-actions.ts:33:export const SERVICE_READ_STEPS = [
packages/core/src/field-definition.ts:17:export const OWNERS = ['till', 'builder'] as const
packages/core/src/field-definition.ts:26:export const OVERRIDABLE = ['never', 'never_when_orderable', 'always'] as const
packages/core/src/field-definition.ts:36:export const COMBINATORS = [
packages/core/src/field-definition.ts:48:export const VISIBILITIES = ['public', 'internal'] as const
packages/core/src/field-definition.ts:53:export const STALE_POLICIES = ['review', 'keep', 'drop'] as const
packages/core/src/field-definition.ts:58:export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
packages/core/src/field-types/catalog.ts:15:export const FIELD_TYPE_NAMES = [
packages/core/src/field-types/catalog.ts:42:export const MEASUREMENT_UNITS = ['g', 'kg', 'ml', 'l', 'cl', 'pcs'] as const
packages/core/src/field-types/catalog.ts:102:export const FIELD_VALUE_SCHEMAS = {
packages/core/src/field-types/catalog.ts:202:export const FIELD_CONSTRAINT_SCHEMAS = {
packages/core/src/guest-files.ts:30:export const VENUE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
packages/core/src/guest-files.ts:32:export const MAX_VENUE_SLUG_LENGTH = 63
packages/core/src/guest-files.ts:38:export const ORGANIZATION_SLUG_PATTERN = VENUE_SLUG_PATTERN
packages/core/src/guest-files.ts:40:export const MAX_ORGANIZATION_SLUG_LENGTH = MAX_VENUE_SLUG_LENGTH
packages/core/src/guest-files.ts:75:export const TABLE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/
packages/core/src/guest-files.ts:81:export const TABLE_CODE_HASH_PATTERN = /^[0-9a-f]{64}$/
packages/core/src/ids.ts:18:export const ID_KINDS = [
packages/core/src/jobs.ts:18:export const JOB_NAMES = {
packages/core/src/jobs.ts:254:export const PUBLISH_JOB_REASONS = ['manual', 'auto_sync'] as const
packages/core/src/jobs.ts:257:export const AUTO_PUBLISH_DELAY_SECONDS = 30
packages/core/src/jobs.ts:291:export const MAX_RETIRED_TOKENS = 500
packages/core/src/jobs.ts:320:export const JOB_PAYLOADS = {
packages/core/src/languages.ts:24:export const LANGUAGE_COVERAGE_THRESHOLD = 0.2
packages/core/src/languages.ts:27:export const LANGUAGE_REPORT_KEY = 'languages_report'
packages/core/src/legal-details.ts:15:export const LEGAL_NAME_MAX = 200
packages/core/src/legal-details.ts:16:export const LEGAL_ADDRESS_MAX = 300
packages/core/src/legal-details.ts:17:export const LEGAL_PRIVACY_URL_MAX = 500
packages/core/src/legal-details.ts:20:export const EIK_PATTERN = /^(\d{9}|\d{13})$/
packages/core/src/locales.ts:7:export const LOCALES = [
packages/core/src/location-check.ts:21:export const LOCATION_CONSENT_VERSION = 'v1'
packages/core/src/location-check.ts:24:export const CANT_CHECK_ACCURACY_M = 1_000
packages/core/src/location-check.ts:27:export const LOCATE_TIMEOUT_MS = 10_000
packages/core/src/menus.ts:8:export const MENU_LAYOUTS = ['list', 'one_column', 'two_columns'] as const
packages/core/src/menus.ts:27:export const MAX_MENU_NAME_LENGTH = 120
packages/core/src/money.ts:9:export const CURRENCIES = ['EUR'] as const
packages/core/src/node-types.ts:7:export const NODE_TYPES = [
packages/core/src/node-types.ts:45:export const MAX_SECTION_DEPTH = 3
packages/core/src/node-types.ts:73:export const NODE_STATUSES = ['active', 'hidden', 'archived'] as const
packages/core/src/ordering-settings.ts:29:export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
packages/core/src/ordering-settings.ts:45:export const DEFAULT_PRE_OPENING_RULE = { startMinutes: 120, everyMinutes: 10, alertMinutes: 30 }
packages/core/src/ordering-settings.ts:71:export const ORDERING_CAP_MAX_MINOR = 1_000_000
packages/core/src/ordering-settings.ts:127:export const LAST_ORDERS_BEFORE_DAY_END_MINUTES = 15
packages/core/src/paid-lines.ts:6:export const PAID_LINES_MAX = 500
packages/core/src/paying-settings.ts:13:export const CARD_FLOOR_MINOR = 50
packages/core/src/paying-settings.ts:16:export const MIN_CARD_MAX_MINOR = 100_000
packages/core/src/payment-connection.ts:21:export const PAYING_CHECKS = [
packages/core/src/payment-connection.ts:30:export const OWNER_TICKS = ['cardTypeInTill', 'receiptEmailsOff'] as const
packages/core/src/payment-connection.ts:34:export const LOST_REASONS = ['access_removed', 'account_restricted'] as const
packages/core/src/pin-guard.ts:12:export const PIN_GUARD_FAILURES = 5
packages/core/src/pin-guard.ts:14:export const PIN_GUARD_WINDOW_MS = 5 * 60_000
packages/core/src/public-id.ts:8:export const PUBLIC_ID_LENGTH = 12
packages/core/src/public-id.ts:16:export const PUBLIC_ID_PATTERN = /^[a-z0-9]{12}$/
packages/core/src/purge.ts:19:export const VENUE_BIN_DAYS = 30
packages/core/src/purge.ts:21:export const MENU_BIN_DAYS = 30
packages/core/src/purge.ts:23:export const TABLE_BIN_DAYS = 30
packages/core/src/purge.ts:25:export const INSTANCE_BIN_DAYS = 30
packages/core/src/purge.ts:27:export const VERSIONS_KEPT = 2
packages/core/src/purge.ts:29:export const VERSION_PURGE_DAYS = 30
packages/core/src/purge.ts:31:export const CHANGE_LOG_DAYS = 61
packages/core/src/qr.ts:18:export const QR_MODES = ['ours', 'own'] as const
packages/core/src/qr.ts:23:export const QR_TOKEN_PLACEHOLDER = '{token}'
packages/core/src/qr.ts:25:export const MAX_QR_BASE_URL_LENGTH = 200
packages/core/src/qr.ts:26:export const MAX_QR_PATTERN_LENGTH = 300
packages/core/src/qr.ts:28:export const MAX_TABLE_LABEL_LENGTH = 40
packages/core/src/qr.ts:248:export const TABLE_CODE_HEADER = 'x-table-code'
packages/core/src/resolve/compare-visibility.ts:8:export const V11_MAX_HIDDEN_SHARE = 0.3
packages/core/src/resolve/fixtures.ts:23:export const VENUE_ID = testId('vn', 'beach')
packages/core/src/resolve/fixtures.ts:26:export const ROOT = nd('root')
packages/core/src/seal/envelope.ts:26:export const SEAL_VERSION = 'rs1'
packages/core/src/seal/envelope.ts:29:export const SEAL_INFO = 'restro-seal-v1'
packages/core/src/seal/envelope.ts:32:export const MAX_PLAINTEXT_BYTES = 64 * 1024
packages/core/src/seal/envelope.ts:36:export const NONCE_BYTES = 12
packages/core/src/seal/envelope.ts:37:export const TAG_BYTES = 16
packages/core/src/seal/staff-pin.ts:12:export const STAFF_PIN_PATTERN = /^[0-9]{4}$/
packages/core/src/service-capabilities-config.ts:16:export const SERVICE_CAPABILITIES_CONFIG_KEY = 'service_capabilities'
packages/core/src/service-hours.ts:21:export const LAST_ORDERS_NOTICE_MINUTES = 10
packages/core/src/service/action-ring.ts:13:export const ACTION_RING_SIZE = 64
packages/core/src/service/alert-delivery.ts:22:export const STALE_NEW_MS = 6 * 3_600_000
packages/core/src/service/alert-delivery.ts:25:export const HOLD_LAST_DAY_MS = 24 * 3_600_000
packages/core/src/service/alert-delivery.ts:41:export const RECEIVERS = ['push', 'venueTelegram', 'team'] as const
packages/core/src/service/alert-delivery.ts:47:export const STEPS = ['new', 'reminder', 'back', 'still_paused', 'done_edit'] as const
packages/core/src/service/alert-rules.ts:14:export const ORDER_UNCONFIRMED_KIND = 'order_unconfirmed'
packages/core/src/service/alert-rules.ts:15:export const ORDER_RATE_KIND = 'order_rate'
packages/core/src/service/alert-rules.ts:16:export const ORDER_PACE_KIND = 'order_pace'
packages/core/src/service/alert-rules.ts:17:export const CONNECTION_UNSTABLE_KIND = 'connection_unstable'
packages/core/src/service/alert-rules.ts:19:export const PAUSED_KIND = 'ordering_paused'
packages/core/src/service/alert-rules.ts:21:export const PRE_OPENING_KIND = 'pre_opening_check'
packages/core/src/service/alert-rules.ts:23:export const TABLE_CODE_BLOCK_KIND = 'table_code_block'
packages/core/src/service/alert-rules.ts:25:export const OUT_OF_STOCK_KIND = 'item_out_of_stock'
packages/core/src/service/alert-rules.ts:27:export const PAYMENT_UNCONFIRMED_KIND = 'payment_unconfirmed'
packages/core/src/service/alert-rules.ts:32:export const PAYMENT_LINES_NOT_BACK_KIND = 'payment_lines_not_back'
packages/core/src/service/alert-rules.ts:34:export const PAYMENT_CHECK_FAILED_KIND = 'payment_check_failed'
packages/core/src/service/alert-rules.ts:36:export const PAYMENT_STRANDED_KIND = 'payment_stranded'
packages/core/src/service/alert-rules.ts:38:export const PAYMENT_CAPTURE_FAILED_KIND = 'payment_capture_failed'
packages/core/src/service/alert-rules.ts:43:export const PAYMENT_RELEASE_REFUSED_KIND = 'payment_release_refused'
packages/core/src/service/alert-rules.ts:49:export const PAYMENT_HOLD_EXPIRED_KIND = 'payment_hold_expired'
packages/core/src/service/alert-rules.ts:54:export const PAYING_PAUSED_KIND = 'paying_paused'
packages/core/src/service/alert-rules.ts:59:export const PAYING_UNSTABLE_KIND = 'paying_unstable'
packages/core/src/service/alert-rules.ts:64:export const PAYMENT_STUCK_KIND = 'payment_stuck'
packages/core/src/service/alert-rules.ts:70:export const PAYMENT_ACCOUNT_LOST_KIND = 'payment_account_lost'
packages/core/src/service/alert-rules.ts:77:export const PAYMENT_REFUNDED_KIND = 'payment_refunded'
packages/core/src/service/alert-rules.ts:82:export const PAYMENT_DISPUTED_KIND = 'payment_disputed'
packages/core/src/service/alerts.ts:24:export const PAUSE_RETURN_MS = 10 * 60_000
packages/core/src/service/bill.ts:31:export const FRESH_READING_MS = 15_000
packages/core/src/service/bill.ts:34:export const MIN_BILL_ID_KEY_LENGTH = 32
packages/core/src/service/breaker.ts:33:export const BREAKER = Object.freeze({
packages/core/src/service/breaker.ts:62:export const BREAKER_CAUSES = {
packages/core/src/service/commands.ts:270:export const SERVICE_COMMANDS = {
packages/core/src/service/context.ts:14:export const SERVICE_ORIGINS = ['guest', 'staff', 'worker'] as const
packages/core/src/service/context.ts:23:export const VIA_VALUES = ['guest_page', 'tonight', 'telegram', 'worker', 'provider'] as const
packages/core/src/service/context.ts:171:export const FRESH_SIGN_IN_MINUTES = 15
packages/core/src/service/engine.ts:59:export const SERVICE_LOCK_TIMEOUT = '2s'
packages/core/src/service/engine.ts:61:export const SERVICE_STATEMENT_TIMEOUT = '5s'
packages/core/src/service/floor-pause.ts:21:export const TABLE_VANISHED_CAUSE = 'table_vanished'
packages/core/src/service/floor-pause.ts:24:export const TABLE_RETURNED_REASON = 'table_returned'
packages/core/src/service/guest-limits.ts:22:export const GUEST_LIMITS = {
packages/core/src/service/guest.ts:87:export const GUEST_VIEWS = ['menu', 'order', 'bill'] as const
packages/core/src/service/guest.ts:93:export const GUEST_POLL_MS = { fast: 2_000, menu: 10_000 } as const
packages/core/src/service/leases.ts:21:export const LEASE_SCOPES = ['order_slot', 'payment_table'] as const
packages/core/src/service/location-pass.ts:21:export const MIN_PASS_KEY_LENGTH = 32
packages/core/src/service/location-pass.ts:24:export const MAX_PASS_LENGTH = 1_024
packages/core/src/service/lock-order.ts:14:export const LOCK_RANKS = [
packages/core/src/service/log-view.ts:11:export const LOG_GROUPS = ['orders', 'money', 'pauses', 'settings'] as const
packages/core/src/service/log-view.ts:17:export const LOG_KIND_GROUP = {
packages/core/src/service/log.ts:24:export const NIGHT_RETENTION_DAYS = 31
packages/core/src/service/log.ts:27:export const RECORD_RETENTION_MONTHS = 18
packages/core/src/service/log.ts:33:export const LOG_KINDS = {
packages/core/src/service/night-export.ts:17:export const CSV_COLUMNS = [
packages/core/src/service/night-export.ts:53:export const CSV_BOM = '﻿'
packages/core/src/service/night-payments.ts:69:export const PAYMENT_ALERT_KINDS = [
packages/core/src/service/night-payments.ts:91:export const PAYMENTS_MAX_ROWS = 2000
packages/core/src/service/night-payments.ts:385:export const FIX_CONDITION = or(
packages/core/src/service/night-read.ts:49:export const NOT_ADDED_STATES = ['not_sent', 'unconfirmed'] as const
packages/core/src/service/night-read.ts:52:export const ANSWER_REASONS = { staff_found: 'found', staff_not_found: 'not_found' } as const
packages/core/src/service/night-read.ts:55:export const MAX_ROWS = 2000
packages/core/src/service/night-read.ts:58:export const PAGE_SIZE = 100
packages/core/src/service/night-read.ts:1159:export const MAX_EXPORT_DAYS = 600
packages/core/src/service/order-rate.ts:17:export const ORDER_RATE_ALERT = 'order_rate'
packages/core/src/service/pause-scope.ts:16:export const COVERED_VENUES_KEY = 'venueIds'
packages/core/src/service/pauses.ts:39:export const STAFF_PAUSE_CAUSE = 'staff'
packages/core/src/service/pauses.ts:41:export const UNCONFIRMED_PAUSE_MS = 15 * 60_000
packages/core/src/service/pauses.ts:43:export const CONNECTION_UNSTABLE_ALERT = 'connection_unstable'
packages/core/src/service/pauses.ts:46:export const LIFT_REASONS = {
packages/core/src/service/pay-first.ts:191:export const PAY_FIRST_SEND_REFUSALS = [
packages/core/src/service/pay-first.ts:692:export const PAY_FIRST_COMMANDS = {
packages/core/src/service/pay-route.ts:94:export const PAYMENT_WRITE_PAUSE_MS = 1_000
packages/core/src/service/pay-route.ts:110:export const PAYMENT_TURN_SECONDS = paymentTurnSeconds()
packages/core/src/service/pay-route.ts:113:export const PAYMENT_LONG_WAIT_MS = 10_000
packages/core/src/service/pay-route.ts:122:export const PAYMENT_ANSWERS = ['receipt_printed', 'no_receipt', 'on_till', 'not_on_till'] as const
packages/core/src/service/pay-route.ts:128:export const PAYMENT_QUESTIONS = ['close', 'lines_not_back'] as const
packages/core/src/service/pay-route.ts:135:export const PAYMENT_UNCONFIRMED_REASONS = [
packages/core/src/service/pay-route.ts:1308:export const RECEIPT_EMAIL_KEPT_MS = 30 * 60_000
packages/core/src/service/pay-route.ts:1336:export const PAY_ROUTE_COMMANDS = {
packages/core/src/service/pay.ts:57:export const PAY_REFUSALS = [
packages/core/src/service/pay.ts:85:export const PAYMENT_CONFIRM_MS = 2 * 60_000
packages/core/src/service/pay.ts:87:export const PAYMENT_SESSION_MS = 10 * 60_000
packages/core/src/service/pay.ts:89:export const TABLE_OPEN_PAYMENTS = 3
packages/core/src/service/pay.ts:91:export const PAYMENT_QUEUE_MS = 60_000
packages/core/src/service/pay.ts:943:export const PAYMENT_STEP_NAMES = [
packages/core/src/service/payment-connection.ts:59:export const CONNECT_PERMISSION = 'settings.connect_payments' as const
packages/core/src/service/payment-number.ts:11:export const PAYMENT_NUMBER_LENGTH = 5
packages/core/src/service/payment-observe.ts:32:export const DISPUTE_RETENTION_MONTHS = 6
packages/core/src/service/payment-refunds.ts:29:export const FOLLOW_UP_ALERT_PERMISSION = 'money.follow_up' as const
packages/core/src/service/payment-todos.ts:28:export const MAX_TODOS = 2000
packages/core/src/service/permissions.ts:12:export const PERMISSIONS = [
packages/core/src/service/permissions.ts:78:export const DEFAULT_ROLE_KINDS = ['staff', 'manager', 'owner'] as const
packages/core/src/service/pins.ts:15:export const MIN_PIN_PEPPER_LENGTH = 32
packages/core/src/service/read.ts:757:export const TONIGHT_LOG_LIMIT = 200
packages/core/src/service/receipt-rows.ts:13:export const MAX_RECEIPTS = 2000
packages/core/src/service/results.ts:14:export const REFUSAL_CODES = [
packages/core/src/service/send-guards.ts:29:export const DUPLICATE_WINDOW_MINUTES = 15
packages/core/src/service/send-guards.ts:32:export const PACE_WINDOW_MINUTES = 15
packages/core/src/service/send-guards.ts:35:export const GUARD_TRIPPED_CAUSE = 'guard_tripped'
packages/core/src/service/send-guards.ts:38:export const ORDER_PACE_ALERT = 'order_pace'
packages/core/src/service/send-guards.ts:44:export const FIRST_ITEM_READING_MAX_AGE_MS = 2 * 60_000
packages/core/src/service/send-timings.ts:10:export const BEFORE_READ_TRIES = 3
packages/core/src/service/send-timings.ts:11:export const BEFORE_READ_PAUSE_MS = 1_000
packages/core/src/service/send-timings.ts:17:export const AVAILABILITY_READS = 1
packages/core/src/service/send-timings.ts:20:export const READ_BACK_EVERY_MS = 5_000
packages/core/src/service/send-timings.ts:27:export const BUDGET_WAIT_MS = 15_000
packages/core/src/service/send-timings.ts:30:export const LEASE_MARGIN_MS = 15_000
packages/core/src/service/send.ts:61:export const REFERENCE_ALPHABET = 'ACDEFHJKMNPQRTUVWXY34679'
packages/core/src/service/send.ts:76:export const SEND_REFUSALS = [
packages/core/src/service/sent-order-answer.ts:23:export const SENT_ORDER_ANSWERS = ['found', 'not_found'] as const
packages/core/src/service/sent-order.ts:50:export const SLOT_START_SECONDS = SLOT_LEASE.start
packages/core/src/service/sent-order.ts:52:export const SLOT_SENDING_SECONDS = SLOT_LEASE.sending
packages/core/src/service/sent-order.ts:54:export const SLOT_CHECKING_SECONDS = SLOT_LEASE.checking
packages/core/src/service/sent-order.ts:57:export const ORDER_UNCONFIRMED_CAUSE = 'order_unconfirmed'
packages/core/src/service/sent-order.ts:59:export const ORDER_UNCONFIRMED_ALERT = 'order_unconfirmed'
packages/core/src/service/sent-order.ts:69:export const SETTLED_STATES = ['added', 'awaiting_approval', 'not_sent', 'unconfirmed'] as const
packages/core/src/service/sent-order.ts:505:export const SENT_ORDER_COMMANDS = {
packages/core/src/service/service-day-close.ts:127:export const CLEARED_AT_DAY_CLOSE = 'day_close'
packages/core/src/service/sittings.ts:49:export const SITTING_END_REASONS = [
packages/core/src/service/staff.ts:56:export const MAX_REVEALED_PINS = 200
packages/core/src/service/stock.ts:16:export const OUT_OF_STOCK_ALERT = 'item_out_of_stock'
packages/core/src/service/table-codes.ts:18:export const MAX_REVEALED_CODES = 500
packages/core/src/service/undo.ts:23:export const UNDO_REFUSALS = ['undo_expired', 'undo_stale'] as const
packages/core/src/service/undo.ts:26:export const UNDO_ENTRY_KEY = 'undoEntry'
packages/core/src/service/undo.ts:27:export const UNDO_AT_KEY = 'undoAt'
packages/core/src/snapshot/build.ts:61:export const ASSET_VARIANT_WIDTHS = { thumb: 320, card: 640, full: 1280 } as const
packages/core/src/snapshot/diff.ts:36:export const DIFF_AREAS = ['look', 'sections', 'menu', 'languages', 'tags'] as const
packages/core/src/snapshot/schema.ts:24:export const SNAPSHOT_SCHEMA = 'menu-snapshot/1'
packages/core/src/snapshot/schema.ts:30:export const ID_LIKE_PATTERN = new RegExp(`^[a-z]{2}_${ID_BODY}$`)
packages/core/src/snapshot/schema.ts:74:export const SNAPSHOT_FIELD_TYPES = FIELD_TYPE_NAMES.filter(
packages/core/src/snapshot/schema.ts:80:export const SNAPSHOT_ITEM_STATES = ['available', 'sold_out'] as const
packages/core/src/snapshot/schema.ts:83:export const SNAPSHOT_ORDER_MODES = ['orderable', 'ask_waiter'] as const
packages/core/src/snapshot/schema.ts:89:export const SNAPSHOT_MENU_LAYOUTS = ['list', 'one', 'two'] as const
packages/core/src/snapshot/schema.ts:107:export const NEW_BADGE = 'new'
packages/core/src/sync-settings.ts:30:export const INCREMENTAL_MINUTES = [1, 5, 10, 15, 30] as const
packages/core/src/sync-settings.ts:34:export const AFTER_SYNC_MODES = ['auto', 'manual'] as const
packages/core/src/sync-settings.ts:41:export const NEW_ITEMS_MODES = ['show', 'hold'] as const
packages/core/src/sync-settings.ts:45:export const SYNC_MODES = ['auto', 'manual'] as const
packages/core/src/sync-settings.ts:49:export const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
packages/core/src/sync-settings.ts:52:export const SYNC_DEFAULTS = {
packages/core/src/sync-settings.ts:197:export const SYNC_TIME_ZONE_DEFAULT = 'Europe/Sofia'
packages/core/src/sync/absence-hold.ts:14:export const ABSENCE_HOLD_RATIO = 0.3
packages/core/src/sync/absence-hold.ts:17:export const ABSENCE_HOLD_MIN = 5
packages/core/src/sync/conclude-full-pull.ts:12:export const MISSING_TO_DELETED_AFTER_DAYS = 7
packages/core/src/table-order.ts:26:export const ORDER_LIMITS = {
packages/core/src/table-order.ts:38:export const UNDO_WINDOW_MS = 10_000
packages/core/src/table-order.ts:45:export const STAFF_UNDO_WINDOW_MS = 30_000
packages/core/src/table-order.ts:48:export const ORDER_IDLE_MS = 30 * 60_000
packages/core/src/table-order.ts:51:export const ORDER_EDIT_MAX_AGE_MS = 30_000
packages/core/src/table-order.ts:54:export const ORDER_CHANGES_PER_MINUTE = 60
packages/core/src/table-order.ts:112:export const ORDER_EDIT_REFUSALS = [
packages/core/src/tags.ts:23:export const TAG_COLORS = ['accent', 'accent_text', 'muted', 'text', 'border'] as const
packages/core/src/tags.ts:35:export const MAX_TAG_NAME_LENGTH = 40
packages/core/src/tags.ts:38:export const MAX_BULK_TAG_ITEMS = 1000
packages/core/src/template.ts:18:export const RESERVED_FIELD_KEYS = [
packages/core/src/template.ts:33:export const TEMPLATE_KEY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
packages/core/src/templates/venue-menu.ts:12:export const ORDER_MODES = ['orderable', 'ask_waiter', 'hidden'] as const
packages/core/src/templates/venue-menu.ts:22:export const PAYMENT_MODES = ['on_bill', 'pay_first'] as const
packages/core/src/templates/venue-menu.ts:32:export const SECTION_LAYOUTS = ['vertical', 'horizontal'] as const
packages/core/src/theme/contrast.ts:8:export const MIN_TEXT_CONTRAST = 4.5
packages/core/src/theme/contrast.ts:11:export const MIN_CONTROL_CONTRAST = 3
packages/core/src/theme/derive.ts:44:export const PALETTE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
packages/core/src/theme/derive.ts:68:export const FALLBACK_BRAND = '#6b7280'
packages/core/src/theme/fonts.ts:11:export const FONT_KINDS = ['sans', 'serif', 'display'] as const
packages/core/src/theme/fonts.ts:26:export const THEME_FONTS = [
packages/core/src/theme/fonts.ts:39:export const THEME_FONT_IDS = THEME_FONTS.map((font) => font.id) as [ThemeFontId, ...ThemeFontId[]]
packages/core/src/theme/harmony.ts:13:export const HARMONY_RULES = [
packages/core/src/theme/presentation.ts:38:export const MAX_PRESENTATION_OPTIONS = 16
packages/core/src/theme/presentation.ts:58:export const CALL_WAITER_KINDS = [
packages/core/src/theme/presets.ts:14:export const THEME_PRESET_IDS = ['botanical', 'midnight', 'nordic', 'terracotta'] as const
packages/core/src/theme/roles.ts:16:export const ROLE_NAMES = [
packages/core/src/theme/roles.ts:36:export const EXTENDED_ROLE_NAMES = [
packages/core/src/theme/roles.ts:83:export const ROLE_MODES = ['light', 'dark'] as const
packages/core/src/theme/roles.ts:92:export const THEME_SCHEMES = ['auto', 'light', 'dark'] as const
packages/core/src/theme/settings.ts:58:export const THEME_RADIUS = { min: 0, max: 32 } as const
packages/core/src/theme/settings.ts:60:export const THEME_SHADOW = { min: 0, max: 5 } as const
packages/payments/sim-pay/src/env.ts:5:export const SIM_PAY_ENVS = ['development', 'test', 'staging', 'production'] as const
packages/payments/sim-pay/src/notices.ts:14:export const SIM_PAY_SIGNATURE_HEADER = 'sim-pay-signature'
packages/payments/sim-pay/src/provider.ts:21:export const SIM_PAY_KIND = 'sim-pay'
packages/payments/stripe/src/config.ts:7:export const STRIPE_ENVS = ['development', 'test', 'staging', 'production'] as const
packages/payments/stripe/src/mapping.ts:22:export const PAYMENT_METADATA_KEY = 'restro_payment'
packages/payments/stripe/src/provider.ts:66:export const STRIPE_KIND = 'stripe'
packages/payments/stripe/src/provider.ts:73:export const STRIPE_API_VERSION = '2026-09-30.endive'
packages/payments/stripe/src/testing/test-cassette.ts:21:export const STRIPE_API = 'https://api.stripe.com'
packages/payments/stripe/src/testing/test-scrub.ts:13:export const SCRUBBED = 'scrubbed'
```

## Appendix C: timing-like constant definitions outside packages/core/src/timings.ts (154 rows)
Command: `git grep -n -E '(const|export const) [A-Z_]*(_MS|_SECONDS|_MINUTES|_HOURS|_DAYS|_SEC|_MIN|TIMEOUT|INTERVAL|DELAY|TTL|EXPIRE|BACKOFF|WINDOW|GRACE|TICK|RETRY)[A-Z_]* =' -- <five packages>` minus tests and `timings.ts`.
```
apps/web/e2e/guest-pay-first.spec.ts:21:const SETTLED = { timeout: 60_000, intervals: [500, 1_000] }
apps/web/e2e/guest-pay-first.spec.ts:24:const PRICE_MINOR = 1_100
apps/web/e2e/guest-pay.spec.ts:23:const SETTLED = { timeout: 60_000, intervals: [500, 1_000] }
apps/web/e2e/guest-send.spec.ts:27:const SETTLED = { timeout: 60_000 }
apps/web/scripts/register-ts.mjs:8:const RETRY_CODES = new Set(['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'])
apps/web/src/components/admin/deleted-venues-list.tsx:24:const DAY_MS = 24 * 60 * 60 * 1000
apps/web/src/components/admin/menus-card.tsx:78:const DAY_MS = 24 * 60 * 60 * 1000
apps/web/src/components/admin/settings-sections.ts:20:export const SETTINGS_SECTIONS = [
apps/web/src/components/admin/workspace-tab-defs.ts:72:export const SETTINGS_SECTION_DEFS = [
apps/web/src/connectors/signed-notices.ts:16:export const NOTICE_TOLERANCE_SECONDS = 300
apps/web/src/guest/guest-menu.tsx:69:const POINTER_EVERY_MS = 30_000
apps/web/src/guest/guest-menu.tsx:70:const LIVE_EVERY_MS = 15_000
apps/web/src/guest/guest-menu.tsx:71:const CLOCK_EVERY_MS = 60_000
apps/web/src/guest/load.ts:229:export const LIVE_REFETCH_DELAY_MS = 2_000
apps/web/src/guest/services-client.ts:80:export const POLL_BACKOFF_MS = [4_000, 8_000, 16_000, 30_000] as const
apps/web/src/guest/services-client.ts:83:export const OFFLINE_AFTER_MS = 10_000
apps/web/src/guest/services-client.ts:153:const DEFAULT_KEEP_HOURS = 6
apps/web/src/guest/turnstile.ts:10:const TOKEN_TIMEOUT_MS = 15_000
apps/web/src/i18n/actions.ts:8:const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
apps/web/src/integration/live-refresh.tsx:7:export const REFRESH_INTERVAL_MS = 3000
apps/web/src/lib/theme.ts:13:const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365
apps/web/src/publish/use-publisher.ts:28:export const SLOW_AFTER_MS = 45_000
apps/web/src/server/design/service.ts:64:const LINK_SECONDS = 60 * 60
apps/web/src/server/payments-connection.ts:16:const TIMEOUT_MS = 20_000
apps/web/src/server/reveal.ts:66:const TIMEOUT_MS = 5_000
apps/web/src/server/telegram-link.ts:14:const TIMEOUT_MS = 10_000
apps/web/src/server/turnstile.ts:21:const TIMEOUT_MS = 5_000
apps/web/src/settings/alerts-panel.tsx:47:const WATCH_MS = 3_000
apps/web/src/settings/ordering-panel.tsx:37:const DEFAULT_CAP_MINOR = 15_000
apps/web/src/settings/section-notices.tsx:14:const RETRY_MS = 10_000
apps/web/src/settings/staff-people.tsx:54:export const PIN_SHOWN_MS = 30_000
apps/web/src/tonight/live-feed.ts:12:export const FEED_POLL_MS = 5000
apps/web/src/tonight/night-page.tsx:32:const REFRESH_MS = 5000
apps/web/src/tonight/night-slots.ts:13:export const NIGHT_SECTION_ACCESS = {
apps/web/src/tonight/search-field.tsx:12:const FOCUS_MIN_WIDTH = 768
apps/web/src/tonight/tonight-panel.tsx:51:const REFRESH_MS = 5000
apps/worker/src/alerts/deliver.ts:80:const CLOSED_LOOKBACK_MS = 24 * 3_600_000
apps/worker/src/alerts/deliver.ts:82:const RETRY_AFTER_MS = 30_000
apps/worker/src/alerts/push.ts:45:const TTL_SECONDS = 600
apps/worker/src/alerts/telegram-link.ts:16:export const LINK_MINUTES = 15
apps/worker/src/alerts/telegram-link.ts:32:const EPOCH_MS = Date.UTC(2026, 0, 1)
apps/worker/src/alerts/telegram-link.ts:33:const MINUTE_MS = 60_000
apps/worker/src/alerts/telegram-poller.ts:41:export const POLL_SECONDS = 25
apps/worker/src/alerts/telegram.ts:114:const CALL_TIMEOUT_MS = 10_000
apps/worker/src/health.ts:10:export const HEARTBEAT_MAX_AGE_MS = 3 * 60_000
apps/worker/src/jobs/alerts.ts:27:export const PASS_EVERY_MS = 5_000
apps/worker/src/jobs/alerts.ts:29:export const PASS_BUDGET_MS = 55_000
apps/worker/src/jobs/alerts.ts:31:export const PING_TIMEOUT_MS = 10_000
apps/worker/src/jobs/barsy.ts:111:const FULL_PULL_COOLDOWN_MS = 15 * MINUTE
apps/worker/src/jobs/barsy.ts:121:const FULL_PULL_DEFER_SECONDS = 60
apps/worker/src/jobs/barsy.ts:124:const PLACES_RETRY_MS = 10 * MINUTE
apps/worker/src/jobs/floor.ts:61:export const FLOOR_READ_INTERVAL_MS = 5 * MINUTE
apps/worker/src/jobs/payment-recovery.ts:51:export const PAYMENT_STALE_MS = 60_000
apps/worker/src/jobs/payment-recovery.ts:53:export const PAYMENT_STUCK_MS = 10 * 60_000
apps/worker/src/jobs/payment-recovery.ts:55:export const RELEASE_READ_BACK_SECONDS = 10 * 60
apps/worker/src/jobs/payment-recovery.ts:60:export const FINAL_TABLE_READ_SECONDS = 5 * 60
apps/worker/src/jobs/payment-recovery.ts:62:export const RECOVERY_EVERY_MS = 30_000
apps/worker/src/jobs/payments.ts:151:const WAIT_SECONDS = 2
apps/worker/src/jobs/payments.ts:153:const READ_BACK_SECONDS = READ_BACK_EVERY_MS / 1_000
apps/worker/src/jobs/payments.ts:160:export const PAYMENT_RUN_MS = 120_000
apps/worker/src/jobs/payments.ts:163:const PROVIDER_CALL_MS = 20_000
apps/worker/src/jobs/payments.ts:172:export const RECEIPT_SEND_MS =
apps/worker/src/jobs/payments.ts:190:export const PAYMENT_PREPARE_EXPIRE_SECONDS = 6 * 60
apps/worker/src/jobs/provider-notices.ts:62:export const NOTICE_RUN_BUDGET_MS = 45_000
apps/worker/src/jobs/provider-notices.ts:65:export const NOTICE_LATE_MS = 24 * 60 * 60 * 1000
apps/worker/src/jobs/provider-notices.ts:72:export const ACCOUNT_NOTICE_GRACE_MS = 10 * 60 * 1000
apps/worker/src/jobs/purge.ts:614:const DETACHED_SECTIONS = sql`
apps/worker/src/jobs/readings.ts:67:export const TABLE_READ_INTERVAL_MS = 60_000
apps/worker/src/jobs/readings.ts:70:export const TABLE_READ_MIN_GAP_MS = 15_000
apps/worker/src/jobs/service-day.ts:129:export const NIGHT_REPORT_MAX_AGE_DAYS = 2
apps/worker/src/jobs/service-hours.ts:250:const TICK_QUEUE = {
apps/worker/src/jobs/stock.ts:62:export const STOCK_TICK_CRON = '*/5 * * * *'
apps/worker/src/publish/rollover.ts:27:export const REASSERT_AFTER_MS = 10 * 60 * 1000
apps/worker/src/receipts/email-sender.ts:67:export const RECEIPT_CALL_TIMEOUT_MS = 15_000
apps/worker/src/receipts/email-sender.ts:68:const CALL_TIMEOUT_MS = RECEIPT_CALL_TIMEOUT_MS
apps/worker/src/registry.ts:12:const DEAD_LETTER_RETENTION_SECONDS = 30 * 24 * 60 * 60
apps/worker/src/shutdown.ts:18:export const FORCE_EXIT_AFTER_MS = 30_000
apps/worker/src/sync/cursor.ts:9:export const CURSOR_OVERLAP_MINUTES = 65
apps/worker/src/sync/photos.ts:31:export const PHOTO_TIMEOUT_MS = 20_000
apps/worker/src/sync/pull-lock.ts:32:export const PULL_LOCK_WAIT_MS = 60_000
apps/worker/src/sync/pull-lock.ts:34:export const PULL_LOCK_POLL_MS = 2_000
apps/worker/src/worker.ts:47:export const SHUTDOWN_TIMEOUT_MS = 20_000
apps/worker/tests/database.ts:49:export const SETUP_TIMEOUT_MS = 180_000
packages/connectors/sim-pos/src/control/view.ts:13:export const TICKETS_SHOWN = 15
packages/connectors/sim-pos/src/testing/test-harness.ts:22:export const STEP_MS = 200
packages/core/src/connectors/service/testing/checks-write.ts:445:export const KIT_TIP_MINOR = 137
packages/core/src/connectors/service/testing/harness.ts:121:export const KIT_MARGIN_MS = 1_500
packages/core/src/jobs.ts:257:export const AUTO_PUBLISH_DELAY_SECONDS = 30
packages/core/src/location-check.ts:27:export const LOCATE_TIMEOUT_MS = 10_000
packages/core/src/location-check.ts:82:const DAY_END_PRECISION_MS = 1_000
packages/core/src/node-types.ts:45:export const MAX_SECTION_DEPTH = 3
packages/core/src/ordering-settings.ts:71:export const ORDERING_CAP_MAX_MINOR = 1_000_000
packages/core/src/ordering-settings.ts:127:export const LAST_ORDERS_BEFORE_DAY_END_MINUTES = 15
packages/core/src/paying-settings.ts:13:export const CARD_FLOOR_MINOR = 50
packages/core/src/paying-settings.ts:16:export const MIN_CARD_MAX_MINOR = 100_000
packages/core/src/payment-connection.ts:30:export const OWNER_TICKS = ['cardTypeInTill', 'receiptEmailsOff'] as const
packages/core/src/pin-guard.ts:14:export const PIN_GUARD_WINDOW_MS = 5 * 60_000
packages/core/src/pin-guard.ts:18:const FORGET_AFTER_MS = 24 * 60 * 60_000
packages/core/src/purge.ts:19:export const VENUE_BIN_DAYS = 30
packages/core/src/purge.ts:21:export const MENU_BIN_DAYS = 30
packages/core/src/purge.ts:23:export const TABLE_BIN_DAYS = 30
packages/core/src/purge.ts:25:export const INSTANCE_BIN_DAYS = 30
packages/core/src/purge.ts:29:export const VERSION_PURGE_DAYS = 30
packages/core/src/purge.ts:31:export const CHANGE_LOG_DAYS = 61
packages/core/src/purge.ts:33:const DAY_MS = 24 * 60 * 60 * 1000
packages/core/src/resolve/resolve.ts:54:const NEW_BADGE_MS = 14 * 24 * 60 * 60 * 1000
packages/core/src/service-hours.ts:21:export const LAST_ORDERS_NOTICE_MINUTES = 10
packages/core/src/service-hours.ts:61:const MINUTE_MS = 60_000
packages/core/src/service/alert-delivery.ts:22:export const STALE_NEW_MS = 6 * 3_600_000
packages/core/src/service/alert-delivery.ts:25:export const HOLD_LAST_DAY_MS = 24 * 3_600_000
packages/core/src/service/alert-rules.ts:49:export const PAYMENT_HOLD_EXPIRED_KIND = 'payment_hold_expired'
packages/core/src/service/alerts.ts:24:export const PAUSE_RETURN_MS = 10 * 60_000
packages/core/src/service/bill.ts:31:export const FRESH_READING_MS = 15_000
packages/core/src/service/context.ts:171:export const FRESH_SIGN_IN_MINUTES = 15
packages/core/src/service/engine.ts:59:export const SERVICE_LOCK_TIMEOUT = '2s'
packages/core/src/service/engine.ts:61:export const SERVICE_STATEMENT_TIMEOUT = '5s'
packages/core/src/service/guest.ts:93:export const GUEST_POLL_MS = { fast: 2_000, menu: 10_000 } as const
packages/core/src/service/guest.ts:96:const ENDED_SENT_ORDER_MS = 15 * 60_000
packages/core/src/service/guest.ts:99:const ENDED_WAITER_CALL_MS = 5 * 60_000
packages/core/src/service/guest.ts:306:const MEMO_MS = 30_000
packages/core/src/service/guest.ts:1193:const PAYMENT_POLL_MS = 2_000
packages/core/src/service/log.ts:24:export const NIGHT_RETENTION_DAYS = 31
packages/core/src/service/night-payments.ts:253:const DAY_MS = 86_400_000
packages/core/src/service/night-read.ts:1159:export const MAX_EXPORT_DAYS = 600
packages/core/src/service/pauses.ts:41:export const UNCONFIRMED_PAUSE_MS = 15 * 60_000
packages/core/src/service/pay-route.ts:94:export const PAYMENT_WRITE_PAUSE_MS = 1_000
packages/core/src/service/pay-route.ts:110:export const PAYMENT_TURN_SECONDS = paymentTurnSeconds()
packages/core/src/service/pay-route.ts:113:export const PAYMENT_LONG_WAIT_MS = 10_000
packages/core/src/service/pay-route.ts:1308:export const RECEIPT_EMAIL_KEPT_MS = 30 * 60_000
packages/core/src/service/pay.ts:85:export const PAYMENT_CONFIRM_MS = 2 * 60_000
packages/core/src/service/pay.ts:87:export const PAYMENT_SESSION_MS = 10 * 60_000
packages/core/src/service/pay.ts:91:export const PAYMENT_QUEUE_MS = 60_000
packages/core/src/service/send-guards.ts:29:export const DUPLICATE_WINDOW_MINUTES = 15
packages/core/src/service/send-guards.ts:32:export const PACE_WINDOW_MINUTES = 15
packages/core/src/service/send-guards.ts:44:export const FIRST_ITEM_READING_MAX_AGE_MS = 2 * 60_000
packages/core/src/service/sent-order.ts:50:export const SLOT_START_SECONDS = SLOT_LEASE.start
packages/core/src/service/sent-order.ts:52:export const SLOT_SENDING_SECONDS = SLOT_LEASE.sending
packages/core/src/service/sent-order.ts:54:export const SLOT_CHECKING_SECONDS = SLOT_LEASE.checking
packages/core/src/service/sent-order.ts:69:export const SETTLED_STATES = ['added', 'awaiting_approval', 'not_sent', 'unconfirmed'] as const
packages/core/src/sync-schedule.ts:25:const MINUTE_MS = 60_000
packages/core/src/sync-schedule.ts:26:const DAY_MS = 24 * 60 * MINUTE_MS
packages/core/src/sync-settings.ts:30:export const INCREMENTAL_MINUTES = [1, 5, 10, 15, 30] as const
packages/core/src/sync/absence-hold.ts:17:export const ABSENCE_HOLD_MIN = 5
packages/core/src/sync/conclude-full-pull.ts:12:export const MISSING_TO_DELETED_AFTER_DAYS = 7
packages/core/src/sync/conclude-full-pull.ts:14:const DAY_MS = 24 * 60 * 60 * 1000
packages/core/src/table-order.ts:38:export const UNDO_WINDOW_MS = 10_000
packages/core/src/table-order.ts:45:export const STAFF_UNDO_WINDOW_MS = 30_000
packages/core/src/table-order.ts:48:export const ORDER_IDLE_MS = 30 * 60_000
packages/core/src/table-order.ts:51:export const ORDER_EDIT_MAX_AGE_MS = 30_000
packages/core/src/table-order.ts:54:export const ORDER_CHANGES_PER_MINUTE = 60
packages/payments/sim-pay/src/engine.ts:49:const DAY_MS = 86_400_000
packages/payments/sim-pay/src/engine.ts:52:const DISPUTE_DAYS = 14
packages/payments/stripe/src/provider.ts:108:const RECENT_WINDOW_S = 2 * 60 * 60
packages/payments/stripe/src/provider.ts:114:const DEFAULT_TIMEOUT_MS = 20_000
```
