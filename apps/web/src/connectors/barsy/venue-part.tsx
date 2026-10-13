'use client'

// The barsy part of a venue's Menu source card (B2, D91 point 10): which barsy price this venue's
// menu shows. Per venue, because barsy prices by venue (D73). Base price (`actual_price`) is the
// default; Current price (`current_price`) carries a warning that time-based price rules may show
// late until Lukanet answers Q43. Shown only for the venues of a barsy instance.
//
// Ported from the Menu source card's price form (CF-09b); changed: it is the connector's part, not
// the card's, and saves through the generic venue-source action.
import { AlertTriangleIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { ErrorNote, Notice } from '@/integration/error-note'
import { saveVenueSourceAction } from '@/server/integration/actions'
import type { IntegrationErrorCode } from '@/server/integration/view'

import type { BarsyPriceSource, BarsyVenueSource } from '../data'

const CHOICES = [
  ['actual_price', 'actual'],
  ['current_price', 'current'],
] as const

export function BarsyVenuePart({
  venueId,
  canManage,
  data,
}: {
  venueId: string
  canManage: boolean
  data: BarsyVenueSource
}) {
  const t = useTranslations('connectors.barsy.price')
  const formId = useId()
  const [priceSource, setPriceSource] = useState<BarsyPriceSource>(data.priceSource)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const result = await saveVenueSourceAction({ venueId, settings: { priceSource } })
      if (result.ok) setSaved(true)
      else setError(result.error)
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-3" data-testid="price-form">
      <fieldset className="grid gap-2" disabled={!canManage}>
        <legend className="mb-1 text-sm font-medium">{t('legend')}</legend>
        {CHOICES.map(([value, key]) => (
          <label
            key={value}
            className="flex items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:opacity-70"
          >
            <input
              type="radio"
              name={`${formId}-price`}
              className="mt-0.5 size-4 accent-primary"
              checked={priceSource === value}
              onChange={() => {
                setPriceSource(value)
                setSaved(false)
              }}
            />
            <span className="grid gap-0.5">
              <span className="font-medium">
                {t(key)}
                {value === 'actual_price' ? (
                  <span className="ms-1.5 font-normal text-muted-foreground">({t('default')})</span>
                ) : null}
              </span>
              <span className="text-xs text-muted-foreground">{t(`${key}Help`)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {priceSource === 'current_price' ? (
        <Alert className="border-warning/40 [&>svg]:text-warning" data-testid="price-warning">
          <AlertTriangleIcon aria-hidden />
          <AlertDescription>{t('warning')}</AlertDescription>
        </Alert>
      ) : null}
      <ErrorNote code={error} source="barsy" />
      {saved ? <Notice>{t('saved')}</Notice> : null}
      {canManage ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending || priceSource === data.priceSource}>
            {pending ? t('saving') : t('save')}
          </Button>
        </div>
      ) : null}
    </form>
  )
}
