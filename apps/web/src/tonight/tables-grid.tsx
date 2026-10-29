'use client'

// "Tables" (plan §3, Patterns row "The state of many things at a glance"): a grid of status tiles,
// each an icon and one word, by bar. A closed tile opens the table for phones with one tap; any
// other opens its sheet. Colour marks only what needs a person (the info blue) and always comes
// with the icon and the word; open is neutral, closed is quiet. A paused bar's heading says so.
import {
  BellRingIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CirclePauseIcon,
  CreditCardIcon,
  HourglassIcon,
  SearchCheckIcon,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { cn } from '@/lib/utils'
import { closeTableAction, openTableAction } from '@/server/tonight/actions'
import type { BarGroup, TableTile, TileState, TonightView } from '@/server/tonight/view'

import { useTonightRun, wroteSomething } from './run'
import { useTableName } from './table-name'
import { TableSheet } from './table-sheet'

const TILE = {
  closed: { Icon: CircleDashedIcon, word: 'w_closed' },
  open: { Icon: CircleCheckIcon, word: 'w_open' },
  paused: { Icon: CirclePauseIcon, word: 'w_paused' },
  check: { Icon: SearchCheckIcon, word: 'w_order' },
  approval: { Icon: HourglassIcon, word: 'w_appr' },
  call: { Icon: BellRingIcon, word: 'w_call' },
  payment: { Icon: CreditCardIcon, word: 'w_pay' },
} as const satisfies Record<TileState, unknown>

function Tile({ tile, view, onOpen }: { tile: TableTile; view: TonightView; onOpen: () => void }) {
  const t = useTranslations('tonight')
  const { run, busy } = useTonightRun()
  const tableName = useTableName()
  const name = tableName(tile.label, tile.numbered)
  const { Icon, word } = TILE[tile.state]
  const needs = tile.state !== 'open' && tile.state !== 'closed'
  const closed = tile.state === 'closed'
  // A closed table opens in one tap; a person without the right opens nothing and sees no sheet.
  const tapOpens = closed && view.can.openClose
  const className = cn(
    'flex min-h-20 min-w-0 flex-col items-start justify-between gap-1 rounded-lg border p-2.5 text-left',
    needs && tile.state !== 'payment' && 'border-info/40 bg-info/10 text-info',
    // Red is only for money held on a guest's card (paying plan; screen 1).
    tile.state === 'payment' && 'border-destructive/40 bg-destructive/10 text-destructive',
    tile.state === 'open' && 'bg-card',
    closed && 'border-dashed bg-transparent text-muted-foreground',
  )
  const content = (
    <>
      <span className="w-full text-base font-semibold [overflow-wrap:anywhere]">{name}</span>
      <span className="flex items-center gap-1 text-[13px] leading-tight">
        <Icon aria-hidden className="size-4 shrink-0" />
        <span>{t(word)}</span>
      </span>
    </>
  )
  // A person who may not open tables sees a closed table as a plain status, never a greyed button.
  if (closed && !tapOpens) {
    return (
      <div data-testid="table-tile" data-state={tile.state} className={className}>
        {content}
      </div>
    )
  }
  return (
    <button
      type="button"
      data-testid="table-tile"
      data-state={tile.state}
      aria-label={
        closed
          ? t('t_closed', { table: name })
          : tile.state === 'open'
            ? t('t_open', { table: name })
            : `${name}, ${t(word)}`
      }
      disabled={busy}
      className={cn(
        className,
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60',
      )}
      onClick={() => {
        if (!closed) {
          onOpen()
          return
        }
        run({
          id: `table:${tile.id}`,
          act: () => openTableAction({ venueId: view.venueId, tableId: tile.id }),
          done: t('t_open', { table: name }),
          undo: (_, undo) => closeTableAction({ venueId: view.venueId, tableId: tile.id, undo }),
          undoWhen: wroteSomething,
        })
      }}
    >
      {content}
    </button>
  )
}

function Group({
  group,
  view,
  named,
  onOpen,
}: {
  group: BarGroup
  view: TonightView
  named: boolean
  onOpen: (tile: TableTile, bar: string | null) => void
}) {
  const t = useTranslations('tonight')
  return (
    <section className="space-y-2" aria-label={group.name ?? undefined}>
      {named && group.name !== null ? (
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium [overflow-wrap:anywhere]">
          {group.name}
          {group.paused ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-info/10 px-1.5 py-0.5 text-info">
              <CirclePauseIcon aria-hidden className="size-3.5" />
              {t('w_paused')}
            </span>
          ) : null}
        </h3>
      ) : null}
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-6">
        {group.tables.map((tile) => (
          <li key={tile.id} className="min-w-0">
            <Tile tile={tile} view={view} onOpen={() => onOpen(tile, group.name)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The grid of tables by bar, and the sheet of the one tapped. */
export function TablesGrid({ view }: { view: TonightView }) {
  const [chosen, setChosen] = useState<{ tile: TableTile; bar: string | null } | null>(null)
  // The sheet shows the live tile, so a call that arrives while it is open changes it in place.
  const live =
    chosen === null
      ? null
      : view.groups.flatMap((g) => g.tables).find((x) => x.id === chosen.tile.id)
  const named = view.groups.some((group) => group.name !== null)
  return (
    <>
      <div className="space-y-5">
        {view.groups.map((group) => (
          <Group
            key={group.barId ?? 'none'}
            group={group}
            view={view}
            named={named}
            onOpen={(tile, bar) => setChosen({ tile, bar })}
          />
        ))}
      </div>
      {chosen === null || live == null || live.state === 'closed' ? null : (
        <TableSheet tile={live} bar={chosen.bar} view={view} onClose={() => setChosen(null)} />
      )}
    </>
  )
}
