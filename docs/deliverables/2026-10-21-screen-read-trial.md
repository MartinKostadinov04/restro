# Screen-read trial: Organisation › Integrations

Trial required by D106 for the four checks D123 lifted into `docs/guides/operational-screens.md` (the persona, Clean, the four screen-read questions, Patterns, Accessibility). Question: do they find anything that the checks already in force (pinned Vercel rules with the Restro overrides, the wayfinding and feedback questions, `copy-rules.md`) do not? Run 10-21 by an agent session (Sonnet), local only, nothing committed.

## The screen and the environment

- **Screen:** `/settings/integrations`, route `apps/web/app/(admin)/settings/integrations/page.tsx`. Its components are in `apps/web/src/integration/` (the screen, the systems picker, one panel per connection with its cards) and `apps/web/src/connectors/barsy/settings-card.tsx`; `apps/web/src/components/admin/` holds only the Settings frame (`settings-header.tsx`, `settings-nav.tsx`). Seed data: one system (barsy), two connections (`dev-seed.test`, used by Demo Club Sofia; `e2e.item-sheet.test`, no venue), no credentials saved, no sync run. Owner account from `pnpm db:seed:dev`.
- **Second screen:** the composer's Structure subtab, a short pass only (the last section below). It does not count towards the table.
- **Setup:** database `restro` on port 54329 was migrated (28 migrations); I ran `pnpm db:roles` and `pnpm db:seed:dev`. I did not add the `web-dev` entry to `.claude/launch.json`: `next.config.ts` loads the repo's `.env.local` (which I did not read) and I wanted the database values to come from `.env.example`, so I started `pnpm --filter @restro/web dev` from the shell with those values exported and stopped it afterwards. The built-in browser worked at 390 px, 320 px, 195 px (200 % of 390) and desktop 1280 px, light theme forced. Postgres was left running. The pane reported "hidden" the whole time; the tools worked.
- **Writes done on the screen** (local seed data only): untick barsy and Save (refused), rename a connection and rename it back, the Remove dialog on the connection a venue uses (refused), the Add form with an invalid address (refused). No credentials were saved, so no job was queued and no POS was contacted. "Check again", "Sync everything now", the allergen and language Save and the run history could not be exercised (they need saved credentials or a run); they were read from the code only.
- **Language:** the first pass was in Bulgarian (the default); one pass in English.
- **Honest limits:** I had read `page.tsx` (two headings and a description) before the first screenshot; the screen-read answers were written from the screenshot before I read the other components. Contrast was computed from the CSS colour tokens with a canvas conversion, on the light theme.
- **Screenshots** in `apps/web/test-results/screen-read-trial/` (ignored folder): `m390-bg-01-top`, `-02-connection`, `-03-settings-card`, `-04-systems-unticked-hint`, `-05-systems-save-refused`, `-06-rename-open-two-save-buttons`, `-07-remove-dialog`, `-08-remove-refused`, `-09-add-form-open`, `-10-add-form-failed-fields-cleared`, `w320-bg-13-overflow`, `desktop-bg-11-top`, `desktop-bg-12-tab-strip-stray-scrollbar-zoom`, `m390-en-14-top-no-overflow`, `screen2-m390-bg-15-structure-top`, `screen2-m390-bg-16-structure-section`. (`m390-bg-00-login` is the sign-in page.)

## Counts

"Already found" means the same defect was listed by an earlier step. "Noise" means no real problem for the persona (a manager on a phone at 03:00). "New real" is total minus the other two.

| Step | Total | Already found earlier | Noise | New real |
|---|---|---|---|---|
| 1. In force, code (Vercel + copy-rules) | 18 | none before it (2 are known as T88) | 3 | 15 |
| 2. In force, screen (4 wayfinding + 3 feedback) | 9 | 1 | 1 | 7 |
| 3. New: screen read (4 questions) | 4 | 0 | 0 | 4 |
| 4. New: Clean (3 rules) | 7 | 3 | 0 | 4 |
| 5. New: Patterns | 7 | 1 | 1 | 5 |
| 6. New: Accessibility | 8 | 4 | 1 | 3 |

