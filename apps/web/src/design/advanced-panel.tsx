'use client'

// The Advanced side of the Design page's panel (D129, D130): the list of pages (General and the
// thirteen components) and the open page's options. Everything on a page is drawn from the contract
// file (`DESIGN_PAGES`): its order, its labels, its options and their values. A choice option is a row
// of tiles (`option-tiles.tsx`); the Style, the colours and the fonts are Simple's own controls,
// handed in by the page, so there is one of each and the draft is the same one.
import {
  DESIGN_PAGES,
  type DesignChoiceOption,
  type DesignPage,
  type DesignPageId,
  type DesignValues,
  type VenueTheme,
} from '@restro/core'
import { useTranslations } from 'next-intl'
import { type ReactNode, useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'

import { rowStateOf } from './advanced-model'
import { OptionTiles } from './option-tiles'
import type { Draft } from './preview-draft'

/** The page list: chips in a row that scrolls sideways on a phone, a list from 820 px. */
function PageList({
  pages,
  open,
  locale,
  onOpen,
}: {
  pages: readonly DesignPage[]
  open: string
  locale: 'bg' | 'en'
  onOpen: (id: DesignPageId) => void
}) {
  const t = useTranslations('design.advanced')
  const opened = useRef<HTMLButtonElement>(null)
  // The open page's chip stays in view when a tap on the preview opens it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `open` is what moves the chip into view
  useEffect(() => {
    opened.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [open])
  return (
    <nav aria-label={t('pages')} data-testid="design-pages">
      <ul className="m-0 flex list-none gap-1 overflow-x-auto p-0 pb-1 min-[820px]:flex-col min-[820px]:overflow-visible min-[820px]:pb-0">
        {pages.map((page) => {
          const isOpen = page.id === open
          return (
            <li key={page.id} className="shrink-0 min-[820px]:shrink">
              <button
                ref={isOpen ? opened : undefined}
                type="button"
                aria-current={isOpen ? 'page' : undefined}
                data-testid={`design-page-${page.id}`}
                onClick={() => onOpen(page.id as DesignPageId)}
                className={cn(
                  'inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  'min-[820px]:min-h-8 min-[820px]:w-full min-[820px]:rounded-md min-[820px]:border-transparent min-[820px]:whitespace-normal min-[820px]:text-left',
                  isOpen && 'border-primary bg-accent/40 text-foreground',
                )}
              >
                {page[locale]}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

export function AdvancedPanel({
  venueId,
  locale,
  pages = DESIGN_PAGES,
  open,
  onOpen,
  reveal,
  onRevealed,
  values,
  theme,
  draft,
  scheme,
  canEdit,
  custom,
  onPick,
}: {
  venueId: string
  locale: 'bg' | 'en'
  /** The contract's pages; a test hands in a contract with an option more. */
  pages?: readonly DesignPage[]
  open: string
  onOpen: (id: DesignPageId) => void
  /** True when a tap on the preview opened the page: it lands on its first option, then says so. */
  reveal: boolean
  onRevealed: () => void
  values: DesignValues
  theme: VenueTheme
  draft: Draft
  scheme: 'light' | 'dark'
  canEdit: boolean
  /** Simple's own controls for the options that are not tiles: `style`, `colours`, `body_font`, `heading_font`. */
  custom: Readonly<Record<string, ReactNode>>
  onPick: (pageId: string, optionId: string, value: string) => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)

  // A tap on the preview opens the page and lands on its first option.
  useEffect(() => {
    if (!reveal) return
    heading.current?.focus()
    heading.current?.scrollIntoView?.({ block: 'start' })
    onRevealed()
  }, [reveal, onRevealed])

  const page = pages.find((entry) => entry.id === open) ?? pages[0]
  if (page === undefined) throw new Error('the design contract has no pages')

  return (
    <div
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6"
      data-testid="design-advanced-panel"
    >
      <PageList pages={pages} open={page.id} locale={locale} onOpen={onOpen} />
      <section
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6"
        aria-labelledby="design-advanced-title"
      >
        <h2
          id="design-advanced-title"
          ref={heading}
          tabIndex={-1}
          className="scroll-mt-24 text-base font-semibold outline-none"
          data-testid="design-advanced-title"
        >
          {page[locale]}
        </h2>
        {page.options.map((option) => {
          const own = custom[option.kind === 'choice' ? option.id : option.kind]
          if (own !== undefined) {
            return (
              <div
                key={option.id}
                className="grid gap-3"
                data-testid="design-option"
                data-page={page.id}
                data-option={option.id}
              >
                {option.kind === 'choice' ? null : (
                  <h3 className="text-sm font-semibold">{option[locale]}</h3>
                )}
                {own}
              </div>
            )
          }
          if (option.kind !== 'choice') return null
          return (
            <OptionTiles
              key={option.id}
              venueId={venueId}
              locale={locale}
              page={page}
              option={option as DesignChoiceOption}
              values={values}
              theme={theme}
              draft={draft}
              scheme={scheme}
              state={rowStateOf(values, page.id, option.id)}
              canEdit={canEdit}
              onPick={(value) => onPick(page.id, option.id, value)}
            />
          )
        })}
      </section>
    </div>
  )
}
