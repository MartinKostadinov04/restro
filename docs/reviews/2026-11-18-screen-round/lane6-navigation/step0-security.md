# Lane 6, step 0: security check of today's navigation and role gating

Fable subagent, 2026-11-18. `Skill(security-review)` on the navigation paths, plus `.claude/skills/restro-flow/audit-security.md`'s checklist, statically. Nothing run or changed; `pnpm audit`, fuzzing and abuse steps not run.

## Threat model

| | |
|---|---|
| Assets | Each organisation's venues, menus and designs; organisation Settings (name, address name, POS connections, deleted venues); venue Settings (staff, PINs, alerts, paying); table codes; the Log |
| Actors | Signed-out visitor; user of organisation B; plain member or waiter on a personal sign-in; shared device (session of an account that may be an owner); admin trying owner-only pages |
| Entry points | `proxy.ts`; `/venues/[venueId]?tab=&section=`; `/venues/[venueId]/design` and `/design/frame`; `/settings/*`; `switchOrganization`; `/login?next=` |

## Findings

| Id | Severity | Where | Defect | Reproduction | Fix | Confirmed |
|---|---|---|---|---|---|---|
| S1 | medium | `apps/web/src/server/actions.ts:15`, `apps/web/src/server/staff/shared-device.ts:12` | A shared device stops being a device once its session switches organisation: the device row is looked up under the active tenant only, and `switchOrganization` never asks whether the session is a device. | A tablet at organisation A, signed in with an account that also belongs to B, uses the organisation switcher (still drawn on a device). In B, `onSharedDevice` finds nothing; an owner account then has Studio, Settings and Publish without a PIN. | Refuse `switchOrganization` on a device session and hide the switcher there; add an attack row in `shared-device-admin.test.ts`. | yes (code end to end) |
| S2 | low | `apps/web/app/(admin)/settings/{general,integrations,deleted-venues}/page.tsx` | The three organisation Settings pages never check for a shared device; only `settings/layout.tsx` withholds them, and a layout is not a guard. | A shared device on an owner's account requests `/settings/integrations` as a segment fetch; if served without the layout, it reads connection names and sync history. Writes are refused. | Check `onSharedDevice` in each page (one helper) and redirect to Tonight. | missing check yes; whether the segment is served needs a running app |
| S3 | low | `apps/web/app/(admin)/layout.tsx:23-36` | On a shared device the sidebar lists every venue of the organisation. | Venue 2's tablet opens venue 1's Tonight and sees its name and guest address; the engine refuses the night's data. | On a device, pass only the device's venue to the sidebar. | yes |
| S4 | low, needs a decision | `apps/web/app/(admin)/venues/[venueId]/page.tsx:236-370` | The read side of most Settings sections takes no actor: any member reads them at any venue, including one where they hold no role. | A waiter assigned to venue 1 opens `/venues/<venue 2>?tab=settings&section=paying` and sees it read-only. | Record "everyone may look" as decided, or offer Settings only with a permission at that venue. | yes |

## Checked and sound
Tenancy comes from the session's membership (B gets 404 on A's venue and Design page); `?section=staff|alerts` and `?tab=reservations` fall back on the server without the right; `/settings/deleted-venues` is owner-only; a shared device is redirected from Studio, Tables, Settings and Design; `proxy.ts` and `safeNextPath` keep redirects on our host; URLs carry only our ids.