The most serious defect on the screen was found by the screen, not by any code rule: in Bulgarian, at 390 px, the page is 37 px wider than the phone (107 px at 320 px). It is the select trigger's no-wrap text; English fits.

## Verdict per check

- **Screen-read questions: keep.** Four findings, none of them found by the wayfinding questions: the eye lands on the "Settings" title, not on what the owner came for; three headings and three grey paragraphs before any control; the one-time picker sits above the daily job; the loudest shapes at rest are four greyed-out buttons per connection. Q2 (two seconds) and Q3 (one reading order) overlap each other and Clean rule 1; they could be one question ("what is the first screenful, and does it hold the job?").
- **Clean: keeps finding things through rules 1 and 3** (the same state said twice, a one-tab tab strip, an empty card). **Rule 2 finds nothing beyond screen-read Q4 and D107's "one primary action"**; fold it into Q4 and keep two rules, or leave it as the label for the same finding. Needs rewording: rule 3 says "take the screenshot, find the element that does no job"; on this screen the agent must be told to look at empty states and duplicated state first, which is where it found things.
- **Patterns: keeps finding things, but little for the persona; needs rewording.** It gave five divergences the table does not list for this screen, one job with no row (a collapsible list of past runs with a row detail), and confirmed that the whole screen uses the inline-text voice and no toast. Rewording: (a) "Add a thing: a dialog with the fewest fields" cannot hold a connection (name, address, user, password, with secrets); say what a form with credentials is; (b) add the missing row; (c) the "Divergences today" column is documentation, so say that a divergence found in review is reported, not fixed in the ticket. Of its seven findings, three repeat what steps 2 to 4 found.
- **Accessibility: keeps finding things in two places, finds nothing in the rest.** New: field borders at 1.27:1 and the focus ring at 1.55:1 to 2.62:1 (1.4.11), and every control under 44 px (the floor is old, D107 and D109, but nothing checked it). The overflow (1.4.10, 1.4.4) was real and big but step 2 had found it first; the tab-stop and focus findings (2.4.3, 2.4.7) and the error linkage (3.3.1) were found by the Vercel rules and step 2. Criteria 1.1.1, 1.4.3, 2.1.1, 3.2.1, 3.3.2 and 4.1.2 found nothing on this screen (labels are linked, names, roles and values are exposed, all text pairs are at least 5.0:1), because shadcn and Radix cover them. They are cheap to keep.
- **Does not come from any of the four:** the Bulgarian overflow was found because the screen opens in Bulgarian by default. D123's "longest Bulgarian text" state in the screen plan would have caught it, not these checks. The 320 px container (1.4.10) would also have caught it.

## Findings by step

File lines are from the working tree on 10-21 (`apps/web/src/integration/` unless a path is given).

### Step 1. In force, code

Vercel rules (pinned and overrides) and `copy-rules.md`, over the screen's files.

