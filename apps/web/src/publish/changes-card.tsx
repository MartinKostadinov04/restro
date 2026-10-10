'use client'

// "Changes waiting": what would change on guests' phones if the draft were published now, with
// counts and an expandable list, the overrides that wait for review (V12) with a link to each
// item in the composer, and the buttons to publish and to preview the draft.
import { ChevronDownIcon, ChevronUpIcon, EyeIcon, TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { FormSection } from '@/components/ui/form-section'
import type { ChangesView, PublishView } from '@/server/publish/view'
import { menuName, priceText, useAdminLocale } from './names'
import { PreviewDialog } from './preview-dialog'
import { PublishButton } from './publish-button'

/** Where an item opens in the composer. */
export const composerItemHref = (venueId: string, itemId: string) =>
  `/venues/${venueId}?tab=composer&item=${itemId}`

function ChangeLists({ changes }: { changes: ChangesView }) {
  const t = useTranslations('publish.changes')
  const locale = useAdminLocale()
  const unnamed = t('unnamed')
  const none = t('noPrice')
  const name = (item: { name: ChangesView['added'][number]['name'] }) =>
    menuName(item.name, locale, unnamed)
  const lists: { key: string; title: string; lines: { id: string; text: string }[] }[] = [
    {
      key: 'added',
      title: t('lists.added'),
      lines: changes.added.map((item) => ({ id: item.id, text: name(item) })),
    },
    {
      key: 'hidden',
      title: t('lists.hidden'),
      lines: changes.hidden.map((item) => ({ id: item.id, text: name(item) })),
    },
    {
      key: 'prices',
      title: t('lists.prices'),
      lines: changes.priceChanged.map((item) => ({
        id: item.id,
        text: `${name(item)}: ${t('arrow', {
          from: priceText(item.from, locale, none),
          to: priceText(item.to, locale, none),
        })}`,
      })),
    },
    {
      key: 'renamed',
      title: t('lists.renamed'),
      lines: changes.renamed.map((item) => ({
        id: item.id,
        text: t('arrow', {
          from: menuName(item.from, locale, unnamed),
          to: menuName(item.to, locale, unnamed),
        }),
      })),
    },
    {
      key: 'other',
      title: t('lists.other'),
      lines: changes.otherChanged.map((item) => ({ id: item.id, text: name(item) })),
    },
    {
      key: 'areas',
      title: t('lists.areas'),
      lines: changes.areas.map((area) => ({ id: area, text: t(`areas.${area}`) })),
    },
  ]
  return (
    <div className="grid gap-4" data-testid="change-lists">
      {lists
        .filter((list) => list.lines.length > 0)
        .map((list) => (
          <div key={list.key} data-testid={`change-list-${list.key}`}>
            <h4 className="text-sm font-medium">{list.title}</h4>
            <ul className="mt-1 grid gap-0.5 text-sm text-muted-foreground">
              {list.lines.map((line) => (
                <li key={line.id}>{line.text}</li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  )
}

function Summary({ changes }: { changes: ChangesView }) {
  const t = useTranslations('publish.changes.summary')
  const parts: [string, string][] = [
    ['added', changes.added.length > 0 ? t('added', { count: changes.added.length }) : ''],
    ['hidden', changes.hidden.length > 0 ? t('hidden', { count: changes.hidden.length }) : ''],
    [
      'prices',
      changes.priceChanged.length > 0 ? t('prices', { count: changes.priceChanged.length }) : '',
    ],
    ['renamed', changes.renamed.length > 0 ? t('renamed', { count: changes.renamed.length }) : ''],
    [
      'other',
      changes.otherChanged.length > 0 ? t('other', { count: changes.otherChanged.length }) : '',
    ],
  ]
  return (
    <ul className="flex flex-wrap gap-2" data-testid="change-summary">
      {parts
        .filter(([, text]) => text !== '')
        .map(([key, text]) => (
          <li key={key}>
            <Badge variant="secondary">{text}</Badge>
          </li>
        ))}
    </ul>
  )
}

function Changes({ view }: { view: PublishView }) {
  const t = useTranslations('publish.changes')
  const [open, setOpen] = useState(false)
  const draft = view.draft
  if (draft.state !== 'ready') {
    const key =
      draft.state === 'nothing_visible'
        ? 'nothingVisible'
        : draft.state === 'blocked'
          ? 'blocked'
          : 'unavailable'
    return (
      <div className="grid gap-1" role="status" data-testid={`draft-${draft.state}`}>
        <p className="font-medium">{t(`${key}.title`)}</p>
        <p className="text-sm text-muted-foreground">{t(`${key}.text`)}</p>
      </div>
    )
  }

  const { changes } = draft
  // A menu that has never been published: everything is new, and the list would only repeat it.
  if (view.live === null) {
    return (
      <p className="font-medium" data-testid="changes-all-new">
        {t('allNew', { count: changes.added.length })}
      </p>
    )
  }
  if (changes.identical) {
    return (
      <div className="grid gap-1" data-testid="changes-up-to-date">
        <p className="font-medium">{t('upToDate')}</p>
        <p className="text-sm text-muted-foreground">{t('upToDateText')}</p>
      </div>
    )
  }
  if (changes.total === 0) {
    return (
      <div className="grid gap-1" data-testid="changes-minor">
        <p className="font-medium">{t('minor')}</p>
        <p className="text-sm text-muted-foreground">{t('minorText')}</p>
      </div>
    )
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="grid gap-3">
      <p className="font-medium" data-testid="changes-count">
        {t('waiting', { count: changes.total })}
      </p>
      <Summary changes={changes} />
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="w-fit">
          {open ? <ChevronUpIcon aria-hidden /> : <ChevronDownIcon aria-hidden />}
          {open ? t('hide') : t('show')}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ChangeLists changes={changes} />
      </CollapsibleContent>
    </Collapsible>
  )
}

function StaleOverrides({ view }: { view: PublishView }) {
  const t = useTranslations('publish.stale')
  const tc = useTranslations('publish.changes')
  const locale = useAdminLocale()
  if (view.draft.state !== 'ready' || view.draft.staleOverrides.length === 0) return null
  const seen = new Set<string>()
  const lines = view.draft.staleOverrides.filter((stale) => {
    const key = `${stale.nodeId}:${stale.fieldKey ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return (
    <div
      className="grid gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3"
      data-testid="stale-overrides"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <TriangleAlertIcon aria-hidden className="size-4 text-warning" />
        {t('title')}
      </p>
      <p className="text-sm text-muted-foreground">{t('text')}</p>
      <ul className="grid gap-1 text-sm">
        {lines.map((stale) => {
          const label = menuName(stale.name, locale, tc('unnamed'))
          return (
            <li key={`${stale.nodeId}:${stale.fieldKey ?? ''}`} className="flex items-center gap-2">
              {stale.isItem ? (
                <Link
                  href={composerItemHref(view.venueId, stale.nodeId)}
                  className="text-primary underline-offset-4 hover:underline"
                  aria-label={t('open', { name: label })}
                >
                  {label}
                </Link>
              ) : (
                <span>{label}</span>
              )}
              {stale.fieldKey !== null ? (
                <code className="text-xs text-muted-foreground">{stale.fieldKey}</code>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function ChangesCard({
  view,
  busy,
  onPublish,
}: {
  view: PublishView
  busy: boolean
  onPublish: () => void
}) {
  const t = useTranslations('publish')
  return (
    <FormSection title={t('changes.title')} description={t('changes.description')}>
      <Changes view={view} />
      <StaleOverrides view={view} />
      <div className="flex flex-wrap items-center gap-3">
        {view.live !== null ? (
          <PublishButton view={view} busy={busy} onPublish={onPublish} />
        ) : null}
        <PreviewDialog venueId={view.venueId}>
          <Button type="button" variant="outline" disabled={view.draft.state !== 'ready'}>
            <EyeIcon aria-hidden />
            {t('preview')}
          </Button>
        </PreviewDialog>
      </div>
    </FormSection>
  )
}
