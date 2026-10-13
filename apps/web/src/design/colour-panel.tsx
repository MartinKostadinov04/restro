'use client'

// The colour part of the Design tab (briefs SH-05a and S7; D70, D92, D93): brand-first. The card
// starts with "Your brand colour" (the engine's Tertiary: buttons, badges and highlights, ~10%).
// The page (Primary, ~60%) and the panels (Secondary, ~30%) are pre-filled as calm tints of it and
// stay editable; once the person sets one, the brand colour stops filling it, and "Use tints of my
// brand colour again" hands it back. One set of three pickers: no presets, no swatch palette, no
// "where a look starts" choice. A page that is strongly saturated gets a warning. When the
// highlight stands out less than 3:1 against the page it stays as chosen and the card says the
// buttons get the strong outline (D93 point 2). "Suggest with colour theory" is a small link that
// fills the page and the panels by a harmony rule. The colours worked out from these three are
// under "Advanced" (role-panel.tsx).
//
// Ported from the Platform's Design page (`Pages/Design/Index.jsx` 167-180: one colour input and
// eleven swatches). Changed: the one colour is the brand colour and the rest of the palette is
// two editable tints instead of eleven swatches, a hex box beside each picker, a harmony menu,
// and the derived roles (role-panel.tsx) as semantic tokens with a contrast check.
import { HARMONY_RULES, type PairIssue, type ThemeRoleSet } from '@restro/core'
import { ChevronDownIcon, SparklesIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

import { HexField } from './hex-field'
import {
  applyHarmony,
  type ColourKey,
  followBrand,
  hasOwnTints,
  isStronglySaturated,
  type LookState,
  type LookView,
  paleHighlightScreens,
  setColour,
} from './look-state'
import { AdvancedColours, UnreadableAlert } from './role-panel'

/** The three pickers, brand colour first. */
const PICKERS: readonly ColourKey[] = ['tertiary', 'primary', 'secondary']

/** What the picker shows while its box holds half a colour. */
const PICKER_FALLBACK = { tertiary: '#6b7280', primary: '#f8f8f9', secondary: '#ffffff' } as const

export function ColourPanel({
  state,
  view,
  roles,
  derived,
  issues,
  canEdit,
  onChange,
}: {
  state: LookState
  view: LookView
  /** The roles to draw (the last whole look's, while a box holds half a colour). */
  roles: ThemeRoleSet
  derived: ThemeRoleSet
  issues: readonly PairIssue[]
  canEdit: boolean
  onChange: (next: LookState) => void
}) {
  const t = useTranslations('design.colours')
  const tRoles = useTranslations('design.roles')
  const id = useId()
  const saturated = isStronglySaturated(state.colours.primary)
  const pale = paleHighlightScreens(roles)

  return (
    <div className="grid gap-6" data-testid="design-colours">
      <div className="grid gap-4" data-testid="design-three-colours">
        {PICKERS.map((key) => {
          const invalid = view.invalid.includes(key)
          const warn = key === 'primary' && saturated && !invalid
          const describedBy = `${id}-${key}-help`
          return (
            <div key={key} className="grid gap-1.5" data-colour={key}>
              <Label htmlFor={`${id}-${key}`}>{t(`${key}.name`)}</Label>
              <HexField
                id={`${id}-${key}`}
                value={state.colours[key]}
                onChange={(text) => onChange(setColour(state, key, text))}
                pickerLabel={t(`${key}.picker`)}
                fallback={PICKER_FALLBACK[key]}
                disabled={!canEdit}
                invalid={invalid}
                describedBy={describedBy}
                placeholder={key === 'tertiary' ? t('tertiary.placeholder') : undefined}
              />
              <p
                id={describedBy}
                className={cn('text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}
                role={invalid ? 'alert' : undefined}
              >
                {invalid ? t('invalid') : t(`${key}.help`)}
              </p>
              {warn ? (
                <p
                  role="note"
                  className="text-xs font-medium text-warning"
                  data-testid="design-saturation-warning"
                >
                  {t('saturated')}
                </p>
              ) : null}
            </div>
          )
        })}
        {canEdit && hasOwnTints(state) ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto w-fit p-0"
            data-testid="design-follow-brand"
            onClick={() => onChange(followBrand(state))}
          >
            {t('followBrand')}
          </Button>
        ) : null}
      </div>

      {pale.length > 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="design-pale-highlight">
          {t('paleHighlight', {
            screens: pale.map((mode) => tRoles(`screens.${mode}`)).join(', '),
          })}
        </p>
      ) : null}

      {canEdit ? (
        <div className="grid gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="link" size="sm" className="h-auto w-fit p-0">
                <SparklesIcon aria-hidden />
                {t('suggest')}
                <ChevronDownIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72">
              {HARMONY_RULES.map((rule) => (
                <DropdownMenuItem
                  key={rule}
                  className="flex-col items-start gap-0.5"
                  data-rule={rule}
                  onSelect={() => onChange(applyHarmony(state, rule))}
                >
                  <span className="font-medium">{t(`rules.${rule}.name`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`rules.${rule}.help`)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <p className="text-xs text-muted-foreground">{t('suggestHelp')}</p>
        </div>
      ) : null}

      <UnreadableAlert issues={issues} />

      <AdvancedColours
        state={state}
        roles={roles}
        derived={derived}
        issues={issues}
        invalid={view.invalid}
        canEdit={canEdit}
        onChange={onChange}
      />
    </div>
  )
}
