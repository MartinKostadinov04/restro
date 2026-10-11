# Brief SH-03: shell rules for roles, features and template options

- **Model:** Sonnet 5.5.
- **Branch:** create `sh/03-shell-rules` from `sh/foundation` yourself, after SH-01 and SH-02 are merged.
- **Task:** T74.
- **Decisions:** D69–D72.
- **Runs in parallel with:** SH-04 (`apps/web` guest side). Stay out of `apps/web`.

## Read first

1. `CLAUDE.md`, and in `docs/tracker.md` the entries D38, D67 and D69–D72.
2. `docs/guides/shell-handoff/visualization-shell.md` §5–7 (R1–R14, the manifest, slots, markers, contract tests).
3. The shell:
   - `packages/shell/src/{build,view-model,context,manifest,palette,strings}.ts`;
   - `packages/shell/testing/{contract,fixtures,html,index}.ts`.
4. The SH-01 merge in core, in `packages/core/src/theme/`:
   - `ROLE_NAMES`, `ThemeRoles`, `validateRoles`, `REQUIRED_PAIRS`, `readableOn`;
   - the snapshot's `theme.roles` / `theme.scheme` / `presentation` / `features`;
   - `GuestFeatures`.
5. The SH-02 merge: `packages/faces/editorial-market` (how it reads `options` today, its filter button) and `packages/shell/src/face-props.ts`.
6. `packages/faces/qr-phone/src/{face,manifest}.tsx`.

## What to build

### 1. R13 Theme, using the published roles

In `build.ts`, `viewTheme`:
- **When `snapshot.theme.roles` exists:** map snake to camel (`on_accent` → `onAccent`, `accent_text` → `accentText`) into `colors` and `colorsDark`.
  - Re-check them with core `validateRoles`. The publisher already refuses unreadable themes, so this is defence in depth.
  - Any failing foreground role is replaced by `readableOn(<its backgrounds>, [role, palette steps…, black/white])`, so R13's guarantee still holds.
- **Otherwise:** today's derivation, unchanged. An old snapshot must give exactly today's theme; pin it with a test.
- **New `ViewTheme.scheme`:** `'auto' | 'light' | 'dark'` = `snapshot.theme.scheme ?? 'auto'`.

### 2. New rule R15 Features (fail-closed), in `features.ts`

Context (`context.ts`) gets:

```ts
capabilities: z.strictObject({
  callWaiter: z.boolean(), bill: z.boolean(), ordering: z.boolean(), pay: z.boolean(),
}).prefault({}) // every field .default(false)
```

The view model gets `ViewModel.features`:

```ts
export const SERVICE_KINDS = ['waiter', 'bill', 'water', 'cutlery', 'terminal', 'other'] as const
export interface ViewFeatures {
  /** Show the filter control: the venue left filters on and the menu has chips. */
  readonly filters: boolean
  /** Call-a-waiter with the request kinds the venue allows, or null. */
  readonly callWaiter: { readonly kinds: readonly ServiceKind[] } | null
  readonly bill: boolean
  /** Ordering controls; also needs today's R11 `ordering.enabled`. */
  readonly ordering: boolean
  readonly pay: boolean
}
```

Rule:

```
features = snapshot.features ?? DEFAULT_GUEST_FEATURES (core)
filters  = features.filters ∧ (view.filters.tags.length + view.filters.dietary.length > 0)
service(x) = venue switched x on ∧ context.capabilities.x ∧ interactive channel ∧ context.tableToken !== null
callWaiter = service(callWaiter) ∧ kinds.length > 0 ? { kinds } : null
ordering   = service(ordering) ∧ view.ordering.enabled
```

- R11 (`order.controls`, `ordering.enabled`) is **unchanged**.
- Document R15 in the file header in the style of the other rules.

### 3. Manifest (`manifest.ts`)

Add to `FaceManifestSchema`:
- `features`: an array of `'filters' | 'call_waiter' | 'bill' | 'ordering' | 'pay'`, no repeats, default `[]`;
- `options`: a record from `^[a-z][A-Za-z0-9]{0,31}$` to one of:
  - `{ type: 'enum', values: string[] (1–8, each ^[a-z0-9_-]{1,32}$), default: string, group: 'feature' | 'look', label: { bg, en } }`;
  - `{ type: 'boolean', default: boolean, group, label: { bg, en } }`.

  At most 16 options; default `{}`.

