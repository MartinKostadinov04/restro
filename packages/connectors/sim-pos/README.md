# @restro/sim-pos

The simulated POS (#68, #51 design §2): what the platform's ordering and payment code is built and tested against before any real POS is wired. It claims nothing about any real POS: the facts of D122 §1 are built in, everything else is a switch, and anything neither defines throws `UndefinedBehaviour` (HTTP 501 on the wire), so no test passes on a friendly guess.

Four parts:

- **The engine** (`src/engine`): a pure state machine with an injected clock and a seeded random source, and no I/O. It answers POS-shaped calls for outside apps (`engine.call`) and offers the waiter's side (`engine.waiter.*`). Its whole state is one JSON object (`snapshot`, `load`, `digest`).
- **The switches** (`src/switches.ts`): every behaviour the facts don't fix, each starting on its cautious answer, each citing its open question (Q-number). Two profiles: `cautious` and `pilot` (cautious plus moving rows and closing with a payment type).
- **The wire** (`src/wire`): POS-shaped HTTP over the engine. Ids of every shape, number-shaped ones as JSON numbers; money as JSON floats (or decimal text); Basic authentication; paged lists with a stated count.
- **The connector** (`src/connector.ts`): the `ServiceConnector` of `@restro/core` over the wire, declaring what the switches allow. Writes only through `src/write` (D110, declared in `src/waiter-actions.ts`).

`@restro/sim-pos/testing` (tests only) puts the engine behind the connector in process or through MSW handlers, and builds the conformance kit's harness (`simPosHarness`).

Faults (`engine.faults`) are deterministic rules (from the n-th call of a method, n times) or seeded chaos, which prints its seed so a run can be replayed. The kinds: hang, lands then hangs, lands partly, lands late, fail, a dropped list item, a forced refusal, a slow answer, a login going offline, a waiter's round slipping in (identical or not), a waiter voiding a row or closing the bill, and a close with no receipt.

The simulator's server, CLI and control page are #71's.
