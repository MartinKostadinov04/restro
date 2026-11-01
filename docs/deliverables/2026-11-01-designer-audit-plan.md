# The menu designer wave: audit plan

> Filed 2026-11-01 by the repair-review lead, at Martin's request through the Design lead. A plan only; nothing has been audited. Decisions 128 to 131 live on `st/foundation`, so they are written here without their usual prefix.

**What is audited:** `st/foundation` at 7dccd3a4, against `or/foundation`, which the repair-review already covered. The pin contains every repair-review fix except one ledger note. Its CI run was still going when this was written, so the audit pins it only once that run is green; if it is red, the pin moves to the fix.

**The size:** about 10,700 lines of written code (faces 3,100, the Design page 2,800, core 1,800, other web 1,600, shell 700, db 300), plus 12,700 lines of tests and 50,000 of generated renderings. That is roughly a sixth of the last review's code. My estimate is one night of machine time.

**Same method as the repair-review:** one ledger only the lead writes, in `docs/reviews/2026-11-01-designer-audit/`. A red test plus one Opus check confirms a finding; otherwise two blinded Sonnet verifiers decide, with a tie-break on a split. Same severities, and local only: this PC, its own database, the simulated POS and payment provider.

## Before it starts

**#285 (split the CI job) should land first.** CI's main job is at 51 of 60 minutes. A fix wave adds tests, and a run cut off at the limit proves nothing.

## What I would audit, in this order

The order follows what costs most if wrong and what is cheapest to find.

### 1. What the retired template took with it (Sonnet)
This comes first because it is cheap and likely to find real gaps. Most of the repair-review's guest fixes were proved on `qr-phone`, which is now gone: its 15 files, including `connection.test.tsx`, `face.test.tsx` and `pay-panel.test.tsx`.
- Make a table: each guest-path row (RR-14, 26, 48 to 52, 58, 78, 89 and the observations on the guest page) against the test that now guards it on Editorial. A row with no guard is a finding.
- Read the other four deleted tests the same way: what did each one enforce, and where does that live now?

### 2. Money on screens that are new (Opus)
- **Pay first at Send with a tip.** The server side was tested only by direct calls until now, so this is its first screen. Check a failure between Send's two parts, a double tap, "Pay later", a tip above the amount, a tip where the POS can't take one, and what the guest is told each time.
- **Lines locked while unconfirmed** (RR-14) as Editorial draws them, and the bill and paying states on it.
- **The single-step Call a waiter,** all seven kinds.
- **An item sold out while in the bag or mid-pay** (decision 131 and rule 5), and the snapshot and overlay disagreeing about it.
- **The real Stripe card form** (`guest-pay-card.spec.ts`), which CI skips. This one needs Martin's OK for the sandbox, and it is the only real proof of the form and its venue look.

### 3. Old data meeting new code (Opus)
This has to be right before staging, and staging migrations can't easily be undone.
- **0045 on messy old data:** junk colours, half-set themes, missing menus. Every venue's record must then parse with the schema, and a guest must see the same look before and after the first real save.
- **The same migration with an owner that can't bypass row security,** the class of RR-44. CI still can't catch this (RR-O9).
- **A venue whose published snapshot still names `qr-phone`.** I found no remaining reference to it in the app's code, so what does its guest page show after a deploy and before a republish? Old snapshots with the new renderer in general.
- **Deploy order:** 0045, 0046 and 0047 in the order of the journal on `st/foundation`, because the merges renumbered them. 0046 drops `menus.settings` while the old web app may still be running.
- **Events with no node:** every reader of `events` (the item sheet, exports, the purge) now meets rows with no node.

### 4. Attack (Opus)
- **The new table and writes:** `design_styles` and the three actions, as another organisation, each role and the tablet.
- **Brand carry-over:** can a saved Style or a copied design carry another venue's logo or brand, or anything from the POS?
- **Hostile input:** every value that reaches the guest page. The stylesheet itself is constant, so the targets are the CSS variables, the data attributes, Style names and the values passed to Stripe's Appearance API.
- **The preview frame:** `/design/frame` says it reads no data and draws what the page around it holds. Confirm that by opening it signed out, from another organisation and as a lesser role, and check whether another site could frame the Design page.
- **Rules 3 and 4, by script:** scan published snapshots and the view model for POS ids, provenance and internal fields. Confirm the card form's look comes from the view model, and check the guest page's security headers.

### 5. Races (Sonnet)
Two saves at once (the revision check), a save during a publish, a saved Style's name taken twice at once, remove then Undo after the name is reused, and a stored Style holding an option a later contract removes. Loops that hold stay as tests.

### 6. Behaviour Martin won't look at (Sonnet, after his first notes)
His walk covers look and feel, so this covers the rest, with his notes used to avoid repeats:
- **Roles:** the Studio as manager, waiter, member and tablet.
- **Sizes:** 320 px and 200% text. RR-79 left the composer's sideways scroll "for the Studio"; is that now true?
- **Language and theme:** Bulgarian and dark mode.
- **Weight:** the guest page on a slow phone with 60 options, and My styles with 100 saved Styles (the tiles all render at once).
- **Readable combinations:** every Style with the option combinations an owner can reach.

### 7. Decisions against what landed (Sonnet, script first)
- Spec #168 and the twelve tickets' acceptance criteria, each against a test or a screen.
- Decisions 128 to 131.
- Whether each of the 60 options changes something on the page and exists in every Style.
- The guides and the glossary, and bg/en words.

### 8. Can the tests be trusted? (Sonnet)
- New browser specs repeated with retries off.
- **Are the 50,000 lines of renderings ever compared in CI?** `faces-visual` was among the switched-off specs in the repair-review (RR-O3). If it still is, those files guard nothing.
- A few deliberate breaks of `setDesign` and the Style writes, to see the tests go red.

## Known weak spots, as asked

| Weak spot | How it is treated |
|---|---|
| Real card form skipped by CI | Step 2, with Martin's OK |
| Card form has no venue font (#281) | Confirm it is open and is the only gap; not a new finding |
| CI at 51 of 60 minutes (#285) | Before the audit starts |
| My styles tiles all render at once | Measured in step 6 |

## What I would leave out

- **Whether the Styles look good:** Martin's walk and the template review judge that.
- **Reading the renderings:** they are generated. Step 8 only asks whether anything compares them.
- **What the repair-review covered,** unless this wave changed it: the worker's payment route, the Tonight screens, Settings.
- **`qr-phone` itself,** apart from step 1.
- **Real POSes, parked connectors, staging, production, real phones and Apple or Google Pay:** they stay on Martin's list from the repair-review.
- **Full Playwright and full test runs on this PC:** CI runs those.
- **A screen reader pass:** that needs a real device, so it stays a line for Martin.
- **New features or redesign:** proposals go to the observations list.

## After the audit

- **Fixes:** the Design lead's fixers build them and the audit lead reviews, so whoever judges a fix didn't build it. Pull requests go into `st/foundation`, label `designer-audit`.
- **Merging:** Martin's overnight OK covered repair-review fixes on `or/foundation` only, so this needs its own.
- **Report:** one page for Martin, as last time.

## One walk instead of two

The repair-review's hands-on script uses the test template, which `st/foundation` retires. Martin should walk it on `st/foundation` alongside the designer guide's section B, so he doesn't test ordering and paying twice on a page that is going away. Sections 2 to 6 of that script still apply as they are.
