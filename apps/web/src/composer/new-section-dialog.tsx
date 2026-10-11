'use client'

// "New section": a curated section with no till counterpart (owned here). It needs a name in the
// venue's main language (check V3); the other enabled languages are optional and can be added
// later. The title is stored in the manual layer, which is what "owned here" means.
import type { Locale, LocalizedText, NodeId } from '@restro/core'
import { MAX_SECTION_DEPTH } from '@restro/core'
import { useLocale, useTranslations } from 'next-intl'
import { type FormEvent, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { sectionTitle } from './labels'
import { depthOf, flattenSections } from './tree'
import type { ComposerView } from './view-model'

const TOP = '__top__'

interface NewSectionDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly view: ComposerView
  readonly defaultLocale: Locale
  readonly enabledLocales: readonly Locale[]
  /** The parent the dialog opens with (`null` = top level). */
  readonly initialParentId: NodeId | null
  readonly onCreate: (input: { parentId: NodeId | null; title: LocalizedText }) => void
}

export function NewSectionDialog(props: NewSectionDialogProps) {
  // The form is remounted on every opening so it starts empty with the right parent.
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? <NewSectionForm {...props} /> : null}
    </Dialog>
  )
}

function NewSectionForm({
  onOpenChange,
  view,
  defaultLocale,
  enabledLocales,
  initialParentId,
  onCreate,
}: NewSectionDialogProps) {
  const t = useTranslations('composer')
  const uiLocale = useLocale()
  const formId = useId()
  const [parentId, setParentId] = useState<NodeId | null>(initialParentId)
  const [names, setNames] = useState<Partial<Record<Locale, string>>>({})
  const [touched, setTouched] = useState(false)

  const languageNames = new Intl.DisplayNames([uiLocale], { type: 'language' })
  const languageName = (locale: Locale) =>
    languageNames.of(locale.split('_')[0] ?? locale) ?? locale

  // A new section sits one level below its parent: parents already at the deepest level are out.
  const parents = flattenSections(view).filter(({ id }) => depthOf(view, id) < MAX_SECTION_DEPTH)
  const defaultMissing = (names[defaultLocale] ?? '').trim() === ''

  function submit(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (defaultMissing) return
    const title: LocalizedText = {}
    for (const locale of enabledLocales) {
      const text = (names[locale] ?? '').trim()
      if (text !== '') title[locale] = text
    }
    onCreate({ parentId, title })
    onOpenChange(false)
  }

  // The default language first, then the rest in the venue's order.
  const ordered = [defaultLocale, ...enabledLocales.filter((locale) => locale !== defaultLocale)]

  return (
    <DialogContent data-testid="new-section-dialog">
      <form onSubmit={submit} className="grid gap-4" noValidate>
        <DialogHeader>
          <DialogTitle>{t('new.title')}</DialogTitle>
          <DialogDescription>{t('new.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label htmlFor={`${formId}-parent`}>{t('new.parent')}</Label>
          <Select
            value={parentId ?? TOP}
            onValueChange={(value) => setParentId(value === TOP ? null : (value as NodeId))}
          >
            <SelectTrigger id={`${formId}-parent`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={TOP}>{t('new.topLevel')}</SelectItem>
              {parents.map(({ id, depth }) => (
                <SelectItem key={id} value={id}>
                  <span style={{ paddingInlineStart: `${(depth - 1) * 0.75}rem` }}>
                    {sectionTitle(view, id, t('untitledSection'))}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <fieldset className="grid gap-3">
          <legend className="mb-2 text-sm font-medium">{t('new.names')}</legend>
          {ordered.map((locale) => {
            const isDefault = locale === defaultLocale
            const invalid = isDefault && touched && defaultMissing
            return (
              <div key={locale} className="grid gap-1.5">
                <Label htmlFor={`${formId}-${locale}`}>
                  {t('new.name', { language: languageName(locale) })}
                  {isDefault ? null : (
                    <span className="font-normal text-muted-foreground">({t('new.optional')})</span>
                  )}
                </Label>
                <Input
                  id={`${formId}-${locale}`}
                  value={names[locale] ?? ''}
                  onChange={(event) =>
                    setNames((current) => ({ ...current, [locale]: event.target.value }))
                  }
                  maxLength={120}
                  autoFocus={isDefault}
                  aria-invalid={invalid || undefined}
                  data-testid={`new-section-name-${locale}`}
                />
                {invalid ? (
                  <p className="text-sm text-destructive" role="alert">
                    {t('new.nameRequired')}
                  </p>
                ) : null}
              </div>
            )
          })}
        </fieldset>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('new.cancel')}
          </Button>
          <Button type="submit" data-testid="new-section-submit">
            {t('new.create')}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
