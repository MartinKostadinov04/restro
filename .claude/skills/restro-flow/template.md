# Build › Style

A new premade Style for the guest menu, or a change to a Style's values (D128). An agent session
picks the values against the design contract, an independent reviewer on another model checks them,
and Martin accepts the Style himself on a local preview (D105, D128). Ends in `ship.md`. The skills
own the how: `template-design` for the design session, `template-review` for the reviewer.

A Style is a preset of the contract: one file of values over Basic, drawn by the one renderer. A look
the renderer cannot draw is not a Style's to add — it comes back as a stop-and-ask with the drawing
and the option it would be for every Style, and that option is its own ticket (D130's list is closed
without Martin).

1. **Brief (lead).** Ask Martin for material first (references, screenshots, a mood, a Style he likes
   elsewhere). With none, run `prototype` for three one-screen directions and let Martin pick; the
   pick goes into the brief. Each direction:
   - names its axis (the one thing it varies);
   - says when it wins and what it costs;
   - differs from the others in more than colour or copy;
   - is shown full size at 390 px on the demo view model;
   - lives on a throwaway branch, deleted after the pick.

   The ticket is `ship.md`'s format, with the Style's id (a value of the contract's Style option), the
   name Martin says it by, its temper in two or three lines, and its starting values (a column of the
   options spec's §4 table, or Basic's). A change to an existing Style names the options that move and
   keeps its id.
2. **Design session (agent session).** Opus by default (design judgement over forty-five values; the
   ticket sets it, D58). Its brief is: run the `template-design` skill on this ticket. It spawns the
   `template-review` subagent itself, on a different model, and stops after two rounds that are not
   clean. A stop means the brief was wrong: the lead rewrites it with Martin.
3. **Acceptance (Martin).** After the reviewer's clean pass and a green pull request, the lead starts
   the branch's preview (`preview_start`) and hands Martin the Design page with the Style's tile on
   it, plus an address his own phone can open, and what to try: the Style's checks from the stage's
   acceptance guide, the menu in Bulgarian and English, light and dark, the allergens, a dish page,
   the layout switch, the service sheets in the admin's preview. His changes go back to the design
   session. Martin accepts every Style before it is merged; screenshots are for agents (D105).
   - **On his phone**, the things emulation cannot show: a hover that sticks after a tap; a grey
     flash on a tap; the page zooming when an input is focused; a bottom bar under the browser's own
     bar; the keyboard covering the note field; the notch; the smallest text at low brightness; a
     long-press on a chip.
   - **The address:** the dev server must answer on the local network. Next.js blocks cross-origin
     requests to its dev-only assets and endpoints from any hostname other than `localhost`, its
     subdomains and the one the server started with, unless `allowedDevOrigins` lists it
     (`apps/web/node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/allowedDevOrigins.md`;
     entries are bare hostnames, no scheme, no port). `apps/web/next.config.ts` sets none, so a LAN
     address or a tunnel may need an entry: that is a ticket for app code, raised before acceptance
     starts. An address the phone cannot open is a ticket too. Done when the lead has loaded the menu
     from another device on the same network and Martin has the address.
4. **Merge (lead).** `ship.md` §3 and §4. The lead reads the Style's brief deliverable and the
   reviewer's list, since a file of values does not show the design.
5. **Lessons (lead).** Take the report's "Lessons for the skills" to Martin. Each one he accepts
   becomes an Upkeep ticket (`upkeep.md` → Agent environment); the others are dropped.
