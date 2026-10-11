'use client'

// Font, corners, shadow and the light/dark policy of the Design tab (brief SH-05a, D70).
//   - Font: the short list of six fonts with Cyrillic letters (`THEME_FONTS`), each name drawn in
//     its own font (`FONT_STACKS`: our own files, guests' phones never call Google) beside a
//     sample line in both alphabets.
//   - Corners 0-24 px and shadow 0-5: sliders with the number beside them. The corner radius is
//     the face's base radius (the handover §10: photo frames, sheets and buttons scale from it);
//     the shadow is the menu column's shadow on larger screens, not an elevation scale.
//   - Light / dark: follow the guest's phone (default), always light or always dark. The policy
//     only chooses between the two role sets; it never generates one.
import {
  THEME_FONTS,
  THEME_SCHEMES,
  THEME_SHADOW,
  type ThemeFontId,
  type ThemeScheme,
} from '@restro/core'
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import { FONT_STACKS } from '@/fonts'
import { cn } from '@/lib/utils'

import { Segmented } from './segmented'

/** The corner slider's range (core accepts up to 32; the tab offers a calmer 24). */
const RADIUS_MAX = 24

export function StylePanel({
  font,
  radius,
  shadow,
  scheme,
  canEdit,
  onFont,
  onRadius,
  onShadow,
  onScheme,
}: {
  font: ThemeFontId
  radius: number
  shadow: number
  scheme: ThemeScheme
  canEdit: boolean
  onFont: (font: ThemeFontId) => void
  onRadius: (radius: number) => void
  onShadow: (shadow: number) => void
  onScheme: (scheme: ThemeScheme) => void
}) {
  const t = useTranslations('design.style')
  const id = useId()
  // A radius saved above the slider's range (core allows 32) keeps its place on the slider.
  const radiusMax = Math.max(RADIUS_MAX, radius)

  return (
    <div className="grid gap-6" data-testid="design-style">
      <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0" disabled={!canEdit}>
        <legend className="mb-1 text-sm font-medium">{t('font')}</legend>
        <p className="text-xs text-muted-foreground">{t('fontHelp')}</p>
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="design-fonts">
          {THEME_FONTS.map((entry) => {
            const chosen = entry.id === font
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-pressed={chosen}
                  data-font={entry.id}
                  onClick={() => onFont(entry.id)}
                  className={cn(
                    'grid w-full gap-0.5 rounded-lg border p-3 text-left transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60',
                    chosen
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'hover:bg-muted/60',
                  )}
                >
                  <span
                    className="text-lg leading-tight font-semibold"
                    style={{ fontFamily: FONT_STACKS[entry.family] }}
                  >
                    {entry.family}
                  </span>
                  <span
                    className="text-sm text-muted-foreground"
                    style={{ fontFamily: FONT_STACKS[entry.family] }}
                  >
                    {t('sample')}
                  </span>
                  <span className="text-xs text-muted-foreground">{t(`kinds.${entry.kind}`)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={`${id}-radius`} className="text-sm font-medium">
              {t('radius')}
            </label>
            <output
              htmlFor={`${id}-radius`}
              className="font-mono text-sm"
              data-testid="design-radius-value"
            >
              {t('radiusValue', { value: radius })}
            </output>
          </div>
          <input
            id={`${id}-radius`}
            type="range"
            min={0}
            max={radiusMax}
            step={1}
            value={radius}
            disabled={!canEdit}
            onChange={(event) => onRadius(Number(event.target.value))}
            className="w-full accent-primary disabled:opacity-60"
          />
          <p className="text-xs text-muted-foreground">{t('radiusHelp')}</p>
        </div>
        <div className="grid gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor={`${id}-shadow`} className="text-sm font-medium">
              {t('shadow')}
            </label>
            <output
              htmlFor={`${id}-shadow`}
              className="font-mono text-sm"
              data-testid="design-shadow-value"
            >
              {shadow}
            </output>
          </div>
          <input
            id={`${id}-shadow`}
            type="range"
            min={THEME_SHADOW.min}
            max={THEME_SHADOW.max}
            step={1}
            value={shadow}
            disabled={!canEdit}
            onChange={(event) => onShadow(Number(event.target.value))}
            className="w-full accent-primary disabled:opacity-60"
          />
          <p className="text-xs text-muted-foreground">{t('shadowHelp')}</p>
        </div>
      </div>

      <div className="grid gap-2">
        <p className="text-sm font-medium">{t('scheme')}</p>
        <Segmented
          label={t('scheme')}
          value={scheme}
          options={THEME_SCHEMES.map((value) => ({ value, label: t(`schemes.${value}`) }))}
          disabled={!canEdit}
          onChange={onScheme}
        />
        <p className="text-xs text-muted-foreground">{t('schemeHelp')}</p>
      </div>
    </div>
  )
}
