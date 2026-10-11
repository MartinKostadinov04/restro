'use client'

// The template gallery: one card per template a venue may choose (the registry's visible entries,
// D69), with its picture, name and description in the interface language, an "In use" badge on the
// template the venue has, and a button for the others. Only one template exists today; the
// gallery is still a gallery, so a second one is a registry entry and nothing here changes.
import { CheckIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { type FaceEntry, visibleFaces } from '@/faces/registry'
import { resolveAdminLocale } from '@/i18n/locales'

export function TemplateGallery({
  current,
  canEdit,
  pending,
  onChoose,
}: {
  /** The id of the template the venue has. */
  current: string
  canEdit: boolean
  /** A template is being saved. */
  pending: boolean
  onChoose: (entry: FaceEntry) => void
}) {
  const t = useTranslations('design.templates')
  const locale = resolveAdminLocale(useLocale())
  const faces = visibleFaces()
  const hiddenInUse = !faces.some((entry) => entry.id === current)

  return (
    <div className="grid gap-3">
      {hiddenInUse ? (
        <p className="text-sm text-muted-foreground" data-testid="design-hidden-template">
          {t('hiddenInUse')}
        </p>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2" data-testid="design-gallery">
        {faces.map((entry) => {
          const inUse = entry.id === current
          return (
            <li
              key={entry.id}
              className="flex flex-col overflow-hidden rounded-xl border bg-card"
              data-testid={`template-${entry.id}`}
            >
              {/* biome-ignore lint/performance/noImgElement: a fixed picture of the template, served from public/ */}
              <img
                src={entry.thumbnail}
                alt={t('thumbnailAlt', { name: entry.name[locale] })}
                loading="lazy"
                className="aspect-[4/3] w-full bg-muted object-cover object-top"
              />
              <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-base font-semibold">{entry.name[locale]}</h4>
                    {inUse ? (
                      <Badge variant="success" data-testid="template-in-use">
                        <CheckIcon aria-hidden />
                        {t('inUse')}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">{entry.description[locale]}</p>
                </div>
                {canEdit ? (
                  <Button
                    type="button"
                    variant={inUse ? 'secondary' : 'default'}
                    className="mt-auto w-fit"
                    disabled={inUse || pending}
                    onClick={() => onChoose(entry)}
                    aria-label={inUse ? undefined : t('useNamed', { name: entry.name[locale] })}
                  >
                    {inUse ? t('inUse') : t('use')}
                  </Button>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
