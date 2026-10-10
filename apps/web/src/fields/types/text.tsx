'use client'

// short_text, long_text and localized_text.
import type { FieldValueOf, Locale } from '@restro/core'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

import { useFieldEnvironment } from '../environment'
import { localeChip } from '../localized'
import type { DisplayProps, EditorProps, FieldUi } from '../types'

function maxLengthOf(constraints: unknown): number | undefined {
  const max = (constraints as { max_length?: unknown } | null)?.max_length
  return typeof max === 'number' ? max : undefined
}

// --- short_text -----------------------------------------------------------------------------

function ShortTextDisplay({ value }: DisplayProps<'short_text'>) {
  return <span className="text-foreground">{value}</span>
}

function ShortTextEditor({
  definition,
  value,
  onChange,
  inputId,
  invalid,
}: EditorProps<'short_text'>) {
  const t = useTranslations('fields.hints')
  const max = maxLengthOf(definition.constraints)
  return (
    <div className="grid gap-1.5">
      <Input
        id={inputId}
        value={value ?? ''}
        aria-invalid={invalid || undefined}
        // A line break cannot be typed into an <input>, but can be pasted; the value has none.
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      />
      {max !== undefined ? (
        <p className="text-xs text-muted-foreground">{t('maxLength', { max })}</p>
      ) : null}
    </div>
  )
}

export const shortText = {
  Display: ShortTextDisplay,
  Editor: ShortTextEditor,
} satisfies FieldUi<'short_text'>

// --- long_text ------------------------------------------------------------------------------

function LongTextDisplay({ value }: DisplayProps<'long_text'>) {
  return <span className="whitespace-pre-line text-foreground">{value}</span>
}

function LongTextEditor({
  definition,
  value,
  onChange,
  inputId,
  invalid,
}: EditorProps<'long_text'>) {
  const t = useTranslations('fields.hints')
  const max = maxLengthOf(definition.constraints)
  return (
    <div className="grid gap-1.5">
      <Textarea
        id={inputId}
        rows={5}
        value={value ?? ''}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
      />
      {max !== undefined ? (
        <p className="text-xs text-muted-foreground">{t('maxLength', { max })}</p>
      ) : null}
    </div>
  )
}

export const longText = {
  Display: LongTextDisplay,
  Editor: LongTextEditor,
} satisfies FieldUi<'long_text'>

// --- localized_text -------------------------------------------------------------------------

/** One row per language that has text, the interface language first. */
function LocalizedTextDisplay({ value }: DisplayProps<'localized_text'>) {
  const environment = useFieldEnvironment()
  const locales = (Object.keys(value) as Locale[]).sort(
    (a, b) => Number(b === environment.locale) - Number(a === environment.locale),
  )
  return (
    <ul className="grid gap-1">
      {locales.map((locale) => (
        <li key={locale} className="flex items-baseline gap-2">
          <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
            {localeChip(locale)}
          </Badge>
          <span className="text-foreground">{value[locale]}</span>
        </li>
      ))}
    </ul>
  )
}

/** One tab per enabled language of the venue (plus any other language that already has text). */
function LocalizedTextEditor({
  definition,
  value,
  onChange,
  inputId,
  invalid,
}: EditorProps<'localized_text'>) {
  const t = useTranslations('fields.hints')
  const environment = useFieldEnvironment()
  const current: FieldValueOf<'localized_text'> = value ?? {}
  const extra = (Object.keys(current) as Locale[]).filter(
    (locale) => !environment.enabledLocales.includes(locale),
  )
  const locales = [...environment.enabledLocales, ...extra]
  const max = maxLengthOf(definition.constraints)

  function setText(locale: Locale, text: string) {
    const next: FieldValueOf<'localized_text'> = { ...current }
    // A language with no text is absent, never an empty string (the canonical shape).
    if (text.trim() === '') delete next[locale]
    else next[locale] = text
    onChange(Object.keys(next).length === 0 ? undefined : next)
  }

  const first = locales[0]
  if (first === undefined) return null
  return (
    <Tabs defaultValue={environment.locale in current ? environment.locale : first}>
      <TabsList>
        {locales.map((locale) => (
          <TabsTrigger key={locale} value={locale} lang={locale.split('_')[0]}>
            {localeChip(locale)}
            {current[locale] !== undefined ? (
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
            ) : null}
          </TabsTrigger>
        ))}
      </TabsList>
      {locales.map((locale, index) => (
        <TabsContent key={locale} value={locale} className="grid gap-1.5 pt-2">
          <Textarea
            id={index === 0 ? inputId : `${inputId}-${locale}`}
            rows={3}
            lang={locale.split('_')[0]}
            value={current[locale] ?? ''}
            aria-invalid={invalid || undefined}
            onChange={(event) => setText(locale, event.target.value)}
          />
          {max !== undefined ? (
            <p className="text-xs text-muted-foreground">{t('maxLength', { max })}</p>
          ) : null}
        </TabsContent>
      ))}
    </Tabs>
  )
}

export const localizedText = {
  Display: LocalizedTextDisplay,
  Editor: LocalizedTextEditor,
} satisfies FieldUi<'localized_text'>
