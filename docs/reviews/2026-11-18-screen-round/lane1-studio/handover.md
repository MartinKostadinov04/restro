# Lane 1 (Studio) hand-over

Updated 2026-11-19.

## Done
- Environment: database `restro_lane1` recreated, migrated, roles, `db:seed:dev`, `db:seed:demo` (bills skipped: no BILL_ID_KEY; not needed for Studio). `.env.local` adds a local STAFF_PIN_PEPPER. Web on `http://lane1.localhost:3110` (launch entry `lane1-web`, local only), worker (health 8111), sim-pos `club-biad` on 4710.
- Venues: Demo Club Sofia (hand-made), Demo Bar (POS, sim on 4010 by seed design), Club Biad Sofia (POS, has a manager account).
- Pane signed in as owner@demo-club.test.
- Code check (Fable, done: `code-check.md`) and security check (Fable, done: `security-check.md`).
- Fable explorer hit the limit mid-walk (no output kept). Brief now says no Fable (Martin 11-19): a Sonnet explorer was restarted. Worker needs `.env.worker.local` (copied from E:\Restro, ignored).

## Next
1. Save the three outputs to `findings.md` here.
2. Manager walk on Club Biad Sofia (sign in as manager@club-biad.test), resume the explorer with its "Manager checks to walk" list.
3. Reset the database, sign in again, run the Opus reviewer (step 4) blind with only this ledger path and the commit.
4. Fix PR(s) into `sr/foundation`, the three PR reviews, re-check pass, final report.
