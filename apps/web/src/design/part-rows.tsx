'use client'

// The Design panel's list of parts and the header of an open part (D159; the pattern "Many groups of
// settings" in `docs/guides/operational-screens.md`). Each row is the part's name, a one-line muted
// summary of what is set and ›; the summary is cut with an ellipsis and read whole in the row's
// accessible name. A row opens its part in place; the part's header has ‹ Back and its title. What
// the rows are and what their summaries say is `part-list.ts`.
//
// Ported from the example designer's mechanics (`DesignStudio.jsx`: the category list, the drill-in
// with ‹, the pane that slides 8 px and fades in over 180 ms, a 120 ms fade only with reduced motion),
// not its code: our rows are shadcn and D107's, and the address remembers the open part.
import { type DesignPage, type DesignValues, THEME_FONTS } from '@restro/core'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type ReactNode, type Ref, useLayoutEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { FONT_STACKS } from '@/fonts'
import type { AdminLocale } from '@/i18n/locales'
import { cn } from '@/lib/utils'

import type { DesignDraft } from './design-draft'
import { normaliseHex } from './hex'
import { COLOUR_KEYS } from './look-state'
import {
  fontSummaryOf,
  layoutSummaryOf,
  type NamedStyles,
  type OwnPartId,
  type PartList,
  pageSummaryOf,
  styleSummaryOf,
} from './part-list'

/** A font's name is drawn in the font; "the same as the body" has no font of its own. */
export function fontStackOf(id: string): string | undefined {
  const font = THEME_FONTS.find((entry) => entry.id === id)
  return font === undefined ? undefined : FONT_STACKS[font.family]
}

/** How a view of the panel arrives: from a row (forward), back to the list, or at once. */
export type PaneEnter = 'forward' | 'back' | null

/**
 * One view of the panel. It draws its first frame 8 px to the side and transparent, then lets go so
 * it slides and fades in over 180 ms; with reduced motion it only fades, over 120 ms.
 */
export function Pane({ enter, children }: { enter: PaneEnter; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // Read once: a later render never puts the offset back.
  const [entering] = useState(enter)
  useLayoutEffect(() => {
    const node = ref.current
    if (node === null || entering === null) return undefined
    // The offset is laid out before it goes, so the change transitions.
    node.getBoundingClientRect()
    const frame = requestAnimationFrame(() => node.removeAttribute('data-entering'))
    return () => cancelAnimationFrame(frame)
  }, [entering])
  return (
    <div
      ref={ref}
      data-entering={entering ?? undefined}
      data-testid="design-pane"
      className={cn(
        'grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6',
        'transition-[opacity,transform] duration-180 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:duration-120',
        'data-[entering]:opacity-0 motion-safe:data-[entering=forward]:translate-x-2 motion-safe:data-[entering=back]:-translate-x-2',
      )}
    >
      {children}
    </div>
  )
}

/** The header of an open part: ‹ Back to the list, and the part's title, which takes the focus. */
export function PartHeader({
  title,
  titleId,
  titleRef,
  onBack,
}: {
  title: string
  titleId: string
  titleRef: Ref<HTMLHeadingElement>
  onBack: () => void
}) {
  const t = useTranslations('design.parts')
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        className="-ml-2 shrink-0 px-2"
        aria-label={t('backLabel')}
        onClick={onBack}
        data-testid="design-part-back"
      >
        <ChevronLeftIcon aria-hidden />
        {t('back')}
      </Button>
      <h2
        ref={titleRef}
        id={titleId}
        tabIndex={-1}
        className="min-w-0 scroll-mt-24 text-base font-semibold outline-none"
        data-testid="design-part-title"
      >
        {title}
      </h2>
    </div>
  )
}

