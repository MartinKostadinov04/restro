# Brief SH-06: service screens (bag, bill, call a waiter, pay, receipt) and the services contract

- **Model:** Sonnet 5.5.
- **Branch:** create `sh/06-services` from `sh/foundation` yourself, after SH-03 and SH-04 are merged.
- **Task:** T74.
- **Decisions:** D71 (port the screens now; guests see them only when the platform supports them) and D72 (faces stay pure: no local success).
- **Runs in parallel with:** SH-05a (`apps/web/src/design/**`) and SH-05b (the composer panel). Do not touch `apps/web` except the dependency-cruiser rule named below.

## Read first

1. `CLAUDE.md`, and in `docs/tracker.md` the entries D12, D18, D29, D38, D39, D71 and D72.
2. The designer's handover `docs/design/faces/editorial-market/2026-10-11/handover.md`:
   - §2 "Ordering";
   - §4 connection points;
   - §9 the two-way contract, including the **"Current blocker"** paragraph;
   - §12–13 the capability panel, the reliability rules and the acceptance scenarios.
3. The delivered screens `source/ordering/{ui.tsx, logic.ts, strings.ts, demo.ts}` and `source/_tests/restro-ordering.test.ts`.
4. The review's Stage 4 design `docs/reviews/connector-architecture/A5-guest-outbound.md` §5.1. Your types must fit it later: commands with our own ids and an idempotency key, and the guest view of an order (received / sent / problem).
5. The face as merged: `packages/faces/editorial-market/src/*`, including how SH-03 wired `view.features`, `resolveOptions` and the `menu.*` feature slots.
6. The shell:
   - `packages/shell/src/{view-model,features,face-props,money,strings}.ts`;
   - `packages/shell/testing/{contract,fixtures}.ts` (the `features-on` fixture, the feature-slot checks).
7. Core money: `packages/core/src/money.ts` (`addMinor`, `formatMoney`) and its property tests.

## The contract (implement exactly; types and Zod in `packages/shell/src/services.ts`, exported from the shell)

```ts
export const PAY_SCOPES = ['full', 'split', 'mine'] as const
export const PAY_METHODS = ['apple', 'google', 'card', 'waiter'] as const

/** One guest action. `actionId` is a uuid made once per user action and reused on retry (idempotency). */
export type GuestCommand =
  | { kind: 'order.send'; actionId: string; lines: { itemId: NodeId; optionIds: NodeId[]; qty: number; note: string }[] }
  | { kind: 'service.request'; actionId: string; request: ServiceKind; note: string }
  | { kind: 'service.cancel'; actionId: string; requestId: string }
  | { kind: 'pay.quote'; actionId: string; scope: PayScope; people: number | null; tipPercent: number | null; tipMinor: number | null; promo: string | null }
  | { kind: 'pay.start'; actionId: string; quoteId: string; method: PayMethod }
  | { kind: 'receipt.action'; actionId: string; receiptId: string; action: 'pdf' | 'email' | 'print' }
export const GuestCommandSchema // strict; qty 1–50, ≤ 50 lines, ≤ 32 options, note ≤ 200 chars, promo ≤ 32, people 2–20, tipPercent 0–30

export interface CommandResult {
  readonly actionId: string
  readonly status: 'pending' | 'accepted' | 'rejected'
  /** What to tell the guest (rejection reason, "ask your waiter"), in a language. */
  readonly message: ViewText | null
  /** A short reference to show the guest (e.g. for staff), or null. */
  readonly ref: string | null
}

export interface BillLineView { id: string; name: ViewText; qty: number; total: ViewMoney; status: 'received' | 'preparing' | 'served' | 'cancelled'; options: readonly ViewText[] }
export interface BillRoundView { id: string; origin: 'guest' | 'staff'; time: string; actionId: string | null; lines: readonly BillLineView[] }
export interface BillView { revision: number; rounds: readonly BillRoundView[]; total: ViewMoney; updatedAt: string }
export interface RequestView { id: string; actionId: string; kind: ServiceKind; status: 'sent' | 'accepted' | 'on_the_way' | 'done' | 'cancelled' | 'rejected'; note: string }
export interface PayQuote {
  id: string; scope: PayScope; people: number | null
  subtotal: ViewMoney; tipOptions: readonly { percent: number; amount: ViewMoney }[]; tip: ViewMoney
  vat: readonly { rate: string; amount: ViewMoney }[]; total: ViewMoney
  methods: readonly PayMethod[]; promo: { code: string; accepted: boolean; message: ViewText | null } | null
}
export interface ReceiptView {
  id: string; reference: string; fiscalReference: string | null; venueName: string; tableLabel: string | null
  issuedAt: string; lines: readonly BillLineView[]; vat: PayQuote['vat']; tip: ViewMoney; total: ViewMoney
  method: PayMethod; actions: { pdf: boolean; email: boolean; print: boolean }
}
export interface ServiceState {
  readonly revision: number
  /** True in the admin's preview with demo data: the face shows a small "Preview" marker. */
  readonly preview: boolean
  readonly bill: BillView | null
  readonly requests: readonly RequestView[]
  readonly quote: PayQuote | null
  readonly receipt: ReceiptView | null
}
export interface ServiceBinding {
  readonly state: ServiceState
  readonly dispatch: (command: GuestCommand) => Promise<CommandResult>
}
```

