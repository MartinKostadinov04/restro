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
| 1.4 | **Everything is a "Style".** The thing a venue picks and edits is its Style; there are Style presets (ours) and custom Styles (a venue's own). The venue-facing word "Template" (D69) is replaced by Style; code and file names keep `template`/`face` until renamed. | Martin 10-27: "Call everything style where there are style presets and custom". | firm | GLOSSARY (pending), D-number pending |
| 1.5 | **One design per venue**, for all its menus. No menu-level or section-level design layer (a section's item layout stays a composer setting, as today). | Martin 10-27: "Each venue keeps 1 design for its menus". | firm | D-number pending |
| 1.6 | **A venue's design can be copied by another venue** of the organisation: custom Styles are listed under "My menu designs" (Venue 1, Venue 2…) beside the presets, and "copy" takes one over. | Martin 10-27. | firm | D-number pending |
| 1.7 | **Simple mode is three things:** colours, fonts, and one switcher for the general direction (Soft, Editorial, …) that sets everything else from a preset. Advanced is the rest. Revises D92's card list. | Martin 10-27: "Simple is only changing the colors fonts and a switcher that describes the general direction". The switcher's options are brainstormed next. | firm | D-number pending; D92 revision note |
| 1.8 | **The designer switches between every component of the guest page, the bill, the order and paying included.** The guest-feature screens are components of the designer from the start, not an add-on after ordering. What options each gets is decided per component. | Martin 10-27: "a switcher between all components of the client facing menu including billing/order/pay". | firm | D-number pending; revises the reading of D122's "template designed last" |
| 1.9 | **Editing and presets must be simple:** "once people hit Done it changes and that's it; in the meantime they are editing". The per-setting layering with "changed here" dots and resets, as the passport has it, was rejected as over-complicated. An Opus proposal on the simplest model is pending (D104's "I don't know" step 2). | Martin 10-27. | open | this log; the proposal is put back as the next question |
| 1.10 | **A design change reaches guests on the venue's next publish** (D92), the preview live while editing. | Martin 10-27: "yes". | firm | D92 (unchanged) |
