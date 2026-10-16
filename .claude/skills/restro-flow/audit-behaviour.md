# Audit › Behaviour

Does it work the way it is meant to, judged by the people who use it? The product of this audit is a report for Martin: what works, what is broken, and practical proposals where it works but is awkward.

1. **Scope:** the area Martin names, else what changed recently (`git log` on the stage branch). Pick the **personas** it touches, in `GLOSSARY.md` terms:
   - a **guest** at a table: phone width (375px), Bulgarian and English, a slow connection, first visit;
   - a venue **owner** setting up a POS venue and a hand-made venue;
   - a **manager** on a busy night: sold out, hide, publish, tables;
   - an organisation **admin** or **member** reaching for what their role should not allow.
2. **User stories:** gather them from the spec issues, the decisions (`docs/decisions.md`) and the adjustments plan. Write each as "As a <persona> I want <x>, so that <y>", with the behaviour expected and the D-number or issue it comes from. Done when every story in scope names its source.
3. **Environment, local only:** your own database on the running Postgres (54329), `pnpm db:migrate`, `pnpm db:roles`, `pnpm db:seed:dev`, the dev server through `preview_start`. Sign in only with the seed's test accounts.
4. **Walk each story as its persona** in the built-in browser: mobile viewport for guests, both languages, screenshot each step. Note where the persona would hesitate, misread, take a wrong turn or get stuck, and check the result against the decision text. Guest pages also get the accessibility checks the faces specs already use.
5. **Sort each finding:**
   - **Works:** one line.
   - **Broken:** a bug; it goes to `bug.md` (the report links it).
   - **Works but awkward:** a proposal, written as the persona would say it, with the practical adjustment, its effort (S/M/L) and whether it would change a decision.
6. **Report** to `docs/reviews/<yyyy-mm-dd>-behaviour-<area>.md`, at most a page plus screenshots, the five most valuable items first, in plain language. Martin picks; each picked item becomes a `change.md` ticket. A story that broke gets a Playwright spec in its fix ticket, so it can't break again unseen.
