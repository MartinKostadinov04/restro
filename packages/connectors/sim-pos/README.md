# @restro/sim-pos

The simulated POS (#68, #51 design §2): what the platform's ordering and payment code is built and tested against before any real POS is wired. It claims nothing about any real POS: the facts of D122 §1 are built in, everything else is a switch, and anything neither defines throws `UndefinedBehaviour` (HTTP 501 on the wire), so no test passes on a friendly guess.

Four parts:

- **The engine** (`src/engine`): a pure state machine with an injected clock and a seeded random source, and no I/O. It answers POS-shaped calls for outside apps (`engine.call`) and offers the waiter's side (`engine.waiter.*`). Its whole state is one JSON object (`snapshot`, `load`, `digest`).
- **The switches** (`src/switches.ts`): every behaviour the facts don't fix, each starting on its cautious answer, each citing its open question (Q-number). Two profiles: `cautious` and `pilot` (cautious plus moving rows and closing with a payment type). Both keep `tipAsLine` off (Q41 is open); switched on, and given the tip article (`tipItem`), the connector declares `recordTipOnClose` and closes a tip as one row of that article on the same bill (D127).
- **The wire** (`src/wire`): POS-shaped HTTP over the engine. Ids of every shape, number-shaped ones as JSON numbers; money as JSON floats (or decimal text); Basic authentication; paged lists with a stated count.
- **The connector** (`src/connector.ts`): the `ServiceConnector` of `@restro/core` over the wire, declaring what the switches allow. Writes only through `src/write` (D110, declared in `src/waiter-actions.ts`).

`@restro/sim-pos/testing` (tests only) puts the engine behind the connector in process or through MSW handlers, and builds the conformance kit's harness (`simPosHarness`).

Faults (`engine.faults`) are deterministic rules (from the n-th call of a method, n times) or seeded chaos, which prints its seed so a run can be replayed. The kinds: hang, lands then hangs, lands partly, lands late, fail, a dropped list item, a forced refusal, a slow answer, a login going offline, a waiter's round slipping in (identical or not), a waiter voiding a row or closing the bill, and a close with no receipt.

## Running it (#71)

```
pnpm sim:serve [--scenario quiet-night] [--port 4010] [--host 127.0.0.1]
```

starts the standalone server (plain Node `http`, no dependency): the POS-shaped wire at `/api/`, the control page at `/control` and its data calls under `/control/api/`, nothing else. With `SIM_POS_CONTROL_TOKEN` set, the control calls need it (header `x-sim-token`; the page asks for it and keeps it in the tab). Without a token the server listens on this machine only and refuses any other host. It holds no data of Restro or of a guest.

**The control page** is the simulated POS's own screen, not an admin screen: the printed tickets per bar, every table with its bill and rows, the call log, and a form for every waiter operation of #51 §2.5.

**The CLI** acts as a waiter on a running server (its state lives in that process):

```
pnpm sim-pos waiter add-round --table 7 --items 2001:2,2502
pnpm sim-pos waiter close-bill --table 7 --kind card
pnpm sim-pos scenario busy-friday     # load a scenario on the running server
pnpm sim-pos scenarios                # the scenario files
pnpm sim-pos ops                      # the waiter operations
```

Tables are named by number (`7`) or by the POS's own id. `SIM_POS_URL` (default `http://127.0.0.1:4010`) and `SIM_POS_CONTROL_TOKEN` tell the CLI where the server is and what token to send.

**Scenario files** (`scenarios/*.json`, loaded by name; `demo-bar` is the base the others extend):

- `quiet-night` (the default): Table 7 is open with Maria's 46.00 EUR bill, no faults.
- `busy-friday`: every table has a bill, one with half a portion and one with a bill-level charge; seeded chaos draws a slow answer, a failed call or a dropped list item on about one call in twenty, and prints its seed so a run can be replayed.
- `payment-trouble`: a waiter's round slips into a move, a close prints no receipt, a line is voided after the guest confirmed, a bill is locked on a terminal.
- `tip-on-close`: Table 7's 46.00 EUR bill on a POS that takes a tip as one row of its Tip article (`tipAsLine`), so a guest's tip lands on the same bill and receipt (D127).
- `pay-first`: Demo Bar with no open bills on a POS whose first items open a bill (`firstItemsOpenBill`) and whose notes reach the ticket (`notesReachTicket`): a guest pays a pay-first round at Send and Restro enters it on a free payment table (#113).

A file holds the floor, catalogue, logins and open bills, the profile and switches, the faults, a `setup` list of waiter operations, and, for the dev seed, the `menu` the venue's owner would have made. Demo Bar runs the `pilot` profile with the bars read (`readsTableBar`) and one login for every bar (`oneLoginPerBar` off), so the floor reading sees both bars.

The worker's `floor-read` job reads a venue's floor from this server, and the dev seed (`pnpm db:seed:dev`) writes Demo Bar's menu through `apply()` from the same scenario file; `SEED_DEMO_MENU=0` skips Demo Bar. The worker refuses a `sim` instance in production, and the admin's systems picker hides the kind there.