/** One row: the part's name, its summary on one line, and ›. */
function PartRow({
  id,
  name,
  summary,
  summaryText,
  rowRef,
  onOpen,
}: {
  id: string
  name: string
  /** The summary as drawn (dots, fonts drawn in their font). */
  summary: ReactNode
  /** The summary as words, for the row's accessible name. */
  summaryText: string
  rowRef: (node: HTMLButtonElement | null) => void
  onOpen: () => void
}) {
  return (
    <li>
      <button
        ref={rowRef}
        type="button"
        aria-label={summaryText === '' ? name : `${name}: ${summaryText}`}
        onClick={onOpen}
        data-testid={`design-part-${id}`}
        data-part={id}
        className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-md px-3 py-2 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-muted"
      >
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="block truncate text-sm text-muted-foreground" aria-hidden>
            {summary}
          </span>
        </span>
        <ChevronRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  )
}

/** A colour of the look as a dot; a colour not chosen yet is an empty ring. */
function Dot({ colour }: { colour: string }) {
  const hex = normaliseHex(colour)
  return (
    <span
      className={cn(
        'mr-1 inline-block size-3 rounded-full border align-[-1px]',
        hex === null && 'border-dashed border-muted-foreground',
      )}
      style={hex === null ? undefined : { backgroundColor: hex }}
      data-testid="design-part-dot"
    />
  )
}

/** The list of parts for a level, with every row's summary worked out from the draft. */
export function PartRows({
  list,
  draft,
  styles,
  locale,
  onOpen,
  rowRef,
}: {
  list: PartList
  draft: Pick<DesignDraft, 'style' | 'values' | 'picked' | 'look' | 'logo'>
  styles: NamedStyles
  locale: AdminLocale
  onOpen: (id: string) => void
  /** Where each row is kept, so going back focuses the row it came from. */
  rowRef: (id: string) => (node: HTMLButtonElement | null) => void
}) {
  const t = useTranslations('design')
  const values: DesignValues = draft.values

  function ownRow(id: OwnPartId) {
    let summary: ReactNode
    let summaryText: string
    if (id === 'style') {
      const style = styleSummaryOf(draft, styles, locale)
      summaryText = style.changed ? t('parts.changed', { style: style.name }) : style.name
      summary = summaryText
    } else if (id === 'colours') {
      summaryText = draft.logo === null ? t('parts.noLogo') : t('parts.logo')
      summary = (
        <>
          {COLOUR_KEYS.map((key) => (
            <Dot key={key} colour={draft.look.colours[key]} />
          ))}{' '}
          {summaryText}
        </>
      )
    } else if (id === 'fonts') {
      const fonts = fontSummaryOf(values, locale)
      const shown = fonts.heading === null ? [fonts.body] : [fonts.body, fonts.heading]
      summaryText = shown.map((font) => font.name).join(' · ')
      summary = shown.map((font, index) => (
        <span key={font.id}>
          {index > 0 ? ' · ' : null}
          <span style={{ fontFamily: fontStackOf(font.id) }}>{font.name}</span>
        </span>
      ))
    } else {
      const layout = layoutSummaryOf(values)
      summaryText = t(layout.guestSwitch ? 'parts.layoutSwitch' : 'parts.layoutFixed', {
        layout: t(`layout.layouts.${layout.layout}`),
      })
      summary = summaryText
    }
    return (
      <PartRow
        key={id}
        id={id}
        name={t(`parts.${id}`)}
        summary={summary}
        summaryText={summaryText}
        rowRef={rowRef(id)}
        onOpen={() => onOpen(id)}
      />
    )
  }

  function pageRow(page: DesignPage) {
    const summary = pageSummaryOf(page, values, locale)
    return (
      <PartRow
        key={page.id}
        id={page.id}
        name={page[locale]}
        summary={summary}
        summaryText={summary}
        rowRef={rowRef(page.id)}
        onOpen={() => onOpen(page.id)}
      />
    )
  }

  return (
    <div className="grid min-w-0 gap-4" data-testid="design-part-list">
      <ul className="m-0 grid list-none gap-0.5 p-0">{list.own.map(ownRow)}</ul>
      {list.pages.length === 0 ? null : (
        <section className="grid gap-2 border-t pt-4" aria-labelledby="design-parts-of-menu">
          <h2
            id="design-parts-of-menu"
            className="px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
          >
            {t('parts.menuParts')}
          </h2>
          <ul className="m-0 grid list-none gap-0.5 p-0">{list.pages.map(pageRow)}</ul>
        </section>
      )}
    </div>
  )
}
