// One section of the menu: its title, description and image, then its own items, then its
// sub-sections (the reading order of R2). The first top-level section can be the photo-led
// "feature" strip. A section the guest's filters have emptied is hidden, and so is a section
// whose sub-sections are all hidden.

import type { ViewSection } from '@restro/shell'
import type { ReactNode } from 'react'

import { Item } from './item'
import { type Filters, hasVisibleItems, isFiltering, sectionDomId } from './model'
import { type PageContext, Photo, Text } from './parts'

/** The first items of the feature strip are the first thing on the page: load their photos now. */
const EAGER_PHOTOS = 3

export function SectionBlock({
  section,
  ctx,
  filters,
  level = 2,
  feature = false,
  tools,
}: {
  readonly section: ViewSection
  readonly ctx: PageContext
  readonly filters: Filters
  /** The heading level of the title: 2 for a section, 3 for a sub-section. */
  readonly level?: 2 | 3
  /** Draw this section as the photo-led strip. */
  readonly feature?: boolean
  /** Controls that belong under the title (the layout switch). */
  readonly tools?: ReactNode
}) {
  const { locale, assetBase } = ctx
  const Title = level === 2 ? 'h2' : 'h3'
  return (
    <section
      id={sectionDomId(section.id)}
      className={feature ? 'rm-section is-feature' : 'rm-section'}
      hidden={isFiltering(filters) && !hasVisibleItems(section, filters)}
    >
      <div className="rm-section-head">
        {section.image !== null ? (
          <Photo
            image={section.image}
            assetBase={assetBase}
            page={locale}
            sizes="(min-width: 821px) 752px, (min-width: 641px) calc(100vw - 68px), calc(100vw - 40px)"
          />
        ) : null}
        <Text as={Title} value={section.title} page={locale} />
        {section.description !== null ? (
          <Text as="p" value={section.description} page={locale} />
        ) : null}
        {tools}
      </div>
      <div className="rm-items">
        {section.items.map((item, index) => (
          <Item
            key={item.id}
            item={item}
            ctx={ctx}
            priority={feature && index < EAGER_PHOTOS}
            strip={feature}
            nameLevel={level === 2 ? 3 : 4}
          />
        ))}
      </div>
      {section.sections.map((child) => (
        <SectionBlock key={child.id} section={child} ctx={ctx} filters={filters} level={3} />
      ))}
    </section>
  )
}
