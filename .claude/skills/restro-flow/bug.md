# Bug

Something is broken, throwing, wrong, slow or flaky. Ends in `ship.md`.

1. **Reported by someone else** (a pilot venue, an issue Martin didn't write)? `triage` first.
2. **Easy or hard?**
   - **Easy:** cause visible, one place to fix → `tdd`: regression test red, fix, green. The lead confirms the seam.
   - **Hard:** resists a first look, intermittent, or a regression between two known-good states → `diagnosing-bugs`, as written.
3. **Known slow tests** (T75) count as a bug only when they fail run alone.
4. **No correct seam** for the regression test is itself the finding: note it in the report and add an `improve-codebase-architecture` candidate (`upkeep.md`).
5. **Data or worker bugs:** reproduce on your own local database; redact logs and artifacts before showing them. Reading staging or production logs needs Martin's OK; writing there never happens from this flow.
6. **Ship:** `ship.md`, with the confirmed cause in the commit message. A hard bug gets `retro` in the same session; an easy one gets one line in the report: what check would have caught it.
