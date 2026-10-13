'use client'

// "Advanced" in the colour card (briefs SH-05a and S7; D70, D93; the designer's handover §10 says
// what each role paints): the colours worked out for the guest, for a light and a dark screen side
// by side, collapsed until the person wants them. Each has a swatch, its name in plain words, the
// contrast of every pair it is part of, "Adjust" to set it by hand and "Reset" to hand it back. A
// colour set by hand that does not read is shown in red with the pair that fails, and the tab
// blocks Save while any pair fails. The light screen's page, panels and highlight are the three
// pickers above, so their cells are not repeated here; the dark screen's are.
//
// The ten roles D93 added (status, disabled text, the selected fill, the focus ring, the sheet
// backdrop, the strong border) are shown with their contrast and cannot be set by hand: core's
// look takes overrides of the eight base roles only.
import {
  contrastRatio,
  EXTENDED_ROLE_NAMES,
  type ExtendedRoleName,
  type PairIssue,
  ROLE_MODES,
  type RoleMode,
  type RoleName,
  type ThemeRoleSet,
} from '@restro/core'
import { ChevronDownIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { resolveAdminLocale } from '@/i18n/locales'
import { cn } from '@/lib/utils'

import { HexField } from './hex-field'
import {
  clearAllOverrides,
  clearOverride,
  isOverridden,
  type LookState,
  pairsOfExtendedRole,
  pairsOfRole,
  setOverride,
  shownRatio,
} from './look-state'

/** A contrast ratio in the interface language's number style, e.g. `4,5` or `4.5`. */
export function useRatioFormat(): (ratio: number) => string {
  const locale = resolveAdminLocale(useLocale())
  const format = new Intl.NumberFormat(locale === 'bg' ? 'bg-BG' : 'en-GB', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })
  return (ratio) => format.format(shownRatio(ratio))
}

/** One pair that does not read, in words: "Light screen: Text on Page 3,2:1, needs 4,5:1". */
export function useIssueText(): (issue: PairIssue) => string {
  const t = useTranslations('design.roles')
  const ratio = useRatioFormat()
  return (issue) =>
    t('unreadableItem', {
      screen: t(`screens.${issue.mode}`),
      fg: t(`${issue.fg}.name`),
      bg: t(`${issue.bg}.name`),
      ratio: ratio(issue.ratio),
      min: ratio(issue.min),
    })
}

/** The roles that can be set by hand, in the order Advanced lists them. */
const ADJUSTABLE_ROLES = [
  'text',
  'muted',
  'on_accent',
  'accent_text',
  'border',
  'background',
  'surface',
  'accent',
] as const satisfies readonly RoleName[]

/** The roles whose light screen colour is one of the three pickers above, not repeated here. */
const PICKED_ROLES: ReadonlySet<RoleName> = new Set(['background', 'surface', 'accent'])

/** What the alert says when pairs do not read: shown in the colour card, open or collapsed. */
export function UnreadableAlert({ issues }: { issues: readonly PairIssue[] }) {
  const t = useTranslations('design.roles')
  const issueText = useIssueText()
  if (issues.length === 0) return null
  return (
    <div
      role="alert"
      className="grid gap-1 rounded-md border border-destructive bg-destructive/5 p-3 text-sm text-destructive"
      data-testid="design-unreadable"
    >
      <p className="font-medium">{t('unreadableTitle')}</p>
      <ul className="list-disc pl-5">
        {issues.map((issue) => (
          <li
            key={`${issue.mode}-${issue.fg}-${issue.bg}`}
            data-issue={`${issue.mode}:${issue.fg}-on-${issue.bg}`}
          >
            {issueText(issue)}
          </li>
        ))}
      </ul>
      <p className="text-xs">{t('unreadableHelp')}</p>
    </div>
  )
}

