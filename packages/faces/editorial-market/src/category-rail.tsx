// The sticky category rail: one link per top-level section, the one being read underlined. The
// active section follows the scroll (the last section above a reading line near the top of the
// screen, both ways) and the rail scrolls itself sideways to keep that link in the middle; it never scrolls
// the page. A section the guest's filters have emptied loses its link.

import type { Locale, ViewSection } from '@restro/shell'
import { useEffect, useRef, useState } from 'react'

import {
  type Filters,
  hasVisibleItems,
  isFiltering,
  langOf,
  prefersReducedMotion,
  sectionDomId,
} from './model'

/** How far down the screen the reading line sits: below the rail, and a third of the way down. */
const readingLine = () => Math.max(120, window.innerHeight * 0.3)

/**
 * The id of the section being read, and a way to set it when a link is tapped. The section being
 * read is the last one whose top has passed the reading line, so it is the same going down and going
 * back up: no section has to be "inside" a band for the answer to move (S7).
 */
function useActiveSection(ids: readonly string[], filterKey: string) {
  const [active, setActive] = useState(ids[0] ?? '')
  const key = ids.join('|')

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `ids`; `filterKey` re-reads the page after the filters changed what is on it
  useEffect(() => {
    const elements = ids.flatMap((id) => {
      const element = document.getElementById(sectionDomId(id))
      return element === null ? [] : [{ id, element }]
    })
    if (elements.length === 0) return
    let frame = 0
    const read = () => {
      frame = 0
      const line = readingLine()
      let current = elements[0]?.id
      for (const { id, element } of elements) {
        const box = element.getBoundingClientRect()
        // A section the filters emptied takes no room and is never the one being read.
        if (box.height > 0 && box.top <= line) current = id
      }
      // At the very bottom of a page that scrolls, the last section on it is the one being read,
      // even when it is too short to reach the reading line.
      const root = document.documentElement
      if (
        root.scrollHeight > window.innerHeight &&
        window.innerHeight + window.scrollY >= root.scrollHeight - 2
      ) {
        for (const { id, element } of elements) {
          if (element.getBoundingClientRect().height > 0) current = id
        }
      }
      if (current !== undefined) setActive(current)
    }
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(read)
    }
    // Read once now (on mount, and after a filter change), not only when the page scrolls.
    schedule()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== 0) window.cancelAnimationFrame(frame)
    }
  }, [key, filterKey])

  return [active, setActive] as const
}

export function CategoryRail({
  sections,
  filters,
  label,
  page,
}: {
  readonly sections: readonly ViewSection[]
  readonly filters: Filters
  /** The name of the navigation, a word from the shell's strings. */
  readonly label: string
  readonly page: Locale
}) {
  const [active, setActive] = useActiveSection(
    sections.map((section) => section.id),
    `${[...filters.dietary].sort().join(',')};${[...filters.tags].sort().join(',')}`,
  )
  const rail = useRef<HTMLElement>(null)

  // Keep the active link in the middle of the rail, without moving the page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs again when the active link changes (it looks the link up in the DOM)
  useEffect(() => {
    const nav = rail.current
    const link = nav?.querySelector<HTMLElement>('a[aria-current="true"]')
    if (nav === null || nav === undefined || link === null || link === undefined) return
    const target = link.offsetLeft - (nav.clientWidth - link.clientWidth) / 2
    nav.scrollTo?.({
      left: Math.max(0, target),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }, [active])

  return (
    <nav ref={rail} className="rm-sections" aria-label={label} data-design-part="nav">
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${sectionDomId(section.id)}`}
          aria-current={active === section.id ? 'true' : undefined}
          lang={langOf(section.title, page)}
          hidden={isFiltering(filters) && !hasVisibleItems(section, filters)}
          onClick={() => setActive(section.id)}
        >
          {section.title.text}
        </a>
      ))}
    </nav>
  )
}
