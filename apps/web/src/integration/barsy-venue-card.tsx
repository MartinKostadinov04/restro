'use client'

// The barsy venue picker: the venues of the installation (cached by the connection check), by
// name. Choosing one maps it to THIS venue; one barsy venue serves one venue and the other way
// round, so a barsy venue that belongs to another venue is shown but cannot be chosen. A barsy
// venue's own id is only handed back to the server action; it is never drawn.
import { StoreIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useOptimistic, useState, useTransition } from 'react'

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { FormSection } from '@/components/ui/form-section'
import { chooseBarsyVenueAction } from '@/server/integration/actions'
import type { IntegrationErrorCode, IntegrationView } from '@/server/integration/view'

import { ErrorNote } from './error-note'

export function BarsyVenueCard({ venueId, view }: { venueId: string; view: IntegrationView }) {
  const t = useTranslations('integration.barsyVenue')
  const groupName = useId()
  const chosenNow = view.barsyVenues.find((option) => option.mappedHere)?.key ?? null
  const [chosen, setChosen] = useOptimistic(chosenNow)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [pending, startTransition] = useTransition()
  const editable = view.canManage

  function choose(key: number) {
    if (key === chosen) return
    setError(null)
    startTransition(async () => {
      setChosen(key)
      const result = await chooseBarsyVenueAction({ venueId, bid: key })
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <FormSection title={t('title')} description={t('description')}>
      {view.barsyVenues.length === 0 ? (
        <Empty className="min-h-40" data-testid="barsy-venues-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <StoreIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t('empty.title')}</EmptyTitle>
            <EmptyDescription>{t('empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <fieldset className="grid gap-2" disabled={pending}>
          <legend className="sr-only">{t('legend')}</legend>
          {view.barsyVenues.map((option) => {
            const taken = option.usedBy !== null
            return (
              <label
                key={option.key}
                className="flex items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:opacity-60"
                data-testid="barsy-venue-option"
              >
                <input
                  type="radio"
                  name={groupName}
                  className="mt-0.5 size-4 accent-primary"
                  checked={chosen === option.key}
                  disabled={taken || !editable}
                  onChange={() => choose(option.key)}
                />
                <span className="grid gap-0.5">
                  <span className="font-medium">{option.name}</span>
                  {taken ? (
                    <span className="text-xs text-muted-foreground">
                      {t('usedBy', { venue: option.usedBy ?? '' })}
                    </span>
                  ) : null}
                </span>
              </label>
            )
          })}
          {editable && chosenNow !== null ? (
            <p className="text-xs text-muted-foreground">{t('switchHint')}</p>
          ) : null}
        </fieldset>
      )}
      <ErrorNote code={error} />
    </FormSection>
  )
}
