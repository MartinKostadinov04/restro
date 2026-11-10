// The ordering part of the dish page: the choice groups (with their limits and a message when the
// guest has not chosen enough), a note for the kitchen, a quantity and "Add to bag" with the price
// as it moves. It replaces the page's read-only list of choices whenever ordering is on for the
// dish. The line goes onto the table's order (`order.add`, with the choices and the note). Where
// the POS's ticket takes neither (#78) the page draws no choices and no note field: it says the
// staff are told instead, and a dish that needs a choice is ordered from the waiter.

import {
  draftPrice,
  groupValid,
  needsChoices,
  SERVICE_LIMITS,
  type Selection,
  selectedOptionIds,
  selectionValid,
  toggleOption,
  type ViewItem,
  type ViewModifierGroup,
} from '@restro/shell'
import { useState } from 'react'

import { langOf } from '../model'
import { Text } from '../parts'
import { ChoiceGroup } from './choice'
import { Stepper } from './parts'
import { useServices } from './provider'

export function DishOrder({
  item,
  onDone,
}: {
  readonly item: ViewItem
  /** The line went in the bag: close the page. */
  readonly onDone: () => void
}) {
  const o = useServices()
  const [selection, setSelection] = useState<Selection>({})
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  if (o === null) return null
  const { words, locale } = o

  // Where the ticket takes no choices and no note, the page draws neither.
  const choices = o.notesAndOptions
  if (!choices && needsChoices(item)) {
    return (
      <p className="ro-notice" data-slot="item.order_from_waiter">
        {words.orderFromWaiter}
      </p>
    )
  }

  const valid = selectionValid(item.modifierGroups, selection)
  const optionIds = selectedOptionIds(item.modifierGroups, selection)
  const price = draftPrice(o.view, item, optionIds, qty)

  const choose = (group: ViewModifierGroup, picked: readonly string[], optionId: string) =>
    setSelection({ ...selection, [group.id]: toggleOption(group, picked, optionId) })

  const add = () => {
    if (!valid) {
      setTried(true)
      return
    }
    void o.add(item, choices ? { optionIds, qty, note } : { qty })
    onDone()
  }

  return (
    <div className="ro-dish">
      {(choices ? item.modifierGroups : []).map((group) => {
        const picked = selection[group.id] ?? []
        const invalid = tried && !groupValid(group, picked)
        const required = group.required || group.min > 0
        const limit =
          group.max === 1
            ? words.pickOne
            : group.max > 1
              ? words.pickUpTo(group.max)
              : words.pickAtLeast(Math.max(1, group.min))
        return (
          <fieldset key={group.id} className={invalid ? 'ro-group is-invalid' : 'ro-group'}>
            <legend>
              <Text value={group.name} page={locale} />
              <small>
                {required ? words.required : words.optional} · {limit}
              </small>
            </legend>
            {group.max === 1 ? (
              <ChoiceGroup
                label={group.name.text}
                className="ro-options"
                value={picked[0] ?? null}
                onChoose={(id) => choose(group, picked, id)}
                choices={group.options.map((option) => ({
                  key: option.id,
                  lang: langOf(option.name, locale),
                  label: (
                    <>
                      <span>{option.name.text}</span>
                      {option.delta === null ? null : <b>{option.delta.text}</b>}
                    </>
                  ),
                }))}
              />
            ) : (
              <div className="ro-options">
                {group.options.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    aria-pressed={picked.includes(option.id)}
                    lang={langOf(option.name, locale)}
                    onClick={() => choose(group, picked, option.id)}
                  >
                    <span>{option.name.text}</span>
                    {option.delta === null ? null : <b>{option.delta.text}</b>}
                  </button>
                ))}
              </div>
            )}
          </fieldset>
        )
      })}
      {choices ? (
        <label className="ro-note">
          <span>{words.note}</span>
          <textarea
            rows={2}
            value={note}
            maxLength={SERVICE_LIMITS.note}
            placeholder={words.notePlaceholder}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
      ) : (
        <p className="ro-allergy" data-notes-at-staff="">
          {words.notesAtStaff}
        </p>
      )}
      <div className="ro-dish-bar">
        <Stepper value={qty} min={1} onChange={setQty} label={item.name.text} words={words} />
        <button
          type="button"
          className="ro-primary"
          data-design-part="button"
          onClick={add}
          aria-disabled={!valid}
        >
          <span>{words.addToBag}</span>
          {price === null ? null : <b key={price.minor}>{price.text}</b>}
        </button>
      </div>
    </div>
  )
}
