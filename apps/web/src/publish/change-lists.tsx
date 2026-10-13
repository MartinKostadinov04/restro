'use client'

// What a publish would change, as the Publish confirmation lists it (D96): the counts as badges
// ("1 with a new price") and the named lists (added, hidden, new prices, new names, other
// changes, parts outside the items). Menu names come from the document's `localized_text` in the
// interface language (names.ts); only the words around them are translated.
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import type { ChangesView } from '@/server/publish/view'

import { menuName, priceText, useAdminLocale } from './names'

export function ChangeLists({ changes }: { changes: ChangesView }) {
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

export function ChangeSummary({ changes }: { changes: ChangesView }) {
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