1. Heading levels do not descend: the connection's name is an `h3` (`instance-panel.tsx:114`) and each card inside it is also an `h3` (`components/ui/form-section.tsx:23`). Real.
2. Submit buttons are disabled until every field is filled and give no reason: `connect-card.tsx:252`, `add-instance-card.tsx:133`, rename `connect-card.tsx:103` (pinned Forms rule). Real.
3. An error sits under the whole form, not next to the field, and focus does not move to it: `connect-card.tsx:243`, `add-instance-card.tsx:124`, `systems-picker.tsx:103`, `error-note.tsx:21`. Real.
4. No leave-page warning where the screen has Save buttons (override 14): `connect-card.tsx`, `add-instance-card.tsx`, `barsy/settings-card.tsx`, `systems-picker.tsx`. Real; known (T88).
5. The checkbox is 16 px; the bordered row around it (`systems-picker.tsx:77-95`, `p-3`) is a dead zone, only the label also reacts. Real, minor.
6. A user-made name has no wrapping rule: `instance-panel.tsx:114` and the venue list at `:126-132`. I injected an 80-character name with no spaces: the page grew to 1049 px. Real, low.
7. `animate-spin` with no reduced-motion rule: `status-card.tsx:108`, `sync-card.tsx:43`, `run-history.tsx:125`. Real; known (T88).
8. `components/ui/tabs.tsx:74`: the tab panel has `outline-none` with no replacement, and Radix makes it a tab stop. Real.
9. Inputs have no `name`: `connect-card.tsx`, `add-instance-card.tsx`. Noise.
10. Placeholders do not end with "…" (`connect-card.tsx`, `add-instance-card.tsx`). Noise.
11. Rule 4: "Something went wrong. Try again." (`messages/en.json` `integration.errors.failed`; BG "Нещо се обърка"). Real.
12. Rule 4: `errors.invalid` ("That input is not valid") and `errors.not_found` name no fix. Real, minor.
13. Rule 11: the Remove dialog's buttons are "Cancel" and "Remove connection" (`instance-panel.tsx:74-79`, `integration.instance.remove.cancel`). The no-button should say "Keep connection". Real.
14. Rule 3: the Add form's button says "Save and check" (`add-instance-card.tsx:135`), the opening button and card say "Add barsy". Real, minor.
15. Rule 8: "till" in English ("The till's main currency", "less cautious than the till"; BG "касата"); GLOSSARY says POS. Real.
16. Rule 8: counters "Articles seen", "Categories seen" (`integration.history.counters`); GLOSSARY says item and section. Real, minor (they are the POS's own words for what it reported).
17. Rule 8: the screen says "connection" and "Integrations"; GLOSSARY says "Instance (avoid integration, connection)". A conflict between the glossary and D81's naming: a question for the lead. Noise for the persona.
18. Rule 7: straight quotes in English strings (`integration.connect.notQueued`, `connectors.barsy.settings.allergen.help`). Real, trivial.

Not in any rule and not counted: `integration.connect.keysMissing` tells an owner about "the web app and the worker".

### Step 2. In force, screen

Wayfinding at 390 px (Bulgarian):
1. **Where am I:** pass ("Settings › Integrations", the title, the underlined tab). The organisation is not named on a phone (the sidebar is closed); fine for a one-organisation owner. Noise (counted).
2. **Where can I go:** the Settings tabs and the breadcrumb are visible. "Used by 1 venue: Demo Club Sofia" is plain text, no link to the venue (`instance-panel.tsx:126-132`); the refusal "delete those venues first" has no link either. Real.
3. **What is here:** the second connection starts about 2,300 px down; the page is 4,709 px at 390 px; nothing at the top lists the connections with their state. Real.
4. **How do I get out:** a breadcrumb and the tabs. I typed a name, navigated away, and it was gone with no prompt (same as step 1, finding 4).

New in this step:
- 2.1 **Overflow in Bulgarian:** the page needs 427 px at a 390 px phone; the cause is `barsy/settings-card.tsx:90` and `:117`, a select trigger with no-wrap text inside a grid with no `min-w-0` (hiding the two selects brings the page back to 390). English fits (`m390-en-14`). Screenshot `m390-bg-02`, `w320-bg-13`. The Vercel rule "flex children need `min-w-0`" names flex, not grid, and reading the code does not show the width. Real, the largest.
- 2.2 **A stray vertical scrollbar beside the single tab** (`integrations-screen.tsx:67-70`: `overflow-x-auto` on a 36 px strip whose content is 37 px). It shows as a grey bar on the phone and as two arrows on desktop (`desktop-bg-12`). Real.
- 2.3 (the organisation, above; noise).
- 2.4 See "where can I go" above (no link to the venue).
- 2.5 The connections are stacked, five cards each, with no summary above (see "what is here").
- 2.6 Typed text is lost silently on navigation (already step 1, finding 4).
- 2.7 **The picker says the same sentence twice:** grey ("barsy still has connections…") when you untick, red after Save; the box stays unticked and nothing resets it (`m390-bg-04`, `-05`). The feedback is in place and names the fix, but adds nothing. Real, minor.
- 2.8 **A failed Add clears the API user and the password** (`add-instance-card.tsx:55`, and `connect-card.tsx:139`); the error is under the password, not the address, and Save goes grey again, so one typo in the address means typing both again (`m390-bg-10`). Real. The placement half is step 1, finding 3.
- 2.9 **The Remove dialog offers a red "Remove connection" for a connection whose venue list is already on the page**, and the dialog itself says such a connection cannot be removed; the refusal arrives after the tap (`m390-bg-07`, `-08`; `instance-panel.tsx:65-81`). Real.

Feedback checks: what happened (rename shows the new name in place within a second; the refused actions show red text in about a second): pass. What failed: pass for wording; findings 2.7, 2.8, 2.9. Leave without losing work: fail (finding 2.6).

### Step 3. New: the four screen-read questions

From `m390-bg-01-top` before reading the rest.
- 3.1 **Q1, what the eye lands on:** the "Settings" title and the three tabs; the first dark shape is a checkbox. The state the owner came for (is the connection working?) is more than 1,300 px down. No primary action is visible. Real.
- 3.2 **Q2, purpose in two seconds:** not clear. Three headings (Settings, Integrations, Systems), each with a 2 to 3 line grey paragraph, come before any control (about 480 px); "Integrations" appears four times (breadcrumb, tab, heading, and the title's meaning). Real.
- 3.3 **Q3, one reading order:** no. The picker, a one-time job, comes before the daily job; a lone "barsy" chip floats between two cards and reads as a stray; the Status card comes after the credentials form. Real.
- 3.4 **Q4, the right thing emphasised:** no. The status is a small grey pill; four greyed-out buttons per connection (Save systems, Save and check, Save settings, Sync everything now) are the loudest shapes at rest; with Rename open there are two equal dark buttons in one card (`m390-bg-06`). Real.

### Step 4. New: Clean

- 4.1 **Rule 1, a tab strip of one** (`integrations-screen.tsx:66-76`): the strip repeats the picker's only option and brings the stray scrollbar of finding 2.2. Real.
- 4.2 **Rule 1, the same fact more than once:** the Status card has a row labelled "Status" under a card titled "Status" (`status-card.tsx:95-97`); the state pill is in the header (`instance-panel.tsx:117-124`) and again in the card (`status-card.tsx:99`); the address is in the Connection form and the Status card (`status-card.tsx:128`); the name is in the heading and the Name row (`connect-card.tsx:57-60`). Real.
- 4.3 **Rule 1, the intro text:** "set once for the whole organisation" is said in the Settings description (`settings/layout.tsx:28-30`), the page description (`page.tsx:34-38`) and the Systems card. Already step 3, finding 3.2.
- 4.4 **Rule 2:** several dark primary buttons per connection. Already step 3, finding 3.4.
- 4.5 **Rule 3, remove one thing:** the empty "Sync history" card (title, two-line description, one sentence) (`instance-panel.tsx:144-155`, `run-history.tsx:216-227`). Hide it until a first run exists. Real.
- 4.6 **Rule 3:** the Systems picker is a whole card at the top for a product that supports one system (`systems-picker.tsx`); depends on D81, which wants the choice. Real.
- 4.7 The grey hint and the red error saying the same sentence: already step 2, finding 2.7.

### Step 5. New: Patterns

Job, the pattern the screen uses, the row it matches:
- 5.1 **Choose the systems:** ticks plus "Save systems". Row 1 says reversible writes save at once. New divergence (the table lists "Guest features" only). Real.
- 5.2 **Add a connection:** a button that reveals an inline card above the others. Row 5 says a dialog; the table lists Menus only. New divergence. Real. (A connection has four fields, two of them secret: a dialog with "the fewest fields" does not fit.)
- 5.3 **Rename:** an outline "Rename" button, then a field with Cancel and "Save name". Row 2 says pencil in place, Enter saves. New divergence. Real.
- 5.4 **Remove a connection:** a dialog naming the consequence. Matches row 7; the Cancel label is step 1, finding 13. Nothing new.
- 5.5 **Credentials and settings forms:** Save as a whole, disabled until filled or changed, no "Unsaved", no leave warning. Matches row 14 and its listed divergence. Nothing new.
- 5.6 **Pick one of a few:** two Selects (allergen characteristic, language of untagged text, 11 options). Matches row 9. Nothing new.
- 5.7 **After a write:** inline text everywhere, no toast on the screen. Matches the listed divergence. Nothing new.
- 5.8 **The list of past runs** (collapsed, each row expands): **no row**. A question for the lead, as the guide says. Real.
- 5.9 **Everything about one connection:** one long page, five cards per connection, two connections stacked. Row 10 says a side sheet with tabs. Already step 2, finding 2.5.
- 5.10 **Nothing here yet:** the run history is one line with an icon (listed for Menus and areas). Noise.
- 5.11 **A state of the whole page:** "sync keys missing" is an Alert inside the Connection card of every connection and of the Add card (`connect-card.tsx:165-169`, `add-instance-card.tsx:140`), not one banner at the top (row 11). Code only, the state did not occur. Real, low.

### Step 6. New: Accessibility

- **1.1.1:** every icon is `aria-hidden`; the icon-only buttons have names. Pass.
- **1.3.1:** the heading levels are step 1, finding 1 (Vercel already). The Name row is two spans (`connect-card.tsx:57-60`) while the Status card uses a `dl`. Noise. Labels are linked to every input, select and checkbox (checked in the DOM).
- **1.4.3:** every text pair is at least 5.0:1 (lowest: the danger badge 5.03; muted text 6.03; error text 6.02; placeholder 6.03); disabled controls are exempt. Pass.
- **1.4.11:** the border of inputs, selects, the system row and the unticked checkbox is 1.27:1 (`--input` equals `--border`; `ui/input.tsx`, `ui/select.tsx`, `ui/checkbox.tsx`). The focus ring is `ring-ring/50` at 1.55:1, its border 2.62:1. Two findings; shadcn defaults, app-wide. New.
- **1.4.4 and 1.4.10:** the page needs 427 px at 390 px, at 320 px and at 195 px (200 % of 390). Fail; already step 2, finding 2.1.
- **2.1.1:** I walked the toggle, the Settings links, the checkbox, the tab, Add, Remove, Rename, the three inputs and both selects by Tab. Pass. Disabled buttons are skipped; their reason is plain text.
- **2.4.3:** the order is the reading order, but the tab strip (a scroll container, finding 2.2) and the tab panel (step 1, finding 8) are two extra stops. Already found.
- **2.4.7:** those two extra stops show no focus. Already found (step 1, finding 8; step 2, finding 2.2). Inputs and buttons show a ring (contrast above).
- **3.2.1:** pass. **3.3.1:** the message names the field in words but the input has no `aria-invalid` or `aria-describedby` (`error-note.tsx:21`); already step 1, finding 3. **3.3.2:** visible labels everywhere. Pass. **4.1.2:** names, roles and values are exposed (checkbox, tabs, selects, dialog); repeated names ("Rename" twice) are separated by the connection's labelled region. Pass.
- **Targets, 44 px:** every control is under it: checkbox 16, tab 29, Remove and Rename 32, inputs and buttons 36, nav tabs 38, sidebar toggle 28. The guide already admits shadcn's 36. New.

## The second screen, short pass: composer › Structure at 390 px

Not counted. With the new checks: the "menu address is off" state is said twice, a line under Publish and a large banner (Clean rule 1; Patterns row 11 says one banner); heading levels run h1, h3 (the banner), h2; all 73 interactive controls are under 44 px (switches are 32 × 18); the two switches in the section header have names for assistive technology but no visible label, so a sighted owner cannot tell "shown to guests" from "horizontal row" (3.3.2); the "From barsy" chip repeats on every row of a venue where everything is from barsy. The first thing the eye lands on is the venue name, then the dark Publish button with its count: the screen-read answer is good there.

## What the lead may want to act on

1. Fix the Bulgarian overflow and the stray tab scrollbar (findings 2.1, 2.2): one small change each.
2. Add "longest Bulgarian text at 390 px" to the behaviour audit's walk if it is not already there; it found the main defect, no code rule did.
3. Decide whether the 1.27:1 field border and the focus ring are accepted shadcn defaults (then say so in the guide) or fixed once in `globals.css`.
4. The picker, the one-tab strip and the stacked connections are D81 shape questions; they go to Martin, not into a ticket.
