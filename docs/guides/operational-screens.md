# Operational screens: the checkable mechanics

D107 says what an operational screen must be (the admin, the composer, settings, later the operations and DJ screens); D109 admitted the mechanics below so that each can be checked in code or on a screen. A diff touching one of these screens, and the behaviour audit (`audit-behaviour.md` step 4), apply them. Guest templates are out of scope; they follow D105 and the designer guide.

## Undo

Reversible actions undo; they do not ask first (D107). An action that `apply()` cannot invert keeps its confirmation; erasing a venue's data is only the purge job's (D83).

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

## Wayfinding and feedback

Four questions per operational screen, answered from the screenshot, with the browser's back button never used:

1. **Where am I?** The screen's title and the venue it is for are visible.
2. **Where can I go?** The next steps are visible controls.
3. **What is here?** The content and its state are readable at a glance (what is hidden, sold out, published, unsaved).
4. **How do I get out?** A visible way back or away that loses nothing the owner typed.

Three checks at every write, recorded in the audit:

1. **What happened:** a result in the owner's words within about a second, in place or as a toast.
2. **What failed:** a failure says what to do next (the error toast above).
3. **How to leave without losing work:** unsaved edits are kept or the owner is warned (T88's unsaved-edits warning).

A "no" to any of the seven is a Works-but-awkward proposal.