New issues in `validateManifest`:
- `option_default_not_allowed`;
- `ordering_feature_without_ordering`: `features` has `ordering` but `ordering` is false;
- `duplicate_feature`.

New helper:

```ts
/** The face's options with defaults: unknown keys dropped, wrong types or values replaced by the default. */
export function resolveOptions(manifest: FaceManifest, raw: unknown): Readonly<Record<string, string | boolean>>
```

**Manifests:**
- `editorial-market` declares:
  - `options`:
    - `layout` (enum `list | one | two`, default `two`, group `look`, BG/EN labels);
    - `featureFirstSection` (boolean, default true, `look`);
    - `layoutSwitch` (boolean, default true, `feature`);
  - `features: ['filters']`. SH-06 adds the services.
- `qr-phone` declares `features: ['filters']` and no options.

### 4. Faces use the shell

- **editorial-market:** replace its own option defaults with `resolveOptions(EDITORIAL_MARKET_MANIFEST, props.options)`. Its filter button only renders when `view.features.filters` is true, and carries `data-slot="menu.filters"`.
- **qr-phone:** its filter chips render only when `view.features.filters` is true, and their wrapper carries `data-slot="menu.filters"`.

### 5. Contract harness (`packages/shell/testing/`)

- **New `css.ts`:** `assertThemeOnlyCss(css: string): string[]` returns the offending tokens. It flags hex colours, `rgb(`/`rgba(`/`hsl(`/`hsla(`/`hwb(`/`lab(`/`lch(`/`oklch(`/`oklab(` with literal numbers, and the CSS named colours (the full list).
  - **Allowed:** `transparent`, `currentColor`, `inherit`, `initial`, `unset`, CSS system colours (`Canvas`, `CanvasText`, `GrayText`, …), and `color-mix()` whose arguments are all variables or allowed keywords.
  - Unit-test it on good and bad samples.
- **Menu-level slot names** the harness knows: `menu.filters`, `menu.call_waiter`, `menu.bill`, `menu.bag`, `menu.pay`.
- **New contract checks in `runFaceContract`:**
  - for every feature slot: when its view-model feature is off, no element with that `data-slot` exists (**fail-closed**);
  - when the manifest declares the feature and the view turns it on, the slot exists.
- **New fixtures in `fixtures.ts`:**
  - `custom-roles`: a snapshot with `theme.roles` and `scheme: 'dark'`;
  - `features-on`: `snapshot.features` all on, context capabilities all on, a table token and ordering enabled;
  - `features-off`: filters off while chips exist.

  Each needs a short "hard case" description, as the existing ten have.
- **New `faceContractSuite(name, { manifest, render, css })`** in `testing/index.ts`, a helper every face's test calls. It covers:
  - `validateManifest(manifest).ok`;
  - `runFaceContract(render, manifest)` with zero failures on every fixture;
  - `assertThemeOnlyCss(css)` empty.

  Use it in both faces' tests. SH-04's registry test calls it for every registered face.

## Tests

- **R13:**
  - published roles are used;
  - a failing role is repaired;
  - an old snapshot gives today's colours exactly.
- **`scheme`** passes through.
- **R15:**
  - unit tests per clause;
  - a **fast-check property**: for any snapshot features, any capabilities and any context, no service feature is on without its capability, on a non-interactive channel, or without a table token. `filters` is never on without chips.
- **Manifest:**
  - the new issues;
  - `resolveOptions` (unknown key, wrong type, value not in the enum, missing → default).
- **Harness:** the new checks catch a bad face (a test face that draws `menu.bill` while `bill` is off must fail).
- **Both faces pass `faceContractSuite`.**

## Done when

- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass with DB tests on `restro_sh_03` (54329).
- **Vendor words:** the test stays green.
- **Report:** in the CLAUDE.md format.

## Never / scope

- **Out of scope:**
  - `apps/web` (SH-04 works there now);
  - `packages/core` beyond reading its exports (if core lacks something, stop and ask);
  - the service screens (SH-06).
- **No new dependencies.**
- **Guardrails only tighten.** The existing ten fixtures and checks stay as they are; you only add.
- **Never** read `.env.local`.
- **Files:** LF.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