- `FaceHostProps` (`face-props.ts`) gains `services?: ServiceBinding`.
- **Every amount the face shows comes from the host as `ViewMoney`,** except the bag estimate below.

## What to build

### 1. The bag estimate (`packages/shell/src/bag.ts`, pure)

- **Types and reducer:** `BagLine { key, itemId, qty, optionIds, note }` and `bagReducer`, ported from `logic.ts`. A line keeps **no name and no price**: both are looked up from the current view when drawn. A line whose item or option left the view (or is no longer `order.controls`) is flagged unavailable, and sending is blocked until it is removed (handover open question 7).
- **`bagEstimate(view, lines) → { count, total: ViewMoney }`:** computed with core money only. Sum the unit price and the option deltas, times qty.
- **Labels:** the face labels the total as an estimate ("approx.") until a quote exists.
- **Selection helpers:** port `groupValid`, `selectionValid`, `toggleOption`, `needsChoices`.
- **Delete `orderable()`:** R11 already decides, in `item.order.controls`.

### 2. Core money (`packages/core/src/money.ts`)

- Add `multiplyMinor(minor, factor)`: integer and exact, throwing past safe integers like `addMinor`.
- Add `percentOfMinor(minor, percent)`: rounds half-up, used only by the demo adapter.
- fast-check property tests for both.
- No float maths anywhere (rule 8).

### 3. The screens (`packages/faces/editorial-market/src/services/**`)

Port the look and the flows of `ui.tsx` into readable components:
- `provider.tsx`;
- `quick-add.tsx`;
- `dish-order.tsx` (choices, note, quantity);
- `bag-bar.tsx`, `bag-sheet.tsx`;
- `bill-sheet.tsx` (from "tab");
- `call-sheet.tsx`;
- `pay-sheet.tsx`;
- `receipt-page.tsx`;
- `services-css.ts` (`SERVICES_CSS`, theme-only).

Keep the hash sheets (`#bag`, `#tab`, `#call`, `#pay`, `#receipt`) and the phone back button.

**Where the CSS is** (SH-02 found this):
- The delivery's `ORDER_CSS` (in `ordering/ui.tsx`) mixes browsing rules and ordering rules. SH-02 already moved the browsing rules (layouts, layout switch, language switch, header tools, overlay animation) into `css.ts`. Port only the `ro-*` rules into `SERVICES_CSS`.
- The face keeps a 110–120 px bottom padding for the bag bar. Apply it only while a service bar is shown, so a browsing-only page has no empty band.
- The page reuses `Overlay` (`overlay.tsx`) and the `use-dish-route.ts` hash handling. Extend them rather than writing a second dialog.

**Show a control only when all of these hold:**
- its `view.features.*` is on;
- `services` is bound;
- for quick add and Add-to-bag, also `item.order.controls` (R11).

**Feature slots** (fail-closed, checked by the contract):
- `data-slot="menu.bag"` on the bag bar;
- `menu.bill` on the bill button;
- `menu.call_waiter` on the waiter button;
- `menu.pay` on the pay entry.

**No local success (D72); each is a test:**
- **Send:**
  - `dispatch(order.send)` → show pending.
  - `accepted` → clear the bag and open the bill.
  - `rejected` → keep the bag, show `message`.
  - A thrown error or timeout → keep the bag, show the generic failure, allow retry **with the same `actionId`**.
- **Bill:** draw only `state.bill`. Never append rounds locally. A guest round shows once even when the state echoes it (match by `actionId`).
- **Call a waiter:**
  - show only the kinds in `view.features.callWaiter.kinds`;
  - "on the way" only when the matching `RequestView.status` says so;
  - cancel sends `service.cancel`.
- **Pay:**
  - scope, people and tip changes send `pay.quote`, and the screen shows `state.quote`;
  - methods are only `quote.methods`;
  - "Paid" only after an accepted `pay.start` **and** a `state.receipt`;
  - every `await` sits in try/catch/finally, so the processing state always clears;
  - the promo field is shown only when the quote has a `promo` slot (accepted or not).
