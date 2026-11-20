'use client'

// "Tables" (plan §3, Patterns row "The state of many things at a glance"): a grid of status tiles,
// each an icon and one word, by bar. A tap on any tile opens its sheet (S16); a closed table's
// sheet holds "Open for phones". Colour marks only what needs a person (the info blue) and always comes
// with the icon and the word; open is neutral, closed is quiet. A paused bar's heading says so.
//
// **One closed table asks before it opens** (#329): the one somebody has booked later tonight, or
// kept back. The waiter at the sheet cannot know that, and the hostess is about to put those guests
// there, so "Open for phones" says who holds it and from when and he decides. He is never stopped:
// he may open it anyway; the hostess's own seating then asks the same-party question if phones
// have ordered there. Every other table opens at once, and so does this one when the read does not
// come back: the question is advice, never a gate.
//
// **A tile of a table with a party seated says the party's name** (walk P20, #419), cut short when
// it is long, and nothing else: no count, no weight, no colour of its own — the sheet carries the
// guests. A second party is a plain "+1" that never gets cut off. A role that does not work
// tonight's reservations is sent no names (`TableTile.parties`), so its tile is the plain one.
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
import { useCallback, useState } from 'react'

import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/reservations/confirm-dialog'
import { closeTableAction, openTableAction, tableBookedLaterAction } from '@/server/tonight/actions'
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
  const { busy } = useTonightRun()
  const tableName = useTableName()
  const name = tableName(tile.label, tile.numbered)
  const { Icon, word } = TILE[tile.state]
  // The name of whoever is seated here; a walk-in nobody named has none, and the tile says nothing.
  const named = tile.parties.filter((party) => party.name !== null)
  const partyName = named[0]?.name ?? null
  const more = tile.parties.length - 1
  const needs = tile.state !== 'open' && tile.state !== 'closed'
  const closed = tile.state === 'closed'
  // A closed table's sheet only holds "Open for phones": without the right there is no sheet.
  const tapOpens = closed && view.can.openClose
  const className = cn(
    // w-full: a button is as wide as its content unless told otherwise, and a long status word
    // (Bulgarian "Затворена") then pushed the tile past its grid column and made the panel scroll sideways.
    'flex min-h-20 w-full min-w-0 flex-col items-start justify-between gap-1 rounded-lg border px-2 py-2.5 text-left',
    needs && tile.state !== 'payment' && 'border-info/40 bg-info/10 text-info',
    // Red is only for money held on a guest's card (paying plan; screen 1).
    tile.state === 'payment' && 'border-destructive/40 bg-destructive/10 text-destructive',
    tile.state === 'open' && 'bg-card',
    closed && 'border-dashed bg-transparent text-muted-foreground',
  )
  const content = (
    <>
      <span className="w-full text-base font-semibold [overflow-wrap:anywhere]">{name}</span>
      <span className="flex w-full items-start gap-1 text-[13px] leading-tight">
        <Icon aria-hidden className="size-4 shrink-0" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{t(word)}</span>
      </span>
      {partyName === null ? null : (
        <span
          className="flex w-full min-w-0 gap-1 text-[13px] leading-tight"
          data-testid="tile-party"
        >
          <span className="min-w-0 truncate">{partyName}</span>
          {more > 0 ? <span className="shrink-0">+{more}</span> : null}
        </span>
      )}
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
          ? `${name}, ${t('w_closed')}`
          : tile.state === 'open'
            ? partyName === null
              ? t('t_open', { table: name })
              : `${t('t_open', { table: name })}, ${partyName}`
            : `${name}, ${t(word)}`
      }
      disabled={busy}
      className={cn(
        className,
        'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60',
      )}
      onClick={onOpen}
    >
      {content}
    </button>
  )
}

/** A closed table whose question is up: who holds it later tonight, and from when. */
interface Asking {
  readonly tile: TableTile
  readonly name: string
  /** The sentence of the question: a party and their hour, or the block and its hour. */
  readonly title: string
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
      {/* As many columns as fit at 7rem a tile (room for the longest Bulgarian status word, "Одобрение",
          on one line), so a narrow panel has fewer columns, never a cut-off one. */}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
        {group.tables.map((tile) => (
          <li key={tile.id} className="min-w-0">
            <Tile tile={tile} view={view} onOpen={() => onOpen(tile, group.name)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The grid of tables by bar, the sheet of the one tapped, and the one question before an open. */
export function TablesGrid({ view }: { view: TonightView }) {
  const t = useTranslations('tonight')
  const { run } = useTonightRun()
  const tableName = useTableName()
  const [chosen, setChosen] = useState<{ tile: TableTile; bar: string | null } | null>(null)
  const [asking, setAsking] = useState<Asking | null>(null)

  /** The open itself, with the Undo Tonight has always offered on it. */
  const open = useCallback(
    (tile: TableTile, name: string) => {
      setAsking(null)
      run({
        id: `table:${tile.id}`,
        act: () => openTableAction({ venueId: view.venueId, tableId: tile.id }),
        done: t('t_open', { table: name }),
        undo: (_, undo) => closeTableAction({ venueId: view.venueId, tableId: tile.id, undo }),
        undoWhen: wroteSomething,
      })
    },
    [run, t, view.venueId],
  )

  /**
   * "Open for phones" on a closed table's sheet: it asks the night's reservations whether anybody holds this table
   * later, and opens it at once where nobody does — or where the read did not come back, because a
   * table that will not open is worse than a question not asked.
   */
  const letIn = useCallback(
    (tile: TableTile, name: string) => {
      void tableBookedLaterAction({ venueId: view.venueId, tableId: tile.id })
        .catch(() => ({ ok: false }) as const)
        .then((read) => {
          if (!read.ok || read.booked === null) {
            open(tile, name)
            return
          }
          const { block, name: party, time } = read.booked
          setAsking({
            tile,
            name,
            title: block
              ? t('t_kept_t', { time })
              : t('t_booked_t', { party: party ?? t('t_booked_party'), time }),
          })
        })
    },
    [open, t, view.venueId],
  )

  // The sheet shows the live tile, so a call that arrives while it is open changes it in place.
  const live =
    chosen === null
      ? null
      : [...view.groups.flatMap((g) => g.tables), ...view.paymentTables].find(
          (x) => x.id === chosen.tile.id,
        )
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
      {view.paymentTables.length === 0 ? null : (
        <section className="mt-5 space-y-2" aria-labelledby="payment-tables-title">
          <h3 id="payment-tables-title" className="text-sm font-medium">
            {t('pay_tables')}
          </h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2">
            {view.paymentTables.map((tile) => (
              <li key={tile.id} className="min-w-0">
                <Tile tile={tile} view={view} onOpen={() => setChosen({ tile, bar: null })} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {chosen === null || live == null ? null : (
        <TableSheet
          tile={live}
          bar={chosen.bar}
          view={view}
          onClose={() => setChosen(null)}
          onOpenForPhones={() => letIn(live, tableName(live.label, live.numbered))}
        />
      )}
      {asking === null ? null : (
        <ConfirmDialog
          title={asking.title}
          body={t('t_booked_b')}
          doLabel={t('t_booked_do')}
          keepLabel={t('t_booked_no')}
          testId="tonight-booked"
          busy={false}
          onDo={() => open(asking.tile, asking.name)}
          onKeep={() => setAsking(null)}
        />
      )}
    </>
  )
}
