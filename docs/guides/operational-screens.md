# Operational screens: the checkable mechanics

D107 says what an operational screen must be (the admin, the composer, settings, later the operations and DJ screens); D109 and D123 admitted the mechanics below so that each can be checked in code or on a screen. A diff touching one of these screens, and the behaviour audit (`audit-behaviour.md` step 4), apply them; a ticket's screen plan (`ship.md` §1) is written against them. Guest templates are out of scope; they follow D105 and the designer guide.

**The persona** for every check: an owner or manager on a phone at 03:00, one-handed, who has never read a manual. The manager's phone is a supported admin device (D123), so a screen is checked at 390 px. The admin's screens and how they are reached are in `admin-map.md`.

## Undo

Reversible actions undo; they do not ask first (D107). An action that `apply()` cannot invert keeps its confirmation, so does an action that takes a venue's menu down, such as archiving the venue, even though it can be undone: the night promise (D102) outweighs the saved tap (D107, Martin 10-18). Erasing a venue's data is only the purge job's (D83).

- **One toast, one action.** `toast(text, { id, action: { label, onClick } })`. The label is the interface string "Undo" (next-intl, BG and EN). The one toast with an `action` so far (`apps/web/src/components/admin/delete-venue-dialog.tsx`) opens the list an archived venue is restored from: a link, not an undo.
- **A stable `id` per action**, built from the thing changed (for example `hide:<item id>`), so a second fire updates the toast and never stacks a second.
- **Fired by the client** from the server action's result, in the component that called it; the server action only returns the result.
- **The undo is a server action** that writes the inverse change set through `apply()` (rule 1), carrying its own provenance. It never restores by writing a stored copy of the old value around `apply()`.
- **One duration for every toast: 8 seconds**, set once in `toastOptions` of `apps/web/src/components/ui/sonner.tsx` (Sonner's own default is 4 seconds), so a call passes no `duration` of its own.
- **An error toast stays until closed**, shows a close button, and names the fix in the owner's words ("Check the connection and press Save again"), not "Something went wrong" (`.claude/skills/template-review/references/copy-rules.md`).

Checked by: grep of the `toast(` and `toast.` calls in a diff (an `action` and an `id` on a reversible one, no `duration`, none in a server file), and a screenshot of the toast.

## Frequency

An action the owner repeats many times a night gets no motion beyond shadcn's own defaults: hide or show, sold out, rename, reorder, switch a guest feature, publish. A row does not slide out, a number does not tween, a panel does not animate in. The changed state, plus the undo toast, is the feedback. Data the owner reads (names, prices, counts, times, states) never moves for style. Checked by: a diff that adds `@keyframes`, an `animate-*` or a `transition-*` class on one of these controls, outside `components/ui`, is a finding.

## Reduced motion

The admin honours `prefers-reduced-motion: reduce` with one global rule in its stylesheet that sets animation and transition durations to near zero. Reduced means off, never "gentler" (the guest templates' rule too; D109). No such rule exists in `apps/web` while dialogs animate: a defect, T88's. Checked by: `grep prefers-reduced-motion apps/web` finds the rule.

## Clean

Two rules (D123; a third, on the primary action standing out alone, found nothing in the trial that screen-read question 4 and D107 had not):

1. **Structure is information.** A divider, a border, a number, a label or an eyebrow appears only when the content has that structure: numbers for a sequence, a label where the heading alone would mislead, a border where two things must read as separate.
2. **Remove one thing before handing over.** Take the screenshot, find the element that does no job (a duplicated state, an empty card, an intro paragraph), remove it.

Checked by: the screenshot of each changed screen, against the two; the implementer notes what it removed under rule 2 in its report.

## Wayfinding, screen read and feedback

Four wayfinding questions per operational screen, answered from the screenshot, with the browser's back button never used:

1. **Where am I?** The screen's title and the venue it is for are visible.
2. **Where can I go?** The next steps are visible controls.
3. **What is here?** The content and its state are readable at a glance (what is hidden, sold out, published, unsaved).
4. **How do I get out?** A visible way back or away that loses nothing the owner typed.

Four screen-read questions per screen, answered from the same screenshot at a glance, before reading the body (D123):

1. **What does the eye land on first,** and is it the primary action or the state the owner came for?
2. **Is the purpose clear within two seconds,** from the title and the shape of the screen alone?
3. **Is there one reading order,** top to bottom, in the order the job is done?
4. **Is the right thing emphasised:** the primary action over the secondary ones, a problem state (failed, unsaved, sold out) over the normal one?

Three checks at every write, recorded in the audit:

1. **What happened:** a result in the owner's words within about a second, in place or as a toast.
2. **What failed:** a failure says what to do next (the error toast above).
3. **How to leave without losing work:** unsaved edits are kept or the owner is warned (T88's unsaved-edits warning).

A "no" to any of the eleven is a Works-but-awkward proposal.

## Patterns

The same job looks the same on every screen (D107): one pattern per job, chosen from what the admin already has (D123; `docs/deliverables/2026-10-21-admin-pattern-inventory.md` found up to five patterns for one job). A screen plan names the pattern for each of its jobs; a job with no row here is a question to the lead. Where a Platform file (`docs/platform-reference.md`) does a job another way, this table wins: port the Platform's mechanics, not its pattern, and say so in the report. Where a screen uses another pattern today, it is a *divergence*. A screen plan follows this table, so a ticket that redesigns a screen fixes that screen's divergences as part of its plan; on every other screen a divergence is reported (by the implementer or at review) and fixed by its own `change.md` ticket when Martin picks it from #60.

| Job | The pattern | Divergences today |
|---|---|---|
| A single reversible write (hide or show, sold out, a layout or look option, a guest feature) | The control saves at once; the undo toast is the feedback (Undo, above). No Save button. | Guest features: switches plus Save. |
| Rename | A pencil opens the name in place; Enter saves, Escape cancels. | Menus: an inline form with Save; areas and tables: an always-open field saved on blur; the venue name and the header name: a field plus Save. |
| Reorder | A drag handle with the keyboard alternative, plus "…" → Move up / Move down for one hand on a phone (WCAG 2.5.7). | Menus: up and down arrows; sections and tags: the handle alone. |
| Move a thing elsewhere | Drag onto its new place, or "…" → "Move to…" with the places listed. | Tables: flat "…" items. |
| Add a thing | Up to three fields: a dialog, opened by one button named for the thing ("New section"). More fields, or a secret (a POS connection): a form in its own card with Save (the unsaved-edits row). | Menus: a button that reveals an inline form. |
| A list of records (sync runs, versions, deleted venues) | A list newest first, each row with its state and its time in the venue's zone; nothing yet is the empty-state block. | none |
| Remove a thing that can come back | One tap, no dialog; the undo toast, or a bin with Restore where the thing has a life after removal (menus, venues). | Items and sections made by hand: a red-button dialog, three taps (a candidate only if `apply()` can put them back). |
| Remove a thing for good, or take a venue down | A dialog that names the consequence (`copy-rules.md` rule 11); the typed-name dialog only for what takes a menu down or erases data (D107, D83). | Unpublish takes a menu down with a one-tap confirmation and no typed name; every dialog's dismiss button says "Cancel" (about 21 strings) against rule 11. |
| The secondary actions of a row | A "…" menu; the primary action stays visible on the row. Nothing appears only on hover: a phone has none. | The help line of the composer's name and conflict badges sits in a hover card a tap does not open. |
| Pick one of a few | Two to five options, each a word: a segmented control. More, or options with names to read: a Select. Options whose consequence needs a sentence: radio cards. A continuous value: a slider with its value shown. | none (each case has its own control today) |
| Everything about one thing | A side sheet (a bottom drawer on a phone), with tabs when it has more than one page. | The item sheet and the Tags panel: a side sheet at every width; only the field editor becomes a drawer. |
| Several things at once | Tick them; the floating selection bar holds the actions. | none |
| A state of the whole page (held, paused, address off, live version) | One banner at the top, dismissible only when the state is. | none |
| What happened after a write | In place when the control shows it, else a toast; a failure is the error toast that stays and names the fix (Undo, above). | Inline red text in cards and dialogs beside toasts; one job, two voices. |
| Nothing here yet | The empty-state block: what this is and one button to start (`copy-rules.md` rule 5). | Menus and areas: a plain sentence. |
| Edits that are not saved yet | Prefer saving at once (row 1). Where a form must be saved as a whole: Save disabled until something changed, "Unsaved" visible, and the leave-page warning (T88). | No leave-page warning anywhere. |

Checked by: the screen plan's Pattern line against this table before the ticket; the screenshot at review.

## Accessibility

The standard is **WCAG 2.2 AA** (the W3C Recommendation since October 2023), and a finding names its criterion (D123). The criteria checked on an operational screen:

- **1.1.1** every icon-only control and meaningful image has a text alternative; **1.3.1** structure (headings, lists, tables, labels) is in the markup, not only in the look;
- **1.4.3** text contrast at least 4.5:1 (3:1 for large text); **1.4.11** at least 3:1 for a control's boundary and its states; **1.4.4** readable at 200 % zoom; **1.4.10** no horizontal scroll in a 320 px container;
- **2.1.1** every job can be done from the keyboard; **2.4.3** focus moves in the reading order; **2.4.7** the focused control is visible; **2.4.11** a sticky bar or banner never covers the focused control; **2.5.7** anything done by dragging can be done by taps too;
- **3.2.1** focusing a control changes nothing by itself; **3.3.1** an error names the field and what is wrong; **3.3.2** every input has a visible label;
- **4.1.2** every control exposes its name, role and value to assistive technology.

Targets are 44 × 44 px: Restro's own floor (D123; the templates' §7.5 says the same), stricter than 2.2 AA's 24 px (2.5.8; 44 px is the AAA criterion 2.5.5). The shared controls in `apps/web/src/components/ui/` meet it on a phone (under 768 px) and keep shadcn's 36 px on a larger screen; a control that stays small to look at (a checkbox, a switch) gets a 44 px hit area through the `tap-area` class. `e2e/touch-targets.spec.ts` walks two screens at 390 px and fails when a control on them has less, so a new screen built from the shared controls inherits the floor and a control drawn outside them is the screen's own to size. Contrast is checked in both the light and the dark theme.

Checked by: the pinned Vercel accessibility and focus rules on the code first (`ship.md` §3), then in the built-in browser: a keyboard walk of the screen's jobs, and the accessibility tree (`read_page`) for 1.3.1 and 4.1.2. A screen reader proper (VoiceOver, NVDA) is a `device` line for Martin's acceptance, as for the templates.
