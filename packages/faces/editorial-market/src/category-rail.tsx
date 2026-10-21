// The sticky category rail: one link per top-level section, the one being read underlined. The
// active section follows the scroll (an IntersectionObserver on a band near the top of the
// screen) and the rail scrolls itself sideways to keep that link in the middle; it never scrolls
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

/** The band of the screen in which a section counts as the one being read: below the rail, in the top 38 %. */
const READING_BAND = '-74px 0px -62% 0px'

/** The id of the section being read, and a way to set it when a link is tapped. */
function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0] ?? '')
  const key = ids.join('|')

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `ids`
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const byElement = new Map<Element, string>()
    for (const id of ids) {
      const element = document.getElementById(sectionDomId(id))
      if (element !== null) byElement.set(element, id)
    }
    if (byElement.size === 0) return
    const inBand = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = byElement.get(entry.target)
          if (id === undefined) continue
          if (entry.isIntersecting) inBand.add(id)
          else inBand.delete(id)
        }
        // The last section whose top has come into the band is the one being read.
        const current = ids.filter((id) => inBand.has(id)).at(-1)
        if (current !== undefined) setActive(current)
      },
      { rootMargin: READING_BAND, threshold: [0, 0.1] },
    )
    for (const element of byElement.keys()) observer.observe(element)
    return () => observer.disconnect()
  }, [key])

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
  const [active, setActive] = useActiveSection(sections.map((section) => section.id))
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
    <nav ref={rail} className="rm-sections" aria-label={label}>
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
