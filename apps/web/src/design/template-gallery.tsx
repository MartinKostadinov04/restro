'use client'

// The template chooser at the top of the Design tab (D69, D92, brief S7): collapsed to one line,
// "Template: <name>" with "Change". Open, it is the gallery: one card per template a venue may
// choose (the registry's visible entries), each with its picture, name and description in the
// interface language, an "In use" badge on the template the venue has and "Preview" (a phone pop-up
// with the venue's own menu, the tab opens it). Only one template exists and no choice is stored any
// more (D129: the design record replaced it; Styles come with the Studio).
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { type FaceEntry, faceEntry, visibleFaces } from '@/faces/registry'
import { resolveAdminLocale } from '@/i18n/locales'

export function TemplateChooser({
  current,
  canEdit,
  onPreview,
}: {
  /** The id of the template the venue has. */
  current: string
  canEdit: boolean
  /** Opens the phone pop-up of a template. */
  onPreview: (entry: FaceEntry) => void
}) {
  const t = useTranslations('design.templates')
  const locale = resolveAdminLocale(useLocale())
  const [open, setOpen] = useState(false)
  const faces = visibleFaces()

  return (
    <Card className="py-4" data-testid="design-templates">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold" data-testid="design-template-current">
              {t('current', { name: faceEntry(current).name[locale] })}
            </h3>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="design-template-change"
              >
                {open ? t('close') : canEdit ? t('change') : t('browse')}
                <ChevronDownIcon aria-hidden className={open ? 'rotate-180' : undefined} />
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">{t('description')}</p>
            <ul className="grid gap-4 sm:grid-cols-2" data-testid="design-gallery">
              {faces.map((entry) => {
                const inUse = entry.id === current
                const name = entry.name[locale]
                return (
                  <li
                    key={entry.id}
                    className="flex flex-col overflow-hidden rounded-xl border bg-card"
                    data-testid={`template-${entry.id}`}
                  >
                    {/* biome-ignore lint/performance/noImgElement: a fixed picture of the template, served from public/ */}
                    <img
                      src={entry.thumbnail}
                      alt={t('thumbnailAlt', { name })}
                      loading="lazy"
                      className="aspect-[4/3] w-full bg-muted object-cover object-top"
                    />
                    <div className="flex flex-1 flex-col gap-3 p-4">
                      <div className="grid gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-base font-semibold">{name}</h4>
                          {inUse ? (
                            <Badge variant="success" data-testid="template-in-use">
                              <CheckIcon aria-hidden />
                              {t('inUse')}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm text-muted-foreground">{entry.description[locale]}</p>
                      </div>
                      <div className="mt-auto flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => onPreview(entry)}
                          aria-label={t('previewNamed', { name })}
                        >
                          {t('preview')}
                        </Button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </CollapsibleContent>
        </CardContent>
      </Collapsible>
    </Card>
  )
}
