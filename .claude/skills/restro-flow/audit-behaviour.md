# Audit › Behaviour

Does it work the way it is meant to, judged by the people who use it? The product of this audit is a report for Martin: what works, what is broken, and practical proposals where it works but is awkward.

1. **Scope:** the area Martin names, else what changed recently (`git log` on the stage branch). Pick the **personas** it touches, in `GLOSSARY.md` terms:
   - a **guest** at a table: phone width (375px), Bulgarian and English, a slow connection, first visit;
   - a venue **owner** setting up a POS venue and a hand-made venue;
   - a **manager** on a busy night: sold out, hide, publish, tables;
   - an organisation **admin** or **member** reaching for what their role should not allow.
2. **User stories:** gather them from the spec issues, the decisions (`docs/decisions.md`) and the adjustments plan. Write each as "As a <persona> I want <x>, so that <y>", with the behaviour expected and the D-number or issue it comes from. Done when every story in scope names its source.
3. **Environment, local only:** your own database on the running Postgres (54329), `pnpm db:migrate`, `pnpm db:roles`, `pnpm db:seed:dev`, the dev server through `preview_start`. Sign in only with the seed's test accounts.
4. **Walk each story as its persona** in the built-in browser: mobile viewport for guests, both languages, screenshot each step. Note where the persona would hesitate, misread, take a wrong turn or get stuck, and check the result against the decision text. Guest pages also get the accessibility checks the faces specs already use. On operational screens (D107) count the taps of each common story (hide or show an item, rename, reorder, switch a guest feature, pick a template, publish) and report the trade-off where fewer taps cost a clear screen. On an operational screen that renders owner or POS text, counts or lists, also run the worst-case pass: read `references/break-ui.restro-overrides.md`, then the vendored `references/break-ui/SKILL.md` phases 1, 2 and 4 and the `CATALOG.md` rows for text, numbers, collections, images and states. Never for the guest persona (the faces have fixtures).
   - **Orientation and feedback (operational screens):** answer the four wayfinding questions per screen and the three feedback checks at each write, as `docs/guides/operational-screens.md` defines them (where am I, where can I go, what is here, how do I get out; what happened, what failed, how to leave without losing work). Each "no" is a Works-but-awkward proposal.
   - **Worst-case pass, environment rows:** the screen in a 320 px container, at 200 % text zoom, and every action that appears only on hover, which a phone cannot reach.
   - **Worst-case pass, time rows:** the screen at 06:59 and at 07:00 (the service day ends at 07:00 by default), a schedule that crosses midnight, and the night the clocks change. Use the venue's time zone and service day (CLAUDE.md, "Time").
   - **Motion:** any motion met on a repeated story (the frequency rule in the same note) is a Works-but-awkward proposal.
5. **Sort each finding:**
   - **Works:** one line.
   - **Broken:** a bug; it goes to `bug.md` (the report links it).
   - **Works but awkward:** a proposal, written as the persona would say it, with the practical adjustment, its effort (S/M/L) and whether it would change a decision.
6. **Report** to `docs/reviews/<yyyy-mm-dd>-behaviour-<area>.md`, at most a page plus screenshots, the five most valuable items first, in plain language. Martin picks; each picked item becomes a `change.md` ticket. A story that broke gets a Playwright spec in its fix ticket, so it can't break again unseen.
