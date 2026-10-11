// The dish page: a full-screen dialog over the menu with the big photo, the name and price, the
// whole description (nothing is cut here), the state, the dietary labels, the allergens (with a
// button for the allergen sheet), the custom fields and the choices the dish offers. The choices
// are listed, not selected, unless the guest can order the dish (the venue switched ordering on,
// the host bound its services and the dish has ordering controls): then they are chosen here, with
// a note, a quantity and "Add to bag" (services/dish-order.tsx).

import type { ViewItem } from '@restro/shell'
import { Fragment } from 'react'

import { InfoIcon } from './icons'
import { langOf, localeLang } from './model'
import { Overlay } from './overlay'
import { type PageContext, Photo, Text } from './parts'
import { DishOrder } from './services/dish-order'
import { useServices } from './services/provider'

function DishBody({
  item,
  ctx,
  onDone,
}: {
  readonly item: ViewItem
  readonly ctx: PageContext
  /** The dish went in the bag: close the page. */
  readonly onDone: () => void
}) {
  const { locale, strings, assetBase } = ctx
  const services = useServices()
  const ordering = services?.canOrder(item) === true
  return (
    <div className="rm-detail">
      {item.image !== null ? (
        <div className="rm-detail-photo">
          <Photo
            image={item.image}
            assetBase={assetBase}
            page={locale}
            sizes="min(100vw, 640px)"
            loading="eager"
          />
        </div>
      ) : null}
      <div className="rm-detail-copy">
        <div className="rm-detail-title">
          <Text as="h2" value={item.name} page={locale} />
          {item.price !== null ? <strong>{item.price.text}</strong> : null}
        </div>
        {item.description !== null ? <Text as="p" value={item.description} page={locale} /> : null}
        {item.state.label !== null ? (
          <Text as="p" className="rm-detail-state" value={item.state.label} page={locale} />
        ) : null}
        {item.dietary.length > 0 ? (
          <div className="rm-labels">
            {item.dietary.map((label) => (
              <span key={label.code} lang={langOf(label.label, locale)}>
                {label.label.text}
              </span>
            ))}
          </div>
        ) : null}
        {item.allergens.length > 0 ? (
          <p className="rm-detail-allergens">
            <b>{strings.allergens}:</b>{' '}
            {item.allergens.map((allergen, index) => (
              <Fragment key={allergen.code}>
                {index > 0 ? ' · ' : ''}
                <span lang={langOf(allergen.label, locale)}>{allergen.label.text}</span>
              </Fragment>
            ))}
          </p>
        ) : null}
        {item.extraFields.map((field) => (
          <p className="rm-detail-extra" key={field.key}>
            <Text value={field.label} page={locale} />:{' '}
            <b lang={localeLang(field.lang, locale)}>{field.text}</b>
          </p>
        ))}
        {ordering ? (
          <DishOrder item={item} onDone={onDone} />
        ) : (
          item.modifierGroups.map((group) => (
            <div className="rm-detail-group" key={group.id}>
              <Text as="h3" value={group.name} page={locale} />
              <div className="rm-detail-options">
                {group.options.map((option) => (
                  <div className="rm-detail-option" key={option.id}>
                    <Text value={option.name} page={locale} />
                    <b>{option.delta?.text}</b>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
      {!ordering && item.price !== null ? (
        <div className="rm-detail-bar">
          <Text value={item.name} page={locale} />
          <strong>{item.price.text}</strong>
        </div>
      ) : null}
    </div>
  )
}

/** The dish page as a dialog named after the dish. */
export function DishPage({
  item,
  ctx,
  leaving,
  onClose,
}: {
  readonly item: ViewItem
  readonly ctx: PageContext
  /** The page is on its way out (the exit animation is playing). */
  readonly leaving: boolean
  readonly onClose: () => void
}) {
  const { strings } = ctx
  return (
    <Overlay
      title={item.name.text}
      titleLang={langOf(item.name, ctx.locale)}
      closeLabel={strings.back}
      onClose={onClose}
      detail
      leaving={leaving}
      extra={
        item.allergens.length > 0 ? (
          <button
            type="button"
            aria-label={strings.allergensTitle}
            onClick={(event) => ctx.openAllergens(item.id, event.currentTarget)}
          >
            <InfoIcon />
          </button>
        ) : null
      }
    >
      <DishBody item={item} ctx={ctx} onDone={onClose} />
    </Overlay>
  )
}
