'use client'

// Font, corners, shadow and the light/dark policy of the Design tab (briefs SH-05a and S7, D70, D92).
//   - Font: a dropdown of the short list of six fonts with Cyrillic letters (`THEME_FONTS`), each
//     name drawn in its own font (`FONT_STACKS`: our own files, guests' phones never call Google),
//     with a sample line in both alphabets under it.
//   - Corners 0-24 px and shadow 0-5: sliders with the number beside them. The corner radius is
//     the face's base radius (the handover §10: photo frames, sheets and buttons scale from it);
//     the shadow is the menu column's shadow on larger screens, not an elevation scale.
//   - Screen: follow the guest's phone (default), always light or always dark. The policy only
//     chooses between the two role sets; it never generates one.
import {
  THEME_FONTS,
  THEME_SCHEMES,
  THEME_SHADOW,
  type ThemeFontId,
  type ThemeScheme,
} from '@restro/core'
import { useTranslations } from 'next-intl'
import { useId } from 'react'

import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FONT_STACKS } from '@/fonts'

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
  const chosen = THEME_FONTS.find((entry) => entry.id === font) ?? THEME_FONTS[0]

  return (
    <div className="grid gap-6" data-testid="design-style">
      <div className="grid gap-2">
        <Label htmlFor={`${id}-font`}>{t('font')}</Label>
        <Select
          value={font}
          onValueChange={(next) => onFont(next as ThemeFontId)}
          disabled={!canEdit}
        >
          <SelectTrigger
            id={`${id}-font`}
            className="w-full sm:w-72"
            style={{ fontFamily: FONT_STACKS[chosen.family] }}
            data-testid="design-font-select"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" data-testid="design-fonts">
            {THEME_FONTS.map((entry) => (
              <SelectItem
                key={entry.id}
                value={entry.id}
                data-font={entry.id}
                style={{ fontFamily: FONT_STACKS[entry.family] }}
              >
                {entry.family}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p
          className="text-sm text-muted-foreground"
          style={{ fontFamily: FONT_STACKS[chosen.family] }}
          data-testid="design-font-sample"
        >
          {t('sample')} · {t(`kinds.${chosen.kind}`)}
        </p>
        <p className="text-xs text-muted-foreground">{t('fontHelp')}</p>
      </div>

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
            className="w-full accent-primary phone:h-11 disabled:opacity-60"
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
            className="w-full accent-primary phone:h-11 disabled:opacity-60"
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
