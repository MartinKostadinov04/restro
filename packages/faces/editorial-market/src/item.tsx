// One item of the menu: a photo card (the photo on a "stage" panel with the badges in its corner)
// or, for an item without a photo, a clean text row. The whole card opens the dish page; the
// allergen codes open the allergen sheet. Every slot carries `data-slot`, and the card carries
// `data-item` and `data-state`, which is what the contract tests read. When the venue orders by
// phone, a "+" sits beside the price (services/quick-add.tsx); otherwise nothing is added.

import type { ViewItem } from '@restro/shell'

import { badgeKey, langOf, localeLang, photoSizes } from './model'
import { type PageContext, Photo, Slot, Text } from './parts'
import { QuickAdd } from './services/quick-add'

/** All the badges of an item, in one `item.badges` slot: over the photo's corner, or above a text row. */
function Badges({ item, ctx }: { readonly item: ViewItem; readonly ctx: PageContext }) {
  return (
    <Slot name="item.badges" className="rm-badges" part="item.marks">
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
  strip = false,
  nameLevel = 3,
}: {
  readonly item: ViewItem
  readonly ctx: PageContext
  /** One of the first photos of the page: load it now. */
  readonly priority: boolean
  /** The item is a card of the photo-led strip (its photo has a size of its own). */
  readonly strip?: boolean
  /** The heading level of the name: 3 under a section, 4 under a sub-section. */
  readonly nameLevel?: 3 | 4
}) {
  const { locale, strings, assetBase } = ctx
  const Name = nameLevel === 3 ? 'h3' : 'h4'
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
      data-design-part="item"
      className={className}
      hidden={!ctx.isVisible(item)}
    >
      {image !== null ? (
        <Slot name="item.image" className="rm-photo" part="item.photo">
          <Photo
            image={image}
            assetBase={assetBase}
            page={locale}
            sizes={photoSizes(ctx.layout, strip, ctx.bleedPhotos)}
            loading={priority ? 'eager' : 'lazy'}
          />
          {hasBadges ? <Badges item={item} ctx={ctx} /> : null}
        </Slot>
      ) : null}
      <div className="rm-item-copy">
        {image === null && hasBadges ? <Badges item={item} ctx={ctx} /> : null}
        {/* The name is the item's heading, and the button inside it opens the dish page: a button may
            not hold a heading, a heading may hold a button. The arrow after the name is the
            button's ::after. */}
        <Slot name="item.name" part="item.name">
          <Name lang={langOf(item.name, locale)}>
            <button
              type="button"
              className="rm-item-open"
              data-slot="item.open"
              aria-haspopup="dialog"
              onClick={(event) => ctx.openDish(item.id, event.currentTarget)}
            >
              {item.name.text}
            </button>
          </Name>
        </Slot>
        {item.price !== null ? (
          <Slot name="item.price" className="rm-price" part="item.price">
            {item.price.text}
          </Slot>
        ) : null}
        <QuickAdd item={item} />
        <Slot name="item.state" className="rm-state" state={item.state.code}>
          {item.state.label !== null ? <Text value={item.state.label} page={locale} /> : null}
        </Slot>
        {item.description !== null ? (
          <Slot name="item.description" className="rm-description" part="item.description">
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
          <Slot name="item.dietary" className="rm-labels" part="item.labels">
            {item.dietary.map((label) => (
              <span key={label.code} lang={langOf(label.label, locale)}>
                {label.label.text}
              </span>
            ))}
          </Slot>
        ) : null}
        {item.tags.length > 0 ? (
          <Slot name="item.tags" className="rm-labels" part="item.labels">
            {item.tags.map((tag) => (
              <span key={tag.id} lang={langOf(tag.label, locale)}>
                {tag.label.text}
              </span>
            ))}
          </Slot>
        ) : null}
        {item.allergens.length > 0 ? (
          <Slot name="item.allergens" className="rm-allergens" part="item.allergens">
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
          <Slot name="item.modifiers" className="rm-modifiers" part="item.choices">
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
