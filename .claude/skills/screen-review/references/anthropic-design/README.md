# Vendored: Anthropic design-critique, accessibility-review, ux-copy

Verbatim copies of three `SKILL.md` files from Anthropic's `design` plugin, and the repository's licence (Apache 2.0), kept only as the critique layer of `screen-review` (D146). They are not skills of their own: these folders have no skill entry, so their triggers ("what do you think of this screen?", "is this accessible?", "what should this button say?") can never fire by themselves.

- **Source:** https://github.com/anthropics/knowledge-work-plugins, folder `design/skills/<name>/SKILL.md`; `LICENSE` from the repository root (the `design/` folder has none).
- **Folder last changed in:** `c71b6f3082b1e5ace3d1a9e30ac9205934134c9c` (2026-09-21); the copies were fetched at that commit.
- **Checked against:** the installed plugin `design` 1.2.0 (identical text) and the commit D123 read (`bc8f6922`, identical).
- **Copied:** 2026-11-18.
- **Edits:** none. Restro's changes live in `../design.restro-overrides.md`, which wins on every conflict. The copies link `../../CONNECTORS.md`, which is not vendored: the overrides switch every connector step off.
- **Not vendored:** `design-handoff` (the fix plan uses `ship.md`'s ticket and screen plan, which already carry its states list, D123), `design-system`, `user-research`, `research-synthesis` (parked by D123 until their triggers).
- **Updates:** only through an Upkeep ticket: diff the new upstream commit against these files, review the new lines against the overrides, then change the hash above.
