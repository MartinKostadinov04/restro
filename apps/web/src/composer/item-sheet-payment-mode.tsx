'use client'

// The item sheet's "Payment mode" row (#218; plan: #201 comment, part B; D113, D122 §5): three radio
// cards in place of the generic pencil, Select, Save and "Clear value". Tapping a card shows the
// choice at once and saves it (null = "Same as the venue"); the card goes back if the save is
// refused. It takes effect at the menu's next Publish, as every composer change does.
import { PAYMENT_MODES, type PaymentMode } from '@restro/core'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useId, useState } from 'react'

import { useFieldLabel } from '@/fields/field-row'
import type { SheetField } from '@/server/item-sheet/types'

/** The item's own choice, or null for "Same as the venue". */
export type ItemPaymentChoice = PaymentMode | null

/** What a saved value of the field means: a mode, or none. */
export function paymentChoiceOf(value: unknown): ItemPaymentChoice {
  return PAYMENT_MODES.find((mode) => mode === value) ?? null
}

/** A mode's label inside a sentence: lower case in Bulgarian, as the plan words it. */
export function useModeInSentence(): (mode: PaymentMode) => string {
  const modes = useTranslations('options.payment_mode')
  const locale = useLocale()
  return (mode) => (locale === 'bg' ? modes(mode).toLocaleLowerCase('bg') : modes(mode))
}

export function ItemPaymentModeRow({
  field,
  venueMode,
  busy,
  onChange,
}: {
  field: SheetField
  /** The venue's item default, shown beside "Same as the venue". */
  venueMode: PaymentMode
  busy: boolean
  /** Saves the choice; resolves true when it was saved. */
  onChange: (next: ItemPaymentChoice) => Promise<boolean>
}) {
  const t = useTranslations('ownerSettings')
  const modes = useTranslations('options.payment_mode')
  const inSentence = useModeInSentence()
  const label = useFieldLabel(field.definition)
  const group = useId()
  const saved = paymentChoiceOf(field.value)
  // What the cards show: the tap at once, before the server answers; the saved value again when
  // that changes (this save, an Undo, a reload) or when the save is refused.
  const [shown, setShown] = useState<ItemPaymentChoice>(saved)
  useEffect(() => {
    setShown(saved)
  }, [saved])

  async function pick(next: ItemPaymentChoice) {
    if (next === shown) return
    setShown(next)
    if (!(await onChange(next))) setShown(saved)
  }

  const cards: readonly {
    readonly value: ItemPaymentChoice
    readonly testId: string
    readonly title: string
    readonly detail: string | null
  }[] = [
    {
      value: null,
      testId: 'payment-mode-same',
      title: t('pf_i_same', { mode: inSentence(venueMode) }),
      detail: null,
    },
    {
      value: 'pay_first',
      testId: 'payment-mode-pay_first',
      title: modes('pay_first'),
      detail: t('pf_i_first_d'),
    },
    {
      value: 'on_bill',
      testId: 'payment-mode-on_bill',
      title: modes('on_bill'),
      detail: t('pf_i_bill_d'),
    },
  ]

  return (
    <div
      data-testid="field-row"
      data-field-key={field.key}
      className="grid gap-2 border-t px-4 py-4 first:border-t-0"
    >
      <dt className="text-sm/6 font-medium text-foreground">
        <span id={`${group}-label`}>{label}</span>
      </dt>
      <dd>
        <fieldset className="grid gap-2" disabled={busy} aria-labelledby={`${group}-label`}>
          {cards.map((card) => (
            <label
              key={card.testId}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-checked:border-primary has-checked:bg-accent has-disabled:cursor-not-allowed has-disabled:opacity-60"
            >
              <input
                type="radio"
                name={group}
                checked={shown === card.value}
                onChange={() => void pick(card.value)}
                className="mt-1 accent-primary"
                data-testid={card.testId}
              />
              <span className="grid min-w-0 gap-0.5">
                <span className="break-words text-sm font-medium">{card.title}</span>
                {card.detail === null ? null : (
                  <span className="break-words text-xs text-muted-foreground">{card.detail}</span>
                )}
              </span>
            </label>
          ))}
        </fieldset>
      </dd>
    </div>
  )
}
