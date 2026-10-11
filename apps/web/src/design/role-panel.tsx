'use client'

// The eight colour roles, worked out for a light and a dark screen and shown side by side (brief
// SH-05a, D70; the designer's handover §10 says what each role paints). Each role has a swatch,
// its name in plain words, the contrast of every pair it is part of (`REQUIRED_PAIRS`), "Adjust"
// to set it by hand and "Reset to derived" to hand it back. A colour set by hand that does not
// read is shown in red with the pair that fails, and the tab blocks Save while any pair fails.
import {
  contrastRatio,
  type PairIssue,
  ROLE_MODES,
  ROLE_NAMES,
  type RoleMode,
  type RoleName,
  type ThemeRoleSet,
} from '@restro/core'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { resolveAdminLocale } from '@/i18n/locales'
import { cn } from '@/lib/utils'

import { HexField } from './hex-field'
import {
  clearOverride,
  isFromPreset,
  isOverridden,
  type LookState,
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
  onChange,
}: {
  mode: RoleMode
  role: RoleName
  state: LookState
  roles: ThemeRoleSet
  derived: ThemeRoleSet
  issues: readonly PairIssue[]
  invalid: boolean
  canEdit: boolean
  onChange: (next: LookState) => void
}) {
  const t = useTranslations('design.roles')
  const ratio = useRatioFormat()
  const id = useId()
  const [editing, setEditing] = useState(false)
  const colour = roles[mode][role]
  const overridden = isOverridden(state, mode, role)
  const pairs = pairsOfRole(role).map((pair) => {
    const value = contrastRatio(roles[mode][pair.fg], roles[mode][pair.bg])
    return {
      ...pair,
      value,
      ok: !issues.some((i) => i.mode === mode && i.fg === pair.fg && i.bg === pair.bg),
    }
  })
  const failing = pairs.some((pair) => !pair.ok)
  const showEditor = canEdit && (editing || invalid)
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
              {isFromPreset(state, mode, role) ? t('fromPreset') : t('adjusted')}
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
              {t('pair', { other: t(`${pair.other}.name`), ratio: ratio(pair.value) })}
              {pair.ok ? null : ` · ${t('needs', { min: ratio(pair.min) })}`}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">{t('noPairs')}</p>
      )}

      {showEditor ? (
        <div className="grid gap-1">
          <HexField
            id={`${id}-hex`}
            value={state.overrides[mode][role] ?? colour}
            onChange={(text) => onChange(setOverride(state, mode, role, text))}
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

      {canEdit ? (
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
                onChange(clearOverride(state, mode, role))
              }}
            >
              {t('reset')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {overridden && derived[mode][role] !== colour ? (
        <p className="text-xs text-muted-foreground">
          {t('derivedWas', { colour: derived[mode][role] })}
        </p>
      ) : null}
    </div>
  )
}

export function RolePanel({
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
  const issueText = useIssueText()

  return (
    <div className="@container grid gap-4" data-testid="design-roles">
      <div>
        <h4 className="text-sm font-medium">{t('title')}</h4>
        <p className="text-xs text-muted-foreground">{t('help')}</p>
      </div>
      {issues.length > 0 ? (
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
        </div>
      ) : null}
      {/* One row per role, the light and the dark screen side by side (one under the other on a
          narrow panel). */}
      <ul className="grid gap-3">
        {ROLE_NAMES.map((role) => (
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
                  invalid={invalid.includes(`${mode}.${role}`)}
                  canEdit={canEdit}
                  onChange={onChange}
                />
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
