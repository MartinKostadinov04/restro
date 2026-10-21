# Restro interface copy rules

Restro's own rules for interface text, in Bulgarian and English. They replace the "Content & Copy" section Vercel's guidelines had, which the pinned copy drops. They apply to every string the reviewer sees in a template, an admin screen or a pull request.

1. **Sentence case** in both languages: "Save changes", "Запази промените". No Title Case.
2. **Active voice, plain verbs.** The button says what happens: "Publish", not "Submit".
3. **One name per action.** The button "Publish" leads to the message "Published", in the same words through the whole flow.
4. **An error names the fix.** What went wrong, and what to do next; no apology, no "Something went wrong".
5. **An empty screen invites the next action** instead of stating the emptiness.
6. **Numerals for counts** ("3 items", "3 артикула"), including under ten.
7. **Quotation marks follow the language:** „…“ in Bulgarian, “…” in English; an ellipsis is "…", not "...".
8. **Domain words from `GLOSSARY.md`**: "item", "section", "sold out", never "product", "category", "out of stock". An owner-facing string names the POS with `{source}` (D82).
9. **Every string goes through next-intl** (admin) **or the shell's `GuestStrings` and `ServiceStrings`** (a template), in both languages, with the Bulgarian written for a Bulgarian reader rather than translated word for word.
10. **Menu text is never typed into code**: it comes from the view model's `localized_text`.
11. **A confirmation dialog names the action and its consequence** (the few D107 keeps): the question says what will happen ("Delete this venue for good?"), the body says the consequence and whether and where it can be undone, and the buttons say the action ("Delete venue" / "Keep venue"), never OK / Cancel.
