'use client'

// The colour part of the Design tab (brief SH-05a, D70): where a look starts (one of the designer's
// four presets, one brand colour, or the venue's own three colours), the three colours with what
// each one paints (primary ~60% the page, secondary ~30% the panels, tertiary ~10% the highlights),
// and "Suggest with colour theory", which fills the three from the tertiary by a harmony rule.
//
// Ported from the Platform's Design page (`Pages/Design/Index.jsx` 167-180: one colour input and
// eleven swatches). Changed: three colours instead of one, a hex box beside each picker, presets
// and harmony suggestions as starting points, and the derived roles in role-panel.tsx.
import { FALLBACK_BRAND, HARMONY_RULES, THEME_PRESETS } from '@restro/core'
import { ChevronDownIcon, SparklesIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useId } from 'react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { resolveAdminLocale } from '@/i18n/locales'
import { cn } from '@/lib/utils'
import { BRAND_SWATCHES, normaliseHex } from './hex'
import { HexField } from './hex-field'
import {
  applyHarmony,
  COLOUR_KEYS,
  type ColourKey,
  type LookState,
  type LookView,
  setColour,
  startCustom,
  startFromBrand,
  startFromPreset,
} from './look-state'

/** The colours of a look shown as a 60 / 30 / 10 bar. */
function ProportionBar({ state }: { state: LookState }) {
  const t = useTranslations('design.colours')
  const colour = (key: ColourKey) => normaliseHex(state.colours[key]) ?? 'transparent'
  return (
    <div
      className="flex h-3 overflow-hidden rounded-full border"
      role="img"
      aria-label={t('proportionLabel')}
    >
      <span style={{ width: '60%', backgroundColor: colour('primary') }} />
      <span style={{ width: '30%', backgroundColor: colour('secondary') }} />
      <span style={{ width: '10%', backgroundColor: colour('tertiary') }} />
    </div>
  )
}

export function ColourPanel({
  state,
  view,
  canEdit,
  onChange,
}: {
  state: LookState
  view: LookView
  canEdit: boolean
  onChange: (next: LookState) => void
}) {
  const t = useTranslations('design.colours')
  const locale = resolveAdminLocale(useLocale())
  const id = useId()
  const custom = state.source === 'colours' && state.preset === null
  const brandInvalid = view.invalid.includes('brand')

  return (
    <div className="grid gap-6" data-testid="design-colours">
      <div className="grid gap-2">
        <p className="text-sm font-medium" id={`${id}-start`}>
          {t('startingPoint')}
        </p>
        <p className="text-xs text-muted-foreground">{t('startingPointHelp')}</p>
        <ul className="flex flex-wrap gap-2" aria-labelledby={`${id}-start`}>
          {THEME_PRESETS.map((preset) => {
            const pressed = state.source === 'colours' && state.preset === preset.id
            return (
              <li key={preset.id}>
                <Button
                  type="button"
                  variant={pressed ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={pressed}
                  disabled={!canEdit}
                  data-preset={preset.id}
                  onClick={() => onChange(startFromPreset(state, preset.id))}
                >
                  <span className="flex" aria-hidden>
                    {(['primary', 'secondary', 'tertiary'] as const).map((key) => (
                      <span
                        key={key}
                        className="-ml-1 size-4 rounded-full border first:ml-0"
                        style={{ backgroundColor: preset.colours[key] }}
                      />
                    ))}
                  </span>
                  {preset.label[locale]}
                </Button>
              </li>
            )
          })}
          <li>
            <Button
              type="button"
              variant={state.source === 'brand' ? 'default' : 'outline'}
              size="sm"
              aria-pressed={state.source === 'brand'}
              disabled={!canEdit}
              data-preset="brand"
              onClick={() => onChange(startFromBrand(state))}
            >
              {t('fromBrand')}
            </Button>
          </li>
          <li>
            <Button
              type="button"
              variant={custom ? 'default' : 'outline'}
              size="sm"
              aria-pressed={custom}
              disabled={!canEdit}
              data-preset="custom"
              onClick={() => onChange(startCustom(state))}
            >
              {t('custom')}
            </Button>
          </li>
        </ul>
      </div>

      {state.source === 'brand' ? (
        <div className="grid gap-2" data-testid="design-brand">
          <Label htmlFor={`${id}-brand`}>{t('brand')}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <HexField
              id={`${id}-brand`}
              value={state.brand}
              onChange={(text) => onChange({ ...state, brand: text })}
              pickerLabel={t('brandPicker')}
              fallback={FALLBACK_BRAND}
              disabled={!canEdit}
              invalid={brandInvalid}
              describedBy={`${id}-brand-help`}
              placeholder={t('brandPlaceholder')}
            />
            {canEdit && state.brand !== '' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange({ ...state, brand: '' })}
              >
                {t('clearBrand')}
              </Button>
            ) : null}
          </div>
          <p
            id={`${id}-brand-help`}
            className={cn('text-xs', brandInvalid ? 'text-destructive' : 'text-muted-foreground')}
            role={brandInvalid ? 'alert' : undefined}
          >
            {brandInvalid ? t('invalid') : t('brandHelp')}
          </p>
          <ul className="flex flex-wrap gap-2" aria-label={t('swatches')}>
            {BRAND_SWATCHES.map((swatch) => (
              <li key={swatch}>
                <button
                  type="button"
                  className="size-8 rounded-full border-2 ring-offset-2 focus-visible:ring-2 disabled:opacity-50"
                  style={{
                    backgroundColor: swatch,
                    borderColor:
                      normaliseHex(state.brand) === swatch ? 'currentColor' : 'transparent',
                  }}
                  aria-label={swatch}
                  aria-pressed={normaliseHex(state.brand) === swatch}
                  disabled={!canEdit}
                  onClick={() => onChange({ ...state, brand: swatch })}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="grid gap-4" data-testid="design-three-colours">
          <ProportionBar state={state} />
          {COLOUR_KEYS.map((key) => {
            const invalid = view.invalid.includes(key)
            return (
              <div key={key} className="grid gap-1.5" data-colour={key}>
                <Label htmlFor={`${id}-${key}`}>{t(`${key}.name`)}</Label>
                <HexField
                  id={`${id}-${key}`}
                  value={state.colours[key]}
                  onChange={(text) => onChange(setColour(state, key, text))}
                  pickerLabel={t(`${key}.picker`)}
                  fallback={FALLBACK_BRAND}
                  disabled={!canEdit}
                  invalid={invalid}
                  describedBy={`${id}-${key}-help`}
                />
                <p
                  id={`${id}-${key}-help`}
                  className={cn('text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}
                  role={invalid ? 'alert' : undefined}
                >
                  {invalid ? t('invalid') : t(`${key}.help`)}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {canEdit ? (
        <div className="grid gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="w-fit">
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
    </div>
  )
}
