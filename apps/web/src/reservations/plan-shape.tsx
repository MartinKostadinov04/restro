'use client'

// How a spot is drawn (#327, first acceptance criterion: **a stored shape never becomes markup**).
//
// Everything on this screen that comes out of the database is either a *name* out of the shape
// folder (`@restro/core`: `rect`, `circle`, `booth`, `pill`; `table`, `booth`, `stool`,
// `standing`, `counter`, `dot`) or a whole number the folder has already checked. This file holds
// the only tables that turn such a name into something visible, and both are typed
// `Record<…, …>` over the folder's own lists, so a name the folder adds cannot reach a screen
// without a component here.
//
// Three rules keep the criterion true, and `plan-markup.test.tsx` fails if any of them is broken:
//   1. No stored text ever becomes a class, a style, a URL or an attribute. The class comes from
//      the folder's corner name; the only style is `left/top/width/height` in per cent and a
//      rotation in degrees, each built from checked integers by this file's own arithmetic.
//   2. A spot's name and a block's reason are drawn as React children, which React escapes. There
//      is no `dangerouslySetInnerHTML` anywhere in the plan's modules, and no SVG path is ever
//      made from stored data: the icons are lucide components picked by name.
//   3. A row whose geometry the folder refused never reaches here: the read side leaves it off the
//      plan and counts it, and the plan says how many it could not draw.
import { SPOT_SHAPE_FOLDER, type SpotCorner, type SpotPlace, type SpotSymbol } from '@restro/core'
import {
  ArmchairIcon,
  BanIcon,
  CircleDotIcon,
  CircleIcon,
  ClockIcon,
  type LucideIcon,
  SofaIcon,
  TableIcon,
  TriangleAlertIcon,
  UsersIcon,
  WineIcon,
} from 'lucide-react'
import type { CSSProperties } from 'react'

import { cn } from '@/lib/utils'
import type { RvPlanView, RvSpotState, RvSpotView } from '@/server/reservations/view'

/** The box the plan is drawn inside, as the read side measured it. */
export type PlanBox = RvPlanView['extent']

/** How our own component rounds each of the folder's corner treatments. */
const CORNER_CLASS: Record<SpotCorner, string> = {
  square: 'rounded-none',
  soft: 'rounded-xl',
  full: 'rounded-full',
}

/** The component each legend symbol is drawn with. */
const SYMBOL_ICON: Record<SpotSymbol, LucideIcon> = {
  table: TableIcon,
  booth: SofaIcon,
  stool: ArmchairIcon,
  standing: UsersIcon,
  counter: WineIcon,
  dot: CircleDotIcon,
}

/** Each state's own symbol and surface. The word beside it is `plan-words.ts`'s. */
const STATE_LOOK: Record<RvSpotState, { readonly icon: LucideIcon; readonly tile: string }> = {
  free: { icon: CircleIcon, tile: 'border-border bg-card text-foreground' },
  held: { icon: ClockIcon, tile: 'border-info/70 bg-info/10 text-foreground' },
  sitting: { icon: UsersIcon, tile: 'border-success/70 bg-success/15 text-foreground' },
  late: { icon: TriangleAlertIcon, tile: 'border-warning/80 bg-warning/20 text-foreground' },
  blocked: { icon: BanIcon, tile: 'border-foreground/40 bg-muted text-muted-foreground' },
}

/** One kind's symbol, by name. */
export function KindSymbol({ symbol, className }: { symbol: SpotSymbol; className?: string }) {
  const Icon = SYMBOL_ICON[symbol]
  return <Icon aria-hidden className={cn('size-4 shrink-0', className)} />
}

/** One state's symbol, by name: never a colour on its own (WCAG 1.4.1). */
export function StateMark({ state, className }: { state: RvSpotState; className?: string }) {
  const Icon = STATE_LOOK[state].icon
  return <Icon aria-hidden className={cn('size-4 shrink-0', className)} />
}

/** One state's surface, for the tile and the legend's own swatch. */
export const stateTileClass = (state: RvSpotState): string => STATE_LOOK[state].tile

/**
 * Where a spot sits inside the plan's box, as per cent of that box. Only arithmetic on integers
 * the folder checked: `x`, `y`, `width`, `height` are grid units inside `PLAN_GRID`, and the
 * rotation is a whole number of degrees between 0 and 359.
 */
export function placeStyle(place: SpotPlace, box: PlanBox): CSSProperties {
  const share = (value: number, total: number) => `${((value / total) * 100).toFixed(4)}%`
  return {
    left: share(place.x - box.x, box.width),
    top: share(place.y - box.y, box.height),
    width: share(place.width, box.width),
    height: share(place.height, box.height),
    ...(place.rotation === 0 ? {} : { transform: `rotate(${place.rotation}deg)` }),
  }
}

/**
 * One spot on the plan: its name, its kind's symbol and its state in a word — the three things the
 * ticket asks a tile to carry. A button, so Tab reaches every spot and Enter opens it (2.1.1), at
 * least 44 px tall wherever the shape allows it. The whole of a clipped line is in the sheet.
 */
export function SpotTile({
  spot,
  box,
  symbol,
  kindLabel,
  line,
  stateWord,
  selected,
  onOpen,
  label,
}: {
  spot: RvSpotView
  box: PlanBox
  symbol: SpotSymbol
  kindLabel: string
  /** The state line as the words module writes it ("Blocked · repair"). */
  line: string
  stateWord: string
  selected: boolean
  onOpen: () => void
  /** What a screen reader hears: the spot, its kind and its state, in full. */
  label: string
}) {
  const corner = CORNER_CLASS[SPOT_SHAPE_FOLDER[spot.place.shape].corner]
  return (
    <button
      type="button"
      style={placeStyle(spot.place, box)}
      className={cn(
        'absolute flex min-w-0 flex-col items-center justify-center gap-0.5 overflow-hidden border-2 px-1 py-0.5 text-center leading-tight',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        corner,
        stateTileClass(spot.state),
        selected && 'ring-2 ring-ring ring-offset-1',
      )}
      aria-label={label}
      aria-pressed={selected}
      title={`${spot.name} · ${kindLabel} · ${stateWord}`}
      data-testid="rv-spot"
      data-spot={spot.id}
      data-state={spot.state}
      data-shape={spot.place.shape}
      onClick={onOpen}
    >
      <span className="flex max-w-full items-center gap-1 text-xs font-medium">
        <KindSymbol symbol={symbol} className="size-3.5" />
        <span className="truncate">{spot.name}</span>
      </span>
      <span className="flex max-w-full items-center gap-1 text-[0.6875rem]">
        <StateMark state={spot.state} className="size-3" />
        <span className="truncate">{line}</span>
      </span>
    </button>
  )
}