/** One role on one screen: its colour, the contrast of its pairs, and the way to set it by hand. */
function RoleCell({
  mode,
  role,
  state,
  roles,
  derived,
  issues,
  invalid,
  canEdit,
  adjustable,
  onChange,
}: {
  mode: RoleMode
  role: RoleName | ExtendedRoleName
  state: LookState
  roles: ThemeRoleSet
  derived: ThemeRoleSet
  issues: readonly PairIssue[]
  invalid: boolean
  canEdit: boolean
  /** False for the roles D93 added: shown, not set by hand. */
  adjustable: boolean
  onChange: (next: LookState) => void
}) {
  const t = useTranslations('design.roles')
  const ratio = useRatioFormat()
  const id = useId()
  const [editing, setEditing] = useState(false)
  const colour = roles[mode][role]
  if (colour === undefined) return null
  const base = adjustable ? (role as RoleName) : null
  const overridden = base !== null && isOverridden(state, mode, base)
  const list = base !== null ? pairsOfRole(base) : pairsOfExtendedRole(role as ExtendedRoleName)
  const pairs = list.map((pair) => {
    const own = roles[mode][pair.fg]
    const other = roles[mode][pair.bg]
    const value = own !== undefined && other !== undefined ? contrastRatio(own, other) : null
    return {
      ...pair,
      value,
      ok: !issues.some((i) => i.mode === mode && i.fg === pair.fg && i.bg === pair.bg),
    }
  })
  const failing = pairs.some((pair) => !pair.ok)
  const showEditor = canEdit && base !== null && (editing || invalid)
  const roleName = t(`${role}.name`)
  const screenName = t(`screens.${mode}`)

  return (
    <div
      className={cn(
        'grid content-start gap-2 rounded-md border p-2.5',
        (failing || invalid) && 'border-destructive bg-destructive/5',
      )}
      data-testid={`role-${mode}-${role}`}
      data-failing={failing || invalid ? 'true' : undefined}
    >
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {screenName}
      </p>
      <div className="flex items-center gap-2">
        <span
          className="size-8 shrink-0 rounded-md border"
          style={{ backgroundColor: colour }}
          role="img"
          aria-label={t('swatch', { role: roleName, colour })}
        />
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <code className="font-mono text-xs">{colour}</code>
          {overridden ? (
            <Badge variant="outline" data-testid="role-adjusted">
              {t('adjusted')}
            </Badge>
          ) : null}
        </div>
      </div>

      {pairs.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('pairsLabel', { role: roleName })}>
          {pairs.map((pair) => (
            <li
              key={`${pair.fg}-${pair.bg}`}
              data-pair={`${pair.fg}-on-${pair.bg}`}
              data-ok={pair.ok ? 'true' : 'false'}
              className={cn(
                'rounded-md border px-2 py-0.5 text-xs',
                pair.ok
                  ? 'text-muted-foreground'
                  : 'border-destructive font-medium text-destructive',
              )}
            >
              {pair.value === null
                ? t(`${pair.other}.name`)
                : t('pair', { other: t(`${pair.other}.name`), ratio: ratio(pair.value) })}
              {pair.ok ? null : ` · ${t('needs', { min: ratio(pair.min) })}`}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t('noPairs')}</p>
      )}

      {showEditor && base !== null ? (
        <div className="grid gap-1">
          <HexField
            id={`${id}-hex`}
            value={state.overrides[mode][base] ?? colour}
            onChange={(text) => onChange(setOverride(state, mode, base, text))}
            pickerLabel={t('picker', { role: roleName, screen: screenName })}
            label={t('hex', { role: roleName, screen: screenName })}
            fallback={colour}
            invalid={invalid}
            describedBy={invalid ? `${id}-invalid` : undefined}
          />
          {invalid ? (
            <p id={`${id}-invalid`} role="alert" className="text-xs text-destructive">
              {t('invalid')}
            </p>
          ) : null}
        </div>
      ) : null}

      {canEdit && base !== null ? (
        <div className="flex flex-wrap gap-2">
          {editing || invalid ? null : (
            <Button
              type="button"
              variant="outline"
              size="xs"
              aria-label={t('adjustAria', { role: roleName, screen: screenName })}
              onClick={() => setEditing(true)}
            >
              {t('adjust')}
            </Button>
          )}
          {editing && !invalid ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => setEditing(false)}>
              {t('done')}
            </Button>
          ) : null}
          {overridden ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t('resetAria', { role: roleName, screen: screenName })}
              onClick={() => {
                setEditing(false)
                onChange(clearOverride(state, mode, base))
              }}
            >
              {t('reset')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {overridden && base !== null && derived[mode][base] !== colour ? (
        <p className="text-xs text-muted-foreground">
          {t('derivedWas', { colour: derived[mode][base] })}
        </p>
      ) : null}
    </div>
  )
}

export function AdvancedColours({
  state,
  roles,
  derived,
  issues,
  invalid,
  canEdit,
  onChange,
}: {
  state: LookState
  /** The roles to draw (the last that were valid, while a box holds half a colour). */
  roles: ThemeRoleSet
  derived: ThemeRoleSet
  issues: readonly PairIssue[]
  /** Fields that are not colours yet. */
  invalid: readonly string[]
  canEdit: boolean
  onChange: (next: LookState) => void
}) {
  const t = useTranslations('design.roles')
  const [open, setOpen] = useState(false)
  // A pair that does not read keeps the list open: that is where it is named and fixed.
  const shown = open || issues.length > 0
  const anyOverride = ROLE_MODES.some((mode) => Object.keys(state.overrides[mode]).length > 0)
  const withExtended = roles.light.error !== undefined || roles.dark.error !== undefined

  return (
    <Collapsible open={shown} onOpenChange={setOpen} data-testid="design-advanced">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="outline" size="sm" data-testid="design-advanced-toggle">
            {t('advanced')}
            <ChevronDownIcon aria-hidden className={shown ? 'rotate-180' : undefined} />
          </Button>
        </CollapsibleTrigger>
        {shown && canEdit && anyOverride ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange(clearAllOverrides(state))}
          >
            {t('resetAll')}
          </Button>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t('help')}</p>
      <CollapsibleContent>
        <div className="@container mt-4 grid gap-4" data-testid="design-roles">
          <ul className="grid gap-3">
            {ADJUSTABLE_ROLES.map((role) => {
              const modes = PICKED_ROLES.has(role) ? (['dark'] as const) : ROLE_MODES
              return (
                <li
                  key={role}
                  className="grid gap-2 rounded-lg border p-3"
                  data-testid={`design-role-${role}`}
                >
                  <div>
                    <p className="text-sm font-medium">{t(`${role}.name`)}</p>
                    <p className="text-xs text-muted-foreground">{t(`${role}.help`)}</p>
                    {PICKED_ROLES.has(role) ? (
                      <p className="text-xs text-muted-foreground">{t('lightFromPickers')}</p>
                    ) : null}
                  </div>
                  <div className="grid gap-2 @md:grid-cols-2">
                    {modes.map((mode) => (
                      <RoleCell
                        key={mode}
                        mode={mode}
                        role={role}
                        state={state}
                        roles={roles}
                        derived={derived}
                        issues={issues}
                        invalid={invalid.includes(`${mode}.${role}`)}
                        canEdit={canEdit}
                        adjustable
                        onChange={onChange}
                      />
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>

          {withExtended ? (
            <div className="grid gap-3" data-testid="design-more-roles">
              <div>
                <h4 className="text-sm font-medium">{t('more.title')}</h4>
                <p className="text-xs text-muted-foreground">{t('more.help')}</p>
              </div>
              <ul className="grid gap-3">
                {EXTENDED_ROLE_NAMES.map((role) => (
                  <li
                    key={role}
                    className="grid gap-2 rounded-lg border p-3"
                    data-testid={`design-role-${role}`}
                  >
                    <div>
                      <p className="text-sm font-medium">{t(`${role}.name`)}</p>
                      <p className="text-xs text-muted-foreground">{t(`${role}.help`)}</p>
                    </div>
                    <div className="grid gap-2 @md:grid-cols-2">
                      {ROLE_MODES.map((mode) => (
                        <RoleCell
                          key={mode}
                          mode={mode}
                          role={role}
                          state={state}
                          roles={roles}
                          derived={derived}
                          issues={issues}
                          invalid={false}
                          canEdit={canEdit}
                          adjustable={false}
                          onChange={onChange}
                        />
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
