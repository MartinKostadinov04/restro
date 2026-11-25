# How editing the menu design should work: the simplest model

Made by: proposal subagent (Opus), 2026-10-27, for the menu designer grilling (decision log row 1.9, D104's "I don't know" step 2). An opinion, put to Martin as a grilling question; it binds nothing.

## 1. Recommendation (a "yes" accepts it)

1. **Picking a Style fills in every setting from that Style.** Your colours, fonts and logo stay as you set them.
2. **After that, change anything you like.** The phone preview updates at once, and Undo takes back your last step.
3. **Done saves the whole design and Cancel throws away everything since you opened it.** Guests see a saved design after your next Publish.
4. **There is no reset button for single settings.** To start over, pick the Style again; Undo brings your changes back.
5. **Every venue's saved design shows under "My menu designs" with the venue's name.** Copy takes a one-time copy that you can then change. Our later changes to a Style, or new options we add, never change a design you have saved.

## 2. The three models weighed

**A. "A Style is a starting point that gets copied in" (recommended)**
- **What the owner sees:** the design opens as a draft. Picking a Style while they have their own changes replaces those changes in the preview right away, and an undo toast appears: "Switched to Soft. Your own changes were replaced. Undo." No confirmation dialog, because the switch can be undone (D107). The Style picker can show "Editorial · edited" so the owner knows that picking it again means starting over.
- **Done and Cancel:** Done saves the whole draft in one go. Cancel goes back to the last saved design. This replaces today's three save paths: the whole-look save, the template saving the moment it is chosen, and the header name's own Save (current-designer map §5). Guest functions keep their own card (inventory §3).
- **Reset for one setting:** none. The ways back are Undo, Cancel and picking the Style again.
- **Saving a design to reuse:** the venue's saved design is listed automatically under its name, which reads decision 1.6 literally. That removes the need for a separate "save as my style" step, which adds a named object people must rename and delete. Copy from Venue 1 takes Venue 1's design as it is at that moment, with no link back. (Inferred: whether the logo comes along with the copy is a small open point.)
- **What is stored:** one complete design per venue, holding a value for every setting, a revision number, and the name of the Style it came from (for display only).
  - **A new option later:** each stored design gets the value that draws exactly what it draws today, so its look is unchanged. Presets get their own value for venues that pick them afterwards.
  - **Changing a preset's values later:** only affects venues that pick that Style afterwards.
  - **Moving today's venues over:** they get a one-time copy of the Editorial Market values (inventory §6 Q1).
- **Two people editing at once:** Done sends the revision the draft started from. If the stored revision has moved on, the owner sees "Someone else changed this design while you were editing", with two choices: keep mine, or load theirs. No locks, no live sync. Today there is no check at all and the last writer wins (map §5).
- **Pros:** matches what owners already know (Shopify's preset overwrites the current settings and has no per-setting reset; Squarespace's preset packs change fonts, colours and buttons and stay editable; Flipdish's Discard goes back to the last save; market scan §Q2). What you see is what is stored. "A new option never changes an existing look" holds without extra machinery.
- **Cons:** improvements we make to a Style do not reach venues already using it. Switching Style loses your Advanced changes; only Undo or Cancel brings them back.
- **What breaks "simple":** nothing, if the Style picker stays on one line.

**B. Layered differences (the passport model)**
- **What the owner sees:** dots marking settings changed here, per-setting reset, a count of changes, "Reset to preset". Switching Style keeps the owner's changes on top of the new Style.
- **What is stored:** the Style's name plus only the settings that differ from it. A new option later inherits whatever the preset or base value is; for an existing look to stay the same, that value has to equal the old behaviour. Changing a preset's values later silently changes the live look of every venue on that Style unless presets are versioned.
- **Pros:** the smallest storage; Style improvements reach every venue.
- **Cons:** the owner has to understand "inherited". The passport needed dormant values, different override rules per layer, Redis locks per category and a 2,252-line shared editor to make it work (studio map §2, §6).
- **What breaks "simple":** this is the model Martin rejected (decision log 1.9).

**C. Follow a Style, or detach from it**
- **What the owner sees:** a venue either follows a Style exactly, with only its own colours and fonts, and picks up our improvements to that Style; or the first Advanced change turns it into "Custom (from Editorial)", a full copy as in A.
- **What is stored:** either a Style name plus colours and fonts, or a full copy.
- **Pros:** venues that never change anything beyond colours and fonts get our improvements.
- **Cons:** two states that need explaining; a guest-visible change the owner never chose, arriving at their next publish, which breaks "once people hit Done it changes and that's it".
- **What breaks "simple":** the moment the venue silently becomes "detached".

## 3. What would change the recommendation

- Martin wants our Style improvements to reach venues automatically: then C, or B with versioned presets.
- Owners in testing often switch Style and are upset to lose their changes: then carry the Advanced changes over on a switch, which means storing differences (B again).
- Organisations want one master design that updates all their venues: that needs a linked layer, not a one-time copy.
- Several staff often edit the design at the same time: then save each page on its own instead of the whole design at once.

## 4. Confidence

- **High** on storing a full copy, Done/Cancel over a draft, and one revision check. Every simple model in the market scan works this way. It is the only model where "a new option never changes an existing look" holds without versioning presets, and it removes the passport machinery Martin rejected.
- **Medium** on the smaller points: what a Style switch keeps (colours, fonts and logo, Simple's own controls; the inventory's §5 also keeps screen and corners, so the two need aligning); listing every venue's design automatically instead of a named "save as my style"; whether a copy brings the logo along.
- **Inferred, not from the files:** the wording of the undo toast and the conflict message; keeping the draft only in the browser with a warning when leaving (the passport keeps a local copy after a crash; left out for simplicity).

**Out of scope, worth a follow-up:** today the code that saves the design writes the venue settings directly, not through `core.apply(changeSet)`, and records no history (map §5, §7). The new single Done save should be built on rule 1 from the start.
