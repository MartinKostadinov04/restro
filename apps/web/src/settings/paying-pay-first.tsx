'use client'

// The "Pay first" card on Settings › Paying (#216; plan: #201 comment, part B; D113, D122 §5): the
// venue's item default as two radio cards, and "Pay first at every table" as a switch. Every control
// saves at once with Undo (`pay_first.set`, one change at a time, so it never overwrites another
// save). The areas and tables that differ are counted here and set in Tables & QR. A role without
// `settings.connect_payments` sees the same, read-only. The page shows the card only where pay first
// can take effect, so there is nothing to hide in here.
import { PAYMENT_MODES, type PaymentMode } from '@restro/core'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useId, useState } from 'react'

import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { savePayFirstAction } from '@/server/settings/paying-actions'
import type { PayFirstCard, PayingView } from '@/server/settings/paying-view'

import type { useSettingsRun } from './use-settings-run'

export function PayingPayFirstCard({
  view,
  card,
  runner,
}: {
  view: PayingView
  card: PayFirstCard
  runner: ReturnType<typeof useSettingsRun>
}) {
  const t = useTranslations('ownerSettings')
  const modes = useTranslations('options.payment_mode')
  const locale = useLocale()
  const group = useId()
  const { pending, run } = runner
  const can = view.canConnect
  const venueId = view.venueId
  // What the controls show: the choice at once, before the server answers. It follows the saved
  // value when that changes (this save, an Undo, another owner) and returns to it if a save fails.
  const [shown, setShown] = useState({ itemMode: card.itemMode, applies: card.applies })
  useEffect(() => {
    setShown({ itemMode: card.itemMode, applies: card.applies })
  }, [card.itemMode, card.applies])
  const backToSaved = () => setShown({ itemMode: card.itemMode, applies: card.applies })

  /** The option's label inside a sentence: lower case in Bulgarian, as the plan words it. */
  const inSentence = (mode: PaymentMode): string =>
    locale === 'bg' ? modes(mode).toLocaleLowerCase('bg') : modes(mode)
  const words = (error: string): string | undefined =>
    error === 'failed' ? t('pf_err_save') : undefined

  function setItemMode(next: PaymentMode) {
    const previous = card.itemMode
    if (next === previous) return
    setShown((now) => ({ ...now, itemMode: next }))
    run(() => savePayFirstAction({ venueId, change: { itemMode: next } }), {
      done: t('pf_toast_default', { mode: inSentence(next) }),
      words,
      onFail: backToSaved,
      undo: () => savePayFirstAction({ venueId, change: { itemMode: previous } }),
    })
  }

  function setApplies(next: boolean) {
    const previous = card.applies
    setShown((now) => ({ ...now, applies: next }))
    run(() => savePayFirstAction({ venueId, change: { applies: next } }), {
      done: next ? t('pf_toast_on') : t('pf_toast_off'),
      words,
      onFail: backToSaved,
      undo: () => savePayFirstAction({ venueId, change: { applies: previous } }),
    })
  }

  return (
    <section className="grid gap-4 rounded-lg border bg-card p-3" data-testid="paying-pay-first">
      <div className="grid gap-1">
        <h3 className="font-medium">{t('pf_title')}</h3>
        <p className="text-sm text-muted-foreground">{t('pf_lede')}</p>
      </div>

      <fieldset className="grid gap-2" disabled={pending}>
        <legend className="mb-2 text-sm font-medium">{t('pf_default_t')}</legend>
        {PAYMENT_MODES.map((mode) => {
          const checked = shown.itemMode === mode
          // Read-only: only the venue's choice is shown, as text.
          if (!can && !checked) return null
          return can ? (
            <label
              key={mode}
              className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-checked:border-primary has-checked:bg-accent has-disabled:cursor-not-allowed has-disabled:opacity-60"
            >
              <input
                type="radio"
                name={group}
                value={mode}
                checked={checked}
                onChange={() => setItemMode(mode)}
                className="mt-1 accent-primary"
                data-testid={`paying-pf-mode-${mode}`}
              />
              <ModeText mode={mode} />
            </label>
          ) : (
            <div key={mode} className="rounded-md border p-3" data-testid="paying-pf-mode-text">
              <ModeText mode={mode} />
            </div>
          )
        })}
      </fieldset>

      <div className="grid gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Label
            htmlFor="pay-first-applies"
            className="min-w-0 flex-1 basis-56 break-words font-normal"
          >
            {t('pf_applies')}
          </Label>
          {can ? (
            <Switch
              id="pay-first-applies"
              checked={shown.applies}
              disabled={pending}
              onCheckedChange={setApplies}
              data-testid="paying-pf-applies"
            />
          ) : (
            <span className="font-medium" data-testid="paying-pf-applies-text">
              {card.applies ? t('pf_t_on') : t('pf_t_off')}
            </span>
          )}
        </div>
        {shown.applies ? null : (
          <p className="text-sm text-muted-foreground" data-testid="paying-pf-off-d">
            {t('pf_applies_off_d')}
          </p>
        )}
      </div>

      {card.overrides > 0 ? (
        <p
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
          data-testid="paying-pf-overrides"
        >
          <span>{t('pf_overrides', { count: card.overrides })}</span>
          <Link
            className="font-medium underline underline-offset-4"
            href={`/venues/${venueId}?tab=tables`}
          >
            {t('pa_m_tables_go')}
          </Link>
        </p>
      ) : null}
    </section>
  )
}

/** An option's name and what it means for guests. */
function ModeText({ mode }: { mode: PaymentMode }) {
  const t = useTranslations('ownerSettings')
  const modes = useTranslations('options.payment_mode')
  return (
    <span className="grid min-w-0 gap-0.5">
      <span className="break-words text-sm font-medium">{modes(mode)}</span>
      <span className="break-words text-xs text-muted-foreground">
        {mode === 'on_bill' ? t('pf_default_bill_d') : t('pf_default_first_d')}
      </span>
    </span>
  )
}
