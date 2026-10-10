// One item card (doc "The face contract", slots): the photo, the name (never cut), the price, the
// state, the description (three lines and "More"), the portion, dietary labels and tags, the
// allergen codes, the custom fields and the modifier groups. Every slot carries `data-slot`, and
// the card carries `data-item`, which is what the contract tests read.

import type { GuestStrings, ViewImage, ViewItem, ViewModel, ViewText } from '@restro/shell'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { assetUrl, bcp47, langOf } from './model'

/** What every card needs from the page. */
export interface CardContext {
  readonly locale: ViewModel['locale']
  readonly strings: GuestStrings
  readonly assetBase: string
  /** Opens the allergen sheet for an item (the element that asked gets the focus back). */
  readonly openAllergens: (item: ViewItem, trigger: HTMLElement) => void
}

/** A text in its own language: `lang` is set only when it differs from the page. */
export function Text({
  text,
  locale,
  as: Tag = 'span',
  className,
  slot,
  id,
}: {
  readonly text: ViewText
  readonly locale: ViewModel['locale']
  readonly as?: 'span' | 'p' | 'h1' | 'h2' | 'h3' | 'h4'
  readonly className?: string
  readonly slot?: string
  readonly id?: string
}) {
  return (
    <Tag id={id} className={className} lang={langOf(text, locale)} data-slot={slot}>
      {text.text}
    </Tag>
  )
}

/** A photo: the shell's pick as `src`, all its files as `srcset`, and a reserved box so nothing jumps. */
export function Photo({
  image,
  assetBase,
  locale,
  sizes,
  className,
}: {
  readonly image: ViewImage
  readonly assetBase: string
  readonly locale: ViewModel['locale']
  readonly sizes: string
  readonly className?: string
}) {
  const width = image.width > 0 ? image.width : 640
  const alt = image.alt
  return (
    // biome-ignore lint/performance/noImgElement: the face is framework-free; photos are fixed-size webp variants with a srcset
    <img
      className={className}
      src={assetUrl(assetBase, image.src)}
      srcSet={image.variants
        .filter((file) => file.width > 0)
        .map((file) => `${assetUrl(assetBase, file.src)} ${file.width}w`)
        .join(', ')}
      sizes={sizes}
      width={width}
      height={Math.round((width * 3) / 4)}
      alt={alt === null ? '' : alt.text}
      lang={alt === null ? undefined : langOf(alt, locale)}
      style={{ objectPosition: image.objectPosition }}
      loading="lazy"
      decoding="async"
    />
  )
}

/** About three lines of a phone-width card; a longer text is assumed to need "More" until measured. */
const LONG_TEXT = 110

function Description({
  text,
  locale,
  strings,
}: {
  readonly text: ViewItem['description'] & object
  readonly locale: ViewModel['locale']
  readonly strings: GuestStrings
}) {
  const id = useId()
  const paragraph = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(text.text.length > LONG_TEXT)

  // Show "More" only when the three lines really cut something; measured again when the card
  // resizes (rotation, language, font loading).
  useEffect(() => {
    const node = paragraph.current
    if (node === null || expanded) return
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [expanded])

  return (
    <div data-slot="item.description">
      <p
        ref={paragraph}
        id={id}
        className="rq-desc"
        lang={langOf(text, locale)}
        data-clamped={text.truncatable && !expanded ? 'true' : 'false'}
      >
        {text.text}
      </p>
      {text.truncatable && (overflowing || expanded) ? (
        <button
          type="button"
          className="rq-more"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? strings.less : strings.more}
        </button>
      ) : null}
    </div>
  )
}

function Pills({ slot, children }: { readonly slot: string; readonly children: ReactNode }) {
  return (
    <ul className="rq-meta" data-slot={slot}>
      {children}
    </ul>
  )
}

