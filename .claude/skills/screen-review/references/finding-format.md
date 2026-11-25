# Screen-review findings: the ledger, the row and the severity words

One ledger per round: `docs/reviews/<yyyy-mm-dd>-screens-<area>/findings.md`, with the screenshots beside it in the same folder (`<id>-before.<ext>`, `<id>-after.<ext>`, keeping the browser tool's file type, usually `.jpg`). Ids are `S<n>`, never reused in a round.

## The row

```
### S<n>. <one line: what is wrong, in the persona's words>
- Kind: bug | optimisation | simplification
- Screen: <route>, <persona>, <viewport px>, <light|dark>, <bg|en>
- Steps: <how to see it again, one line>
- Expected: <what should happen, and the rule or D-number that says so>
- Saw: <what happened>
- Check: <the check it breaks: an operational-screens.md question or section, a copy-rules.md rule, a WCAG 2.2 criterion, the Restro 44 px floor, a §7.5 rule, a D-number, or design-critique 2 / 4>
- Evidence: <screenshot file, selector, console line, or request>
- Proposal: <the fix in one or two lines; strings in Bulgarian and English>
- Status: candidate
```

The reviewer adds:

```
- Verdict: confirmed | rejected — <reason; a rejected row stays>
- Severity: Blocking | Before the pilot | Polish
- Effort: S | M | L
- Decision: none | contradicts D<n>
- Needs Martin's yes: yes | no
- Fix: <ticket bundle id in the fix plan>
```

A row without Evidence is not written. A speed row (`optimisation` from the browser on the dev server) is at most Polish and carries "dev server" in Evidence unless CI's production build shows the same.

## Severity (the 11-10 walk's words)

- **Blocking:** wrong figures, lost money, a dead end, or one of the rules in `CLAUDE.md` broken.
- **Before the pilot:** it works, but it is confusing, slow, too many taps, or the wrong word.
- **Polish:** a small ugliness.

Where a row is an opinion about design rather than a fault, it says so in Saw.

## Status

`candidate` (explorer) → `confirmed` or `rejected` (reviewer) → `ticket` (lead files it) → `fixed` (its pull request merged) → `re-verified` (re-walked by a session that did not write the fix, with the after screenshot). Only `re-verified` closes the issue.

## At the end of the ledger

- **Works:** one line per screen (what a guest or owner would keep as it is).
- **Could not see:** the `device` lines for Martin's phone (one-handed reach, glare in a dark room, the keyboard over a field, a screen reader, a real slow connection).
