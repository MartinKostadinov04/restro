# Lane 6, step 0: code check of today's navigation

Fable subagent, 2026-11-18/19. `Skill(code-review, "high <navigation paths>")` (10 findings: 7 navigation or guard defects, 3 cleanups), then the cited code read end to end. Nothing run or changed. No Blocking.

| Id | Severity | Where | Defect | Scenario | Fix | Verified |
|---|---|---|---|---|---|---|
| C1 | Before the pilot | `apps/web/src/components/admin/workspace-tabs.tsx:62` | `useUrlTab.select` copies every other query parameter on a tab change, so `day`, `view`, `guest`, `connection` leak into a tab that reads the same names. | `?tab=tonight&view=log&day=2026-11-10` → Reservations → opens on the past night with `view=log`. | Drop the other tab's parameters when the venue tab changes. | yes |
| C2 | Before the pilot | `apps/web/app/(admin)/layout.tsx:33-34` | On a shared device the sidebar still gets the organisation list with a live switcher (same as S1). | Tablet account in two organisations switches → no device row in B → Studio and Settings open. | Pass only the active organisation on a device; refuse the switch server-side. | layout yes, escalation plausible |
| C3 | Before the pilot | `apps/web/app/(admin)/settings/layout.tsx:36` | The shared-device block for organisation Settings is only in the layout (same as S2). | Device opens `/settings/integrations`; the page's reads still run. | Check in each page via one helper. | missing checks yes |
| C4 | Before the pilot | `apps/web/app/(admin)/venues/page.tsx:39` | A staff-only sign-in is redirected off `/venues`, yet "All venues", the logo link and the "Venues" breadcrumb are still drawn. | Waiter taps "All venues" → lands back on a landing tab. | Hide those links for a staff landing. | yes |
| C5 | Before the pilot | `apps/web/src/components/admin/app-sidebar.tsx:60` | The phone sidebar sheet closes only when the pathname changes. | Below 768 px, tap the venue already open → sheet stays open. | Close on the link's click too. | yes |
| C6 | Before the pilot | `apps/web/src/components/admin/workspace-tabs.tsx:97` | Radix automatic activation: arrow keys along the tab bar navigate on every tab passed. | Arrow from Studio to Settings → four server renders. | `activationMode="manual"`. | yes |
| C7 | Polish | `workspace-tabs.tsx:54-60` | `asked.current` can go stale. | Race between two replaces. | Goes away with C6. | plausible |
| C8 | Before the pilot | `apps/web/app/(admin)/venues/[venueId]/page.tsx:59` | No `not-found.tsx` / `error.tsx` under `app/`: a 404 is Next's bare English page outside the frame. | Deleted venue still listed → bare "404". | Add `(admin)/not-found.tsx` and `error.tsx`. | yes |
| C9 | Polish | `workspace-tab-defs.ts:87` | Legacy and unoffered `?tab=` values resolve silently; the URL keeps the stale value. | `?tab=publishing` opens General, not Publish. | Redirect on the server to the canonical address. | yes |
| C10 | Polish | `[venueId]/page.tsx:81-125` | Five reads awaited one after another per tab click; `onSharedDevice` uncached, run 2–3 times per request. | Each tab switch waits on serial round trips. | `Promise.all`; `cache()` around `onSharedDevice`. | yes |
| C11 | Polish | `workspace-tabs.tsx:153`, `settings-sections.ts:46` | `isWorkspaceTabValue` duplicates `isWorkspaceTab`; two different exported `settingsSectionOf`. | Wrong auto-import compiles by luck. | Delete the duplicate; rename one. | yes |

Sound: the shared-device redirect has no loop; `composer` → `studio` keeps parameters; Reservations hidden without the right.
