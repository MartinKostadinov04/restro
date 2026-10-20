# How a venue pause lifts: an independent opinion on designs A and B

Made by: independent agent (Opus), 10-21

## 1. Framing

A venue pause is a safety switch (a circuit breaker). Library breakers (Hystrix, Polly, Resilience4j) test recovery with real requests (the "half-open" state). Restro cannot: a failed real order costs too much. So Restro's breaker is closer to a load balancer's health check (AWS ELB, Kubernetes probes): a cheap test call on a timer, quick to stop and slow to restart (hysteresis). Both designs work this way. They differ in what the pause covers, probe spacing, how many good probes lift it, and what happens just after.

## 2. How each behaves

"Back after" means time from the POS working again to "Ordering is back".

| Scenario | Design A | Design B |
|---|---|---|
| POS down for 1 hour | Pauses at 60 s. About 35 probes an hour. Back after up to about 6 min (3 probes, 120 s apart). | Pauses at 60 s. 120 probes an hour. Back after 30–60 s. |
| POS flaps (1 min on, 1 min off) | Three good probes 30–120 s apart rarely fit in one good minute, so it mostly stays paused. If it lifts, the 5-min watch re-pauses on the next failure; the third pause holds 10 min and alerts the team. Guests see 0–2 flips. | Two probes 30 s apart fit in a good minute, so it lifts each time. It re-pauses only after 60 s with no good call or 3 Unconfirmed. Flips every 2–4 min until a person holds it. |
| Slow POS (answers in 5–15 s) | Probes "succeed", so it lifts; orders then time out and end Unconfirmed; re-pause. | Same, without the quick re-pause. |
| One bar's login refused, others fine | The whole venue pauses, or (if refusal is counted per login) nothing pauses and that bar's orders fail. | Only that login pauses. Other bars keep ordering. |
| Venue internet drops for 20 s | No pause. Orders in flight go to Checking and mostly resolve once the line is back. | Same. |
| Unconfirmed orders in bad moments | At most about one per flap, thanks to the 5-min watch. | Several per flap cycle (capped by the shared "3 in 10 min" rule). |
| Load on a recovering POS | Light probes; no rule for the backlog of waiting guests. | Light probes; everything resumes at once. |
| Build and test | More rules (watch window, escalation, refusal schedule, jitter). All timer logic, testable with a fake clock. | Fewer rules, but per-login state and "venue paused when all are". |

## 3. Strengths and risks

**Design A.**
- Strong on flapping. The 5-min watch (probation) and the longer third pause are proven practice: Envoy's outlier detection lengthens each repeat ejection (30 s × count, capped at 300 s). Nobody has to watch the club at 3 a.m.
- Gentle on a refused login. Many systems lock an account after repeated failed logins; Mistral's rule is unknown.
- Risk: slow recovery. Three probes up to 120 s apart can leave a working POS idle for 6 minutes on a Saturday night.
- Risk: one venue-wide state. One broken bar login stops four bars.

**Design B.**
- Strong on scope. Per-login state is the bulkhead pattern: one failure stays in its compartment.
- Fast recovery (30–60 s).
- Right that checks of sent orders and payment undo steps must continue while paused. Any design needs this.
- Risk: weak on flapping. Lifting after 2 probes with no probation is a breaker without memory. Each lift sends the waiting guests' backlog into a POS that may fail again: that is where Unconfirmed orders come from. "Held by hand" fails at night.
- Risk: probing a refused login every 30 s may get the account locked.

**Both** count a slow answer as good. Resilience4j has a separate "slow call" threshold for this reason: a probe answering in 9 s says little about an order write that times out at 10 s.

## 4. Recommendation: A's lift rules, B's scope, plus three fixes

1. **Scope (from B).** Keep one pause state per POS connection (per login). A table can order only if the connection its orders use is open. The guest page shows "paused" at a table whose connection is paused. The venue-wide banner shows when all connections are paused. With one login, this is identical to A.
2. **Minimum pause: 60 s** (Resilience4j's default open wait; long enough for a router or POS restart).
3. **Probe.** One cheap read, with the same login and the same path as an order write. It counts as **good only if it answers correctly within 3 s** (about a third of the order-write timeout; keep that ratio if the timeout changes).
4. **Probe spacing while failing:** 15 s, 30 s, then every **60 s**, each ±20% random (jitter). Not 120 s: AWS's backoff advice protects a server from many clients, but Restro is one caller and probe load is tiny. Shorter gaps buy faster recovery for free.
5. **After a refused login:** 60 s, 2 min, then every 5 min. Also probe at once when the login is changed or the Restro team presses "check now".
6. **Lifting:** once a probe is good, probe every **15 s**. Lift after **3 good probes in a row** (the good run spans 30 s). One bad probe goes back to step 4. After a long outage, ordering is back within about 90 s.
7. **Five-minute watch after lifting (from A).** Keep probing every 15 s. Re-pause at once on **1 Unconfirmed order or 2 failed calls in a row** (in a row, so one random blip does not trip it). During the watch, allow **one order write in flight per connection**; other orders wait as Waiting. Restart display reads spread over 30 s. This is the "slow start" the Google SRE book recommends for a recovering backend.
8. **Instability rule (from A).** The **third automatic pause within 30 minutes holds at least 10 minutes** and alerts the Restro team. The count resets after 30 minutes with no automatic pause.
9. **During a pause (from B).** Checks of sent orders and payment undo steps keep running, with their own backoff (every 30 s, up to 2 min). Display reads stop. A successful check counts as a good probe.
10. **Build it as one pure function:** state plus event plus time gives the new state plus actions. Inject the clock and the random source. Every row of the table in section 2 becomes a test with a fake clock.

Flapping under this design: pause, lift, re-pause within about 30 s of the next failure, lift, then the third pause holds 10 minutes. Guests see "back" at most twice in 30 minutes. At most about one Unconfirmed order per cycle, because only one order is in flight during the watch.

## 5. What I am unsure of

- **Mistral's API.** Is there a cheap authenticated read? Does it answer from a cloud relay while the venue PC is offline? Then a good probe would lie; the probe must reach the venue's own POS.
- **Account lockout** after failed logins. Step 5 assumes Mistral might.
- **Order-to-login routing.** If one order can need two bar logins, a table is open only when both are. If routing is unknown at launch, treat the venue as one connection.
- **The 3 s "good" limit** depends on the order-write timeout, which I have not seen. A POS that is always slow but working (say 4 s) would stay paused; the team alert would show this.
- **The 60 s trip (shared rule).** Most Unconfirmed orders will come from the first minute of an outage, before any pause, not from the lift. Outside this question, but worth a look: after one order write times out, hold the next order until a probe succeeds.
