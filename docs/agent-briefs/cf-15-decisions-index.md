# Brief CF-15: `docs/decisions.md`, a one-page index of the decisions in force and the open tasks

- **Model:** Sonnet 5.5.
- **Branch:** create `cf/15-decisions-index` from `cf/foundation` yourself.
- **Why** (Martin 10-11): every agent read the whole tracker (101 KB) before starting, and carried it through hundreds of steps. Agents now read a short index instead, and look up the full text of a decision only by its number (CLAUDE.md, "Read before any task").

## What to write: `docs/decisions.md`

Target about 10–12 KB. Plain, precise English, the tracker's own terms.

**1. Header (3 lines).** What the file is. The tracker holds the full text and wins on any difference. Look up `| D<n> |` or `T<n>.` there.

**2. Decisions in force:** a table `| ID | Decision | Status |`, one row per decision **D1–D72**, in number order.
- **Decision:** one sentence of at most about 25 words with the binding content. Keep numbers, names and limits that an agent must obey: e.g. "at most one Opus agent at once", "Thu–Sun 18:00–08:00 no deploys", "EUR only", "no barsy writes until …".
- **Status:** `firm`, `applied`, `pending`, `superseded by D<n>` or `refined by D<n>`, as the tracker says.
- **Superseded decisions:** keep their row, marked superseded, so the numbering has no gaps.
- **Missing rows:** if a number has no row, say "no row in the tracker".

**3. Open questions:** one line each for the open `Q` items in the tracker's "Open questions": ID, the question in a few words, its owner if named.

**4. Open tasks:** one line each for every unchecked task (`- [ ] T<n>`): ID, title in a few words, owner, and current state in a few words (e.g. "SH-05a running", "waits for docs").

**5. Rules this index does not repeat:** one line pointing to CLAUDE.md, which holds the nine rules and the import boundaries.

## How

1. **Read** `docs/tracker.md` once, in chunks.
2. **Check** with a small script (in your scratchpad, not the repo) that every `| D<n> |` row and every `- [ ] T<n>` line of the tracker has its line in your index. Report the counts.
3. **Wording:** where a decision's wording is long or has several parts, keep the parts an agent must obey. If you are unsure what binds, quote the tracker's own words rather than paraphrase.
4. **Do not edit** `docs/tracker.md` or any other file. The lead keeps both up to date from now on.

## Done when

- `pnpm lint` passes. Markdown is not linted, but the gate must stay green.
- **Report** (at most one page):
  - branch and commit;
  - the counts (decisions, open questions, open tasks) and that the script found every row;
  - the decisions whose wording you were least sure of, by ID.

## Never

- **Code:** no code changes.
- **Secrets:** never read `.env.local`.
- **Files:** LF.
- **Git:** commit with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never push.
