# Audit › Robustness

What breaks when things happen at once, repeat, arrive late or fail halfway. Local only, like the security audit. Run it while no other agent runs tests: load-sensitive loops give false alarms on a busy PC (T75).

1. **Hot spots** (start here, add what the area needs):
   - two managers saving the same venue at once (T52); a sync and a manual edit landing together in `apply()`;
   - publish while a sync runs; publish pointer and published files staying consistent;
   - pg-boss retries and duplicate jobs: is every job idempotent? a worker killed mid-job;
   - a full read with a failed or slow page (rule 6); POS timeouts, errors and partial data (MSW handlers);
   - concurrent reorders and fractional sort keys; purge racing a restore (D83, D90);
   - time: the 07:00 service-day edge, the DST change (25 Oct 2026), venue time zones;
   - money rounding on odd prices (rule 8).
2. **Invariants:** for each hot spot, write the rule that must hold (from the nine rules and the decisions) as one sentence.
3. **One loop per invariant**, tight and red-capable (`diagnosing-bugs` Phase 1 standard): a fast-check property, a concurrency integration test on your own database (many `apply()` calls at once, forced interleavings), MSW fault injection, or pinned time.
4. **A loop that goes red is a bug:** continue in `diagnosing-bugs` from Phase 2.
5. **Keep the loops.** Every loop that holds becomes a test in its package; from then on it is a guardrail (D67).
6. **Report** to `docs/reviews/<yyyy-mm-dd>-robustness.md`: per hot spot the invariant, the loop, the verdict, and the fix proposal where it failed.
