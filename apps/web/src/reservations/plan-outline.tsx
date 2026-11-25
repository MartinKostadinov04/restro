'use client'

// A linked group's outline on the plan (D160 §1, decision log 1.7; ticket #540). Reading only, and
// over the spots, never under a tap: it takes no pointer.
//
// One outline is drawn per cluster of the party's spots (`outline-geometry.ts`): the spots grown by a
// pad and joined, so a party on four adjoining tables is one outline and a table apart from them is
// the same outline on its own. The union is drawn as each grown spot's own edge with the parts
// that fall inside another grown spot of the party cut away by a mask, which is exact for any
// shape the folder holds, turned or not. The line is `vector-effect: non-scaling-stroke`, so it is
// the same thickness at every zoom.
//
// **Told apart by more than colour** (WCAG 1.4.1): the outline is one colour for every party, and
// each cluster carries the party's name on a tab hanging from its corner, so two parties on
// neighbouring tables are two outlines with two names. A long name clips on the tab and is whole in
// Tonight's sheet; the tab's title and the spots' own labels carry it whole for a screen reader.
import { useTranslations } from 'next-intl'
import { type SVGProps, useId, useMemo } from 'react'

import type { RvPlanView, RvSpotView } from '@/server/reservations/view'

import {
  type Box,
  type GrownSpot,
  grownSpot,
  type OutlineCluster,
  outlineClusters,
} from './outline-geometry'
import { placeStyle } from './plan-shape'

/** One rounded, turned box of the outline, as an SVG element's attributes. */
function Grown({
  spot,
  ...rest
}: { spot: GrownSpot } & Omit<SVGProps<SVGRectElement>, 'x' | 'y' | 'width' | 'height'>) {
  return (
    <rect
      x={spot.x}
      y={spot.y}
      width={spot.width}
      height={spot.height}
      rx={spot.radius}
      ry={spot.radius}
      transform={
        spot.rotation === 0 ? undefined : `rotate(${spot.rotation} ${spot.centreX} ${spot.centreY})`
      }
      {...rest}
    />
  )
}

/** One cluster: its edge, with the parts inside the party's other grown spots cut away. */
function Edge({
  cluster,
  pad,
  box,
  id,
}: {
  cluster: OutlineCluster
  pad: number
  box: Box
  id: string
}) {
  const grown = cluster.spots.map((spot) => grownSpot(spot.place, pad))
  return (
    <>
      {grown.map((spot, index) => {
        const key = cluster.spots[index]?.id ?? String(index)
        const mask = `${id}-${key}`
        return (
          <g key={key}>
            <mask
              id={mask}
              maskUnits="userSpaceOnUse"
              x={box.x - pad * 4}
              y={box.y - pad * 4}
              width={box.width + pad * 8}
              height={box.height + pad * 8}
            >
              <rect
                x={box.x - pad * 4}
                y={box.y - pad * 4}
                width={box.width + pad * 8}
                height={box.height + pad * 8}
                fill="white"
              />
              {grown.map((other, at) =>
                at === index ? null : (
                  <Grown key={cluster.spots[at]?.id ?? String(at)} spot={other} fill="black" />
                ),
              )}
            </mask>
            <Grown
              spot={spot}
              fill="none"
              className="stroke-primary"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
              mask={`url(#${mask})`}
            />
          </g>
        )
      })}
    </>
  )
}

/** The party's name hung from a cluster's top-left corner, in the plan's own box. */
function Tab({
  cluster,
  box,
  name,
  title,
  party,
}: {
  cluster: OutlineCluster
  box: Box
  name: string
  title: string
  party: string
}) {
  const style = placeStyle(
    { x: cluster.box.x, y: cluster.box.y, width: 0, height: 0, rotation: 0, shape: 'rect' },
    box,
  )
  return (
    <span
      className="pointer-events-none absolute z-10 max-w-[10rem] -translate-y-1/2 truncate rounded-sm bg-primary px-1.5 py-0.5 text-xs font-medium leading-tight text-primary-foreground"
      style={{ left: style.left, top: style.top }}
      title={title}
      data-testid="rv-group-name"
      data-party={party}
    >
      {name}
    </span>
  )
}

/**
 * Every linked group's outline over the plan, for the spots shown. A group whose spots a kind
 * filter has hidden draws only what is left of it, and nothing when fewer than two remain.
 */
export function GroupOutlines({ plan, shown }: { plan: RvPlanView; shown: readonly RvSpotView[] }) {
  const t = useTranslations('reservations')
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const box = plan.extent
  const pad = plan.outlinePad
  const drawn = useMemo(() => new Map(shown.map((spot) => [spot.id, spot])), [shown])
  const groups = useMemo(
    () =>
      plan.groups.flatMap((group) => {
        const spots = group.spotIds.flatMap((spotId) => {
          const spot = drawn.get(spotId)
          return spot === undefined ? [] : [{ id: spot.id, place: spot.place }]
        })
        if (spots.length < 2) return []
        return [{ group, clusters: outlineClusters(spots, pad), count: spots.length }]
      }),
    [drawn, pad, plan.groups],
  )
  if (groups.length === 0) return null
  return (
    <>
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible"
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        preserveAspectRatio="none"
        data-testid="rv-group-outlines"
      >
        {groups.flatMap(({ group, clusters }) =>
          clusters.map((cluster, at) => (
            <g
              key={`${group.id}:${cluster.spots[0]?.id ?? at}`}
              data-testid="rv-group-outline"
              data-party={group.id}
              data-spots={cluster.spots.length}
            >
              <Edge
                cluster={cluster}
                pad={pad}
                box={box}
                id={`${uid}-${group.id}-${at}`.replace(/[^a-zA-Z0-9-]/g, '')}
              />
            </g>
          )),
        )}
      </svg>
      {groups.flatMap(({ group, clusters, count }) => {
        const name = group.name ?? t('no_name')
        return clusters.map((cluster, at) => (
          <Tab
            key={`${group.id}:${cluster.spots[0]?.id ?? at}`}
            cluster={cluster}
            box={box}
            name={name}
            title={`${name} · ${t('g_party', { n: count })}`}
            party={group.id}
          />
        ))
      })}
    </>
  )
}