- **Receipt:** draw only `state.receipt`. The PDF, email and print buttons appear only when its `actions` allow them, and send `receipt.action`.
- **Preview marker:** `state.preview` true shows a small "Preview" label (BG "Преглед") on every service sheet.

**Strings and assets:**
- **Strings:** all from the shell. Add `ServiceStrings` to `strings.ts` under `stringsFor(locale).services`, BG and EN, taken from `source/ordering/strings.ts` (keep the wording), plus the new states (pending, rejected, failed, estimate).
- **Icons:** inline SVG for every lucide icon `ui.tsx` uses. No library.
- **CSS:** theme tokens only; `assertThemeOnlyCss(SERVICES_CSS)` is empty.

### 4. Manifest

- `ordering: true`.
- `features: ['filters', 'call_waiter', 'bill', 'ordering', 'pay']`.

The contract must stay green on every fixture:
- **Features off (default fixtures):** no service slot.
- **`features-on`:** the slots exist. The face's contract render binds a stub (next item).

### 5. Testing stub (`packages/shell/testing/services.ts`)

`stubServices(): ServiceBinding`: an empty state, and `dispatch` answers `pending`. Use it in the face's contract render (`faceContractSuite`).

SH-04 (the registry) runs in parallel with you. If its registry test (`apps/web/src/faces/registry.test.ts`) is not in your base, do not create it: the lead binds the stub there when merging.

**Two files you share with SH-04:** both add a rule to `.dependency-cruiser.cjs` and `scripts/depcruise-rules.test.ts`. Add yours as a separate, clearly commented block, so the merge stays simple.

### 6. Demo adapter (`packages/faces/editorial-market/src/preview/demo-services.ts`)

- Export it as the subpath `@restro/editorial-market/preview`.
- **`useDemoServices(view): ServiceBinding`** keeps its own state:
  - `preview: true`;
  - accepts sends after ~800 ms as a guest round;
  - adds one staff round at start;
  - moves line statuses received → preparing → served on a timer;
  - answers waiter requests sent → on_the_way;
  - quotes with `percentOfMinor`/`addMinor` and `formatMoney`, VAT 20% as a demo constant;
  - accepts `pay.start` with a demo receipt.
- **Admin-only:** the lead wires it into the Design tab's preview later.

**New dependency-cruiser rule:** `apps/web/src/guest/**` and `apps/web/app/m/**` must never import any face's `/preview` subpath. Add the proving case to `scripts/depcruise-rules.test.ts`. This is the only `apps/web`/root file you edit.

## Tests

**Shell (`bag.test.ts`, `services.test.ts`):**
- the reducer;
- the estimate equals core money arithmetic (property);
- an unavailable line blocks sending;
- every command passes `GuestCommandSchema`, and bad ones fail.

**Face, jsdom (`services/*.test.tsx`), with a fake binding:**
1. With features off or `services` unbound: no quick add, no bag bar, no waiter, bill or pay buttons.
2. `order.controls` false: no quick add on that item, even with ordering on.
3. Send:
   - pending → accepted clears the bag;
   - rejected keeps it and shows the message;
   - a thrown error keeps it, and the retry reuses the `actionId`.
4. The bill shows only the state's rounds; an echoed guest round appears once.
5. Waiter: only allowed kinds; "on the way" only after the state says so; cancel sends `service.cancel`.
6. Pay:
   - methods only from the quote;
   - a failure never shows "Paid";
   - "Paid" needs an accepted `pay.start` and a receipt;
   - the processing state clears after a throw.
7. The preview marker shows when `state.preview` is true.
8. Escape, focus return and 44 px targets on every sheet (assert the CSS min sizes).

**Contract and registry:** `faceContractSuite` (with the stub) passes on all fixtures.

## Done when

- **Gate:** `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build && pnpm test:e2e` pass with DB tests on `restro_sh_06` (54329).
- **Vendor words:** the test stays green.
- **Report:** in the CLAUDE.md format, plus a table "handover behaviour → what the port does now", covering the §9 blocker and each §13 rule.

## Never / scope

- **No backend:**
  - no order API, outbox, payment provider, barsy call or barsy write;
  - no `apps/web` routes or actions.

  The guest page does not bind `services` in Stage 3, and nothing in it may.
- **Dependencies:** none new.
- **Guardrails only tighten.**
- **Never** read `.env.local`.
- **Files:** LF.
- **Git:** commit as you go (`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`); never push.
