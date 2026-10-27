'use client'

// Tonight, screen 2: "Sent orders" (#86; plan `docs/deliverables/2026-10-27-tonight-sent-orders-plan.md`).
// Every sent order of the service day, newest first; find one by the reference on the guest's
// phone or by table; "All · Not added"; one order's details in a sheet, where an Unconfirmed one is
// answered with the same two answers as screen 1. The search is the one primary action and is the
// first control. The list keeps itself current (live-feed.ts): nothing slides.
import { CheckIcon } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { sentOrdersAction } from '@/server/tonight/night-actions'
import type { Frame, SentListView } from '@/server/tonight/night-view'

import { useLiveFeed } from './live-feed'
import { PAGE } from './pages'
import { RunProvider } from './run'
import { SearchField, useDebounced } from './search-field'
import { SentRow } from './sent-row'
import { SentOrderSheet } from './sent-sheet'
import {
  FailedBlock,
  NewLine,
  NothingHere,
  RowsSkeleton,
  ShowEarlier,
  TabHeading,
} from './tab-parts'

type Filter = 'all' | 'notAdded'

function Content({ initial, frame }: { initial: SentListView; frame: Frame }) {
  const t = useTranslations('tonight')
  const router = useRouter()
  const pathname = usePathname()
  const [text, setText] = useState('')
  const search = useDebounced(text.trim(), 250)
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(PAGE)
  const [open, setOpen] = useState<string | null>(null)

  const feed = useLiveFeed<SentListView>({
    initial,
    query: [search, filter, limit],
    live: true,
    keysOf: (view) => view.rows.map((row) => row.id),
    refresh: (shown, latest) => ({
      ...latest,
      rows: shown.rows.map((row) => latest.rows.find((fresh) => fresh.id === row.id) ?? row),
    }),
    load: async () => {
      const result = await sentOrdersAction({
        venueId: frame.venueId,
        search,
        notAddedOnly: filter === 'notAdded',
        limit,
      })
      return result.ok ? result.list : null
    },
  })
  const { shown } = feed
  const counts = shown.counts

  const goToActions = () => router.replace(`${pathname}?tab=tonight`, { scroll: false })

  const body = (() => {
    if (feed.failed) return <FailedBlock text={t('so_fail')} />
    if (shown.rows.length === 0 && feed.loading) return <RowsSkeleton />
    if (shown.rows.length === 0) {
      if (search !== '') return <NothingHere text={t('so_none', { q: search })} />
      if (filter === 'notAdded') {
        return (
          <p
            className="flex items-center gap-2 rounded-lg border p-4 text-sm text-muted-foreground"
            data-testid="nothing-not-added"
          >
            <CheckIcon aria-hidden className="size-4" />
            {t('nt_fix_none')}
          </p>
        )
      }
      return (
        <NothingHere
          title={t('so_empty_t')}
          text={t('so_empty_d')}
          action={
            <Button type="button" className="h-11" onClick={goToActions}>
              {t('so_empty_b')}
            </Button>
          }
        />
      )
    }
    return (
      <ul className="space-y-2" data-testid="sent-list">
        {shown.rows.map((row) => (
          <SentRow
            key={row.id}
            row={row}
            source={frame.source}
            currency={frame.currency}
            onOpen={setOpen}
          />
        ))}
      </ul>
    )
  })()

  return (
    <div className="space-y-4" data-testid="tonight-sent">
      <TabHeading name={t('tab_sent')} />
      <SearchField
        value={text}
        label={t('so_search')}
        onChange={(value) => {
          setText(value)
          setLimit(PAGE)
        }}
      />
      <fieldset className="m-0 flex min-w-0 gap-1 rounded-lg border-0 bg-muted p-1">
        <legend className="sr-only">{t('tab_sent')}</legend>
        {(
          [
            ['all', t('so_all', { n: counts.all })],
            ['notAdded', t('so_notadded', { n: counts.notAdded })],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant={filter === value ? 'default' : 'ghost'}
            aria-pressed={filter === value}
            data-testid={`filter-${value}`}
            className="h-11 flex-1"
            onClick={() => {
              setFilter(value)
              setLimit(PAGE)
            }}
          >
            {label}
          </Button>
        ))}
      </fieldset>
      <div aria-busy={feed.loading} className="space-y-2">
        <NewLine k={feed.fresh} onShow={feed.show} />
        {body}
        {shown.hasMore && !feed.failed ? (
          <ShowEarlier onClick={() => setLimit((before) => before + PAGE)} />
        ) : null}
      </div>
      {open === null ? null : (
        <SentOrderSheet
          frame={frame}
          sentOrderId={open}
          onClose={() => setOpen(null)}
          onChanged={feed.reload}
        />
      )}
    </div>
  )
}

/** Tonight's sent orders for one venue. */
export function SentOrdersTab({ initial, frame }: { initial: SentListView; frame: Frame }) {
  return (
    <RunProvider>
      <Content initial={initial} frame={frame} />
    </RunProvider>
  )
}
