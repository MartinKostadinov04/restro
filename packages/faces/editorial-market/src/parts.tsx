// The three small parts every other component draws with, and the page context they share:
// `Text` (a menu text in its own language), `Slot` (a named piece of an item, which is what the
// contract tests read) and `Photo` (an image with a srcset and reserved space).

import type { GuestStrings, Locale, ViewImage, ViewItem, ViewText } from '@restro/shell'
import type { ReactNode } from 'react'

import { imageAttributes, type Layout, langOf } from './model'

/** What the components of one page need from it. */
export interface PageContext {
  readonly locale: Locale
  readonly strings: GuestStrings
  readonly assetBase: string
  /** How the items of a section are laid out now (the photos' `sizes` follow it). */
  readonly layout: Layout
  /** Whether an item passes the guest's filters; one that does not stays in the markup, hidden. */
  readonly isVisible: (item: ViewItem) => boolean
  /** Opens the dish page for an item (the element that asked gets the focus back). */
  readonly openDish: (itemId: string, opener: HTMLElement) => void
  /** Opens the allergen sheet for an item (the element that asked gets the focus back). */
  readonly openAllergens: (itemId: string, opener: HTMLElement) => void
}

/** A text in its own language: `lang` is set only when it differs from the page (R3). */
export function Text({
  value,
  page,
  as: Tag = 'span',
  className,
  id,
  part,
}: {
  readonly value: ViewText
  readonly page: Locale
  readonly as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4'
  readonly className?: string
  readonly id?: string
  /** The part of the design this is (`data-design-part`, D130). */
  readonly part?: string
}) {
  return (
    <Tag id={id} className={className} lang={langOf(value, page)} data-design-part={part}>
      {value.text}
    </Tag>
  )
}

/** A named piece of an item. `state` is the item's state code on the `item.state` slot (R5). */
export function Slot({
  name,
  className,
  state,
  part,
  children,
}: {
  readonly name: string
  readonly className?: string
  readonly state?: string
  /** The part of the design this is (`data-design-part`, D130). */
  readonly part?: string
  readonly children?: ReactNode
}) {
  return (
    <div data-slot={name} data-state={state} data-design-part={part} className={className}>
      {children}
    </div>
  )
}

/**
 * A photo: the shell's pick as `src`, all its files as `srcset` and the original's proportions as
 * `width` and `height`, so nothing jumps while it loads. The crop follows the focal point.
 */
export function Photo({
  image,
  assetBase,
  page,
  sizes,
  className,
  loading = 'lazy',
  part,
}: {
  readonly image: ViewImage
  readonly assetBase: string
  readonly page: Locale
  readonly sizes: string
  readonly className?: string
  /** `eager` loads now (the logo, the first photos, the dish page); `lazy` when it comes near the screen. */
  readonly loading?: 'eager' | 'lazy'
  /** The part of the design this is (`data-design-part`, D130). */
  readonly part?: string
}) {
  const { objectPosition, ...attributes } = imageAttributes(image, assetBase, sizes)
  return (
    // biome-ignore lint/performance/noImgElement: the face is framework-free; photos are fixed-size webp variants with a srcset
    <img
      {...attributes}
      className={className}
      data-design-part={part}
      alt={image.alt === null ? '' : image.alt.text}
      lang={image.alt === null ? undefined : langOf(image.alt, page)}
      style={{ objectPosition }}
      loading={loading}
    />
  )
}
