# Audit › Security

An authorised attack on Restro's own app, **on this PC only** (Martin, 10-16): localhost, your own local database, fixtures and the seed. Staging, production, barsy and any third party need Martin's OK each time, and nothing ever writes to a POS.

1. **Threat model first** (one short table in the report):
   - **Assets:** each organisation's venues and menus, owner accounts, the POS credentials and their key, table codes, published guest files, the event log.
   - **Actors:** an anonymous guest, a guest holding a table code, a user of another organisation, a member trying admin or owner actions, a hostile POS response.
   - **Entry points:** server actions, `/t/[token]`, `/api/events`, `/api/health`, sign-in, the published files, worker jobs reading POS data.
2. **Static pass:** built-in `security-review` over the area, plus `pnpm audit` for dependencies.
3. **Tenancy:** with two seeded organisations, call every server action and read path in the area as organisation B against A's ids. RLS must refuse, and the action must refuse before RLS has to. Each gap gets an integration test.
4. **Roles:** every owner-only and admin-only action, tried as a member (delete venue, purge, instance settings, domains).
5. **Inputs:** Zod at every boundary. Fuzz server-action inputs with fast-check; oversized payloads; script and markup in every text a guest sees (POS names, hand-made texts, tags), checked in the rendered guest page.
6. **Tokens, ids, URLs:** table code entropy and tombstones never reused (D83); no POS id or internal field in a snapshot or URL (rule 3); redirects keep to our own hosts (`/t/` with `lang`).
7. **Abuse, locally:** sign-in attempts, `/api/events` floods, very large menus. Measure, don't take the machine down: stop at the first clear signal.
8. **Report** to `docs/reviews/<yyyy-mm-dd>-security.md`: each finding with severity (critical, high, medium, low), a redacted reproduction and a fix proposal. A critical or high finding goes to Martin the moment it is confirmed, not at the end. Fixes become tickets, each with the test that proves the hole is closed.
