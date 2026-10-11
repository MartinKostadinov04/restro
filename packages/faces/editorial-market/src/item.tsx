// One item of the menu: a photo card (the photo on a "stage" panel with the badges in its corner)
// or, for an item without a photo, a clean text row. The whole card opens the dish page; the
// allergen codes open the allergen sheet. Every slot carries `data-slot`, and the card carries
// `data-item` and `data-state`, which is what the contract tests read.

import type { ViewItem } from '@restro/shell'

import { badgeKey, langOf, localeLang } from './model'
import { type PageContext, Photo, Slot, Text } from './parts'

/** All the badges of an item, in one `item.badges` slot: over the photo's corner, or above a text row. */
function Badges({ item, ctx }: { readonly item: ViewItem; readonly ctx: PageContext }) {
  return (
    <Slot name="item.badges" className="rm-badges">
      {item.badges.map((badge) => (
        <span key={badgeKey(badge)} className="rm-badge" lang={langOf(badge.label, ctx.locale)}>
          {badge.label.text}
        </span>
      ))}
    </Slot>
  )
}

/** The card of one item placement. `hidden` is the guest's filter: the item stays in the markup. */
export function Item({
  item,
  ctx,
  priority,
}: {
  readonly item: ViewItem
  readonly ctx: PageContext
  /** One of the first photos of the page: load it now. */
  readonly priority: boolean
}) {
  const { locale, strings, assetBase } = ctx
  const { image } = item
  const hasBadges = item.badges.length > 0
  const className = [
    'rm-item',
    priority ? 'is-priority' : '',
    image === null ? 'is-text' : 'has-photo',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article
      data-item={item.id}
      data-state={item.state.code}
      className={className}
      hidden={!ctx.isVisible(item)}
    >
      {image !== null ? (
        <Slot name="item.image" className="rm-photo">
          <Photo
            image={image}
            assetBase={assetBase}
            page={locale}
            sizes={priority ? '82vw' : '(max-width: 680px) 100vw, 640px'}
            loading={priority ? 'eager' : 'lazy'}
          />
          {hasBadges ? <Badges item={item} ctx={ctx} /> : null}
        </Slot>
      ) : null}
      <div className="rm-item-copy">
        {image === null && hasBadges ? <Badges item={item} ctx={ctx} /> : null}
        <button
          type="button"
          className="rm-item-open"
          onClick={(event) => ctx.openDish(item.id, event.currentTarget)}
        >
          <Slot name="item.name">
            <Text as="h3" value={item.name} page={locale} />
          </Slot>
          <span className="rm-chevron" aria-hidden="true">
            →
          </span>
          <span className="rm-sr">, {strings.more}</span>
        </button>
        {item.price !== null ? (
          <Slot name="item.price" className="rm-price">
            {item.price.text}
          </Slot>
        ) : null}
        <Slot name="item.state" className="rm-state" state={item.state.code}>
          {item.state.label !== null ? <Text value={item.state.label} page={locale} /> : null}
        </Slot>
        {item.description !== null ? (
          <Slot name="item.description" className="rm-description">
            <p
              lang={langOf(item.description, locale)}
              data-clamped={item.description.truncatable ? 'true' : 'false'}
            >
              {item.description.text}
            </p>
          </Slot>
        ) : null}
        {item.portion !== null ? (
          <Slot name="item.portion" className="rm-portion">
            {item.portion.text}
          </Slot>
        ) : null}
        {item.dietary.length > 0 ? (
          <Slot name="item.dietary" className="rm-labels">
            {item.dietary.map((label) => (
              <span key={label.code} lang={langOf(label.label, locale)}>
                {label.label.text}
              </span>
            ))}
          </Slot>
        ) : null}
        {item.tags.length > 0 ? (
          <Slot name="item.tags" className="rm-labels">
            {item.tags.map((tag) => (
              <span key={tag.id} lang={langOf(tag.label, locale)}>
                {tag.label.text}
              </span>
            ))}
          </Slot>
        ) : null}
        {item.allergens.length > 0 ? (
          <Slot name="item.allergens" className="rm-allergens">
            <button
              type="button"
              onClick={(event) => ctx.openAllergens(item.id, event.currentTarget)}
              aria-label={`${strings.allergens}: ${item.allergens.map((a) => a.label.text).join(', ')}`}
            >
              {item.allergens.map((allergen) => (
                <b key={allergen.code} data-allergen={allergen.code}>
                  {allergen.number}
                </b>
              ))}
            </button>
          </Slot>
        ) : null}
        {item.extraFields.length > 0 ? (
          <Slot name="item.extra_fields" className="rm-extra">
            {item.extraFields.map((field) => (
              <span key={field.key}>
                <Text value={field.label} page={locale} />{' '}
                <b lang={localeLang(field.lang, locale)}>{field.text}</b>
              </span>
            ))}
          </Slot>
        ) : null}
        {item.modifierGroups.length > 0 ? (
          <Slot name="item.modifiers" className="rm-modifiers">
            {item.modifierGroups.map((group) => (
              <p key={group.id}>
                <b lang={langOf(group.name, locale)}>{group.name.text}</b>
                {': '}
                {group.options.map((option, index) => (
                  <span key={option.id}>
                    {index > 0 ? ', ' : ''}
                    <span lang={langOf(option.name, locale)}>{option.name.text}</span>
                    {option.delta !== null ? ` ${option.delta.text}` : ''}
                  </span>
                ))}
              </p>
            ))}
          </Slot>
        ) : null}
        {item.order.askWaiter !== null ? (
          <Text as="p" className="rm-waiter" value={item.order.askWaiter} page={locale} />
        ) : null}
      </div>
    </article>
  )
}
