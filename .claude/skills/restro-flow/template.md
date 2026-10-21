# Build › Template

A new guest menu template (D69), or a change to one. An agent session designs it from the menu functionality file, an independent reviewer on another model checks and wires it, and Martin accepts it himself (D105). Ends in `ship.md`. The skills own the how: `template-design` for the design session, `template-review` for the reviewer.

1. **Brief (lead).** Ask Martin for material first (references, screenshots, a mood). With none, run `prototype` for three one-screen directions and let Martin pick; the pick goes into the brief. Each direction:
   - names its axis (the one thing it varies);
   - says when it wins and what it costs;
   - differs from the others in more than colour or copy;
   - is shown full size at 390 px on the demo view model;
   - lives on a throwaway branch, deleted after the pick.

   The ticket is `ship.md`'s format, with the template id, its names and descriptions in Bulgarian and English, a three-line intent, two or three visual references, and any entry of `docs/guides/menu-template-functionality.md` the template may skip, named. A change to an existing template names what changes and keeps its id and class prefixes (the designer guide's §11).
2. **Design session (agent session).** Opus by default (the model T87 names for design; the ticket sets it, D58). Its brief is: run the `template-design` skill on this ticket. It spawns the `template-review` subagent itself, on a different model, and stops after two rounds that are not clean. A stop means the brief was wrong: the lead rewrites it with Martin.
3. **Acceptance (Martin).** After the reviewer's clean pass and a green pull request, the lead starts the branch's preview (`preview_start`) and hands Martin an address his own phone can open, and what to try: the menu in Bulgarian and English, light and dark, sold-out and scheduled items, the allergens, the layout switch, the services in the admin's preview. His changes go back to the design session. Martin accepts every template before it is merged; the screenshots are for agents (D105).
   - **On his phone**, the things emulation cannot show: a hover that sticks after a tap; a grey flash on a tap; the page zooming when an input is focused; a bottom bar under the browser's own bar; the keyboard covering the note field; the notch; the smallest text at low brightness; a long-press on a chip.
   - **The address:** the dev server must answer on the local network. Next.js blocks cross-origin requests to its dev-only assets and endpoints from any hostname other than `localhost`, its subdomains and the one the server started with, unless `allowedDevOrigins` lists it (`apps/web/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/allowedDevOrigins.md`; entries are bare hostnames, no scheme, no port). `apps/web/next.config.ts` sets none, so a LAN address or a tunnel may need an entry: that is a ticket for app code, raised before acceptance starts. An address the phone cannot open is a ticket too. Done when the lead has loaded the menu from another device on the same network and Martin has the address.
4. **Merge (lead).** `ship.md` §3 and §4. The lead reads the design-intent note and the reviewer's list, since the diff alone does not show the design.
5. **Lessons (lead).** Take the report's "Lessons for the skills" to Martin. Each one he accepts becomes an Upkeep ticket (`upkeep.md` → Agent environment); the others are dropped.
