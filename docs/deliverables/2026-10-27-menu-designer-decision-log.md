# Decision log: the menu designer (one design list, templates as presets)

Made by: the lead session (Fable), 10-27, with Martin. For: anyone who needs every decision of the menu designer grilling at a glance. Research behind it: [2026-10-27-menu-designer-research-synthesis](2026-10-27-menu-designer-research-synthesis.md).

Every decision taken in the grilling, one row each. **Status:**
- **firm:** decided;
- **later:** decided to come later;
- **on request:** built only when a venue asks;
- **out:** out of scope;
- **open:** waits on a fact or a ticket.

**Recorded in** says where the binding text lives: a D-number, a ticket, `GLOSSARY.md`, `CLAUDE.md` or a `restro-flow` file. Only D-numbers bind; this log is the index to them.

## 1. The shape of the designer

| # | Decision | Why | Status | Recorded in |
|---|---|---|---|---|
| 1.1 | **One design list, drawn by one renderer.** Every guest menu is drawn by one renderer from one list of settings, each chosen from a fixed list. **A template is a preset of that list**, not a code package of its own. | Martin 10-27: "we are going to have multiple templates again but that is just presets of the settings – this is the level of flexibility we are targeting". One renderer is what makes option tiles, click to edit and "a new option never changes an existing look" possible. | firm | (D-number pending) |
| 1.2 | **The base is a plain, well-working menu anyone can use.** The renderer's base values give a neutral menu; Editorial Market is not the base but one preset over it. | Martin 10-27: "start from a plain very well working menu that can be used from everyone". | firm | (D-number pending) |
| 1.3 | **Every component of the guest page is editable:** the menu, its sections, the items in a section, each item's own page, billing, and their components. Which components vary, and with which options, is decided from a component inventory, not from the passport's list. | Martin 10-27; the passport is the model for *how* options are offered ("options that we know are going to work"), not for *which*. | firm | (D-number pending); inventory: `2026-10-27-guest-menu-component-inventory.md` |
| 1.4 | **"Style" holds the well-working presets.** A preset bundles values for the settings; a venue changes what it likes above it. Whether a preset keeps the glossary's name "Template" or becomes "Style" is open. | Martin 10-27: "something called style where you keep well working presets". | open | GLOSSARY (pending) |
