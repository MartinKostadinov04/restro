# Lane 1 (Studio) hand-over

Updated 2026-11-19. Branch `sr/lane1-studio` (local, ledger committed at 2747bb79, not pushed yet).

## Done
- Ledger `findings.md`: explorer (Sonnet) S1–S22, code check (Fable) S23–S26, security check (Fable) S27–S29, manager walk note. Raw check outputs in `code-check.md`, `security-check.md`.
- Database reset after the explorer (fresh ids: Demo Club Sofia `vn_2Qsr113cDIvfQor8P5yiuO`, Demo Bar `vn_6uS8gzSr8d9y2gUqJODpSh`, Club Biad Sofia `vn_1edUqbUKzDxB2zkrLDzooS`); pane signed in as owner@demo-club.test.
- Opus reviewer (step 4) started blind with the ledger path and commit 2747bb79.

## Next
1. Save the reviewer's verdicts and fix plan into `findings.md`; stop web/worker/sim (shared Postgres process limit).
2. Code the fix bundles (Opus), PR(s) into `sr/foundation`; `pnpm lint && pnpm typecheck && pnpm deps:check`; changed tests only.
3. Per PR: Opus `code-review high <PR>`, Opus `security-review`, Opus `pr-review-toolkit:review-pr`; fix; CI green.
4. Restart services, re-check walker (Opus) → `re-verified`; stop services; rebase; READY; final report with the Skills run table.

## Skills run so far
| Skill | Target | Model | Result |
|---|---|---|---|
| screen-review step 2 | Studio scope, both venues | Sonnet | 22 candidate rows |
| code-review (high) | Studio paths + core apply | Fable | 10 found, 4 confirmed (S23–S26) |
| security-review + audit-security.md | Studio paths + core apply | Fable | 3 low (S27–S29), no high/medium |
| screen-review step 4 | ledger @2747bb79 | Opus | running |

Open question for the lead: the seed's venue «Мениджър» is an organisation member, so it can change nothing in Studio (no sold-out, no hide). Audit-behaviour's manager persona ("sold out, hide, publish") expects otherwise.