/** The card of one item placement. */
export function ItemCard({
  item,
  ctx,
  level,
}: {
  readonly item: ViewItem
  readonly ctx: CardContext
  /** Heading level of the item name (3 for an item of a section, 4 inside a sub-section). */
  readonly level: 3 | 4
}) {
  const { locale, strings, assetBase } = ctx
  const Name = level === 3 ? 'h3' : 'h4'
  const stateLabel = item.state.label
  return (
    <li className="rq-item" data-item={item.id} data-state={item.state.code}>
      {item.image !== null ? (
        <div className="rq-item-media" data-slot="item.image">
          <Photo
            image={item.image}
            assetBase={assetBase}
            locale={locale}
            sizes="(min-width: 640px) 606px, calc(100vw - 34px)"
          />
        </div>
      ) : null}
      <div className="rq-item-body">
        <div className="rq-item-head">
          <Text
            text={item.name}
            locale={locale}
            as={Name}
            className="rq-item-name"
            slot="item.name"
          />
          {item.price !== null ? (
            <span className="rq-price" data-slot="item.price" data-from={item.price.from}>
              {item.price.text}
            </span>
          ) : null}
        </div>

        <p
          className="rq-state"
          data-slot="item.state"
          data-state={item.state.code}
          lang={stateLabel === null ? undefined : langOf(stateLabel, locale)}
        >
          {stateLabel?.text}
        </p>

        {item.description !== null ? (
          <Description text={item.description} locale={locale} strings={strings} />
        ) : null}

        {item.portion !== null ? (
          <p className="rq-pill" data-slot="item.portion" style={{ justifySelf: 'start' }}>
            {item.portion.text}
          </p>
        ) : null}
        {item.dietary.length > 0 ? (
          <Pills slot="item.dietary">
            {item.dietary.map((label) => (
              <li key={label.code} className="rq-pill" lang={langOf(label.label, locale)}>
                {label.label.text}
              </li>
            ))}
          </Pills>
        ) : null}
        {item.tags.length > 0 ? (
          <Pills slot="item.tags">
            {item.tags.map((tag) => (
              <li key={tag.id} className="rq-pill" lang={langOf(tag.label, locale)}>
                {tag.label.text}
              </li>
            ))}
          </Pills>
        ) : null}
        {item.badges.length > 0 ? (
          <Pills slot="item.badges">
            {item.badges.map((badge) => (
              <li
                key={`${badge.kind}:${badge.label.text}`}
                className="rq-pill"
                data-kind={badge.kind}
                lang={langOf(badge.label, locale)}
              >
                {badge.label.text}
              </li>
            ))}
          </Pills>
        ) : null}

        {item.allergens.length > 0 ? (
          <fieldset
            className="rq-allergens"
            data-slot="item.allergens"
            aria-label={strings.allergens}
          >
            {item.allergens.map((allergen) => (
              <button
                key={allergen.code}
                type="button"
                className="rq-allergen"
                aria-label={allergen.label.text}
                title={allergen.label.text}
                data-allergen={allergen.code}
                lang={langOf(allergen.label, locale)}
                onClick={(event) => ctx.openAllergens(item, event.currentTarget)}
              >
                <span className="rq-allergen-code" aria-hidden="true">
                  {allergen.number}
                </span>
              </button>
            ))}
          </fieldset>
        ) : null}

        {item.extraFields.length > 0 ? (
          <dl className="rq-fields" data-slot="item.extra_fields">
            {item.extraFields.map((field) => (
              <div key={field.key} style={{ display: 'contents' }}>
                <dt lang={langOf(field.label, locale)}>{field.label.text}</dt>
                <dd
                  lang={
                    field.lang === null || field.lang === locale ? undefined : bcp47(field.lang)
                  }
                >
                  {field.text}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {item.modifierGroups.length > 0 ? (
          <div className="rq-groups" data-slot="item.modifiers">
            {item.modifierGroups.map((group) => (
              <p key={group.id}>
                <span className="rq-group-name" lang={langOf(group.name, locale)}>
                  {group.name.text}
                </span>
                {': '}
                <span className="rq-options">
                  {group.options.map((option, index) => (
                    <span key={option.id}>
                      {index > 0 ? ', ' : ''}
                      <span lang={langOf(option.name, locale)}>{option.name.text}</span>
                      {option.delta !== null ? ` ${option.delta.text}` : ''}
                    </span>
                  ))}
                </span>
              </p>
            ))}
          </div>
        ) : null}

        {item.order.askWaiter !== null ? (
          <p className="rq-note" lang={langOf(item.order.askWaiter, locale)}>
            {item.order.askWaiter.text}
          </p>
        ) : null}
      </div>
    </li>
  )
}
