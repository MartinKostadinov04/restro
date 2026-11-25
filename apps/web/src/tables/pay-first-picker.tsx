'use client'

// The "Pay first" row of an area header and of a table card (#217; plan: #201 comment, part B, Tables &
// QR; D113, D122 §5): whether pay first applies there. Three options, as the menu picker beside it:
// follow the level above, on, or off ("everything on the bill"). A choice saves at once with Undo
// (`pay_first.set`, one change at a time), the Select showing it before the server answers and
// returning to the saved value when the save fails. A change is a settings change: the person's own
// sign-in of the last 15 minutes, asked again by the owner-settings runner. A person without
// `settings.payment_tables` reads the line as text.
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { savePayFirstAction } from '@/server/settings/paying-actions'
import type { PayFirstShown } from '@/server/tables/view'
import { useSettingsRun } from '@/settings/use-settings-run'

import type { RouteTarget } from './route-picker'

/** What the Select holds: the value of the item that takes the choice away, or the choice. */
type Choice = 'inherit' | 'on' | 'off'

const choiceOf = (own: boolean | null): Choice => (own === null ? 'inherit' : own ? 'on' : 'off')
const ownOf = (choice: Choice): boolean | null => (choice === 'inherit' ? null : choice === 'on')

export function PayFirstPicker({
  venueId,
  target,
  targetName,
  payFirst,
  canSet,
  email,
}: {
  venueId: string
  target: RouteTarget
  /** What the row is for, in the sentence "Pay first for {target}": "the area Terrace", "table 12". */
  targetName: string
  payFirst: PayFirstShown
  /** The person may change it (`settings.payment_tables`, on their own sign-in). */
  canSet: boolean
  /** The signed-in person's email, for the password again. */
  email: string
}) {
  const t = useTranslations('ownerSettings')
  const missing = useTranslations('tables.errors')
  const router = useRouter()
  const { pending, run, dialog } = useSettingsRun(email)
  // What the Select shows: the choice at once, before the server answers. It follows the saved value
  // when that changes (this save, an Undo, another owner) and returns to it if a save fails.
  const [shown, setShown] = useState<Choice>(choiceOf(payFirst.own))
  useEffect(() => setShown(choiceOf(payFirst.own)), [payFirst.own])

  const valueWord = (applies: boolean) => (applies ? t('pf_t_on') : t('pf_t_off'))
  // What following the level above reads as. A bar's stored choice has no word of its own: no screen
  // sets one, so it reads as the plain value.
  const { inherited } = payFirst
  const inheritWord =
    inherited.level === 'venue'
      ? t('pf_t_same_venue', { value: valueWord(inherited.applies) })
      : inherited.level === 'area'
        ? t('pf_t_same_area', { value: valueWord(inherited.applies) })
        : valueWord(inherited.applies)
  const wordOf = (choice: Choice) =>
    choice === 'inherit' ? inheritWord : valueWord(choice === 'on')

  /** The row's saved value as a sentence, for the people who may not change it. */
  const label = t('pf_t_value', { value: wordOf(choiceOf(payFirst.own)) })

  const words = (error: string): string | undefined =>
    error === 'failed'
      ? t('pf_err_save')
      : error === 'table_missing' || error === 'group_missing'
        ? missing('not_found')
        : undefined

  function save(value: boolean | null): Promise<{ ok: boolean; error?: string }> {
    return savePayFirstAction({
      venueId,
      change:
        'areaId' in target ? { group: target.areaId, value } : { table: target.tableId, value },
    })
  }

  function choose(next: string) {
    const choice = next as Choice
    const previous = payFirst.own
    if (ownOf(choice) === previous) return
    setShown(choice)
    run(() => save(ownOf(choice)), {
      done: t('pf_t_toast', { target: targetName, value: wordOf(choice) }),
      words,
      onFail: (error) => {
        setShown(choiceOf(previous))
        // The table or area is gone: bring the page's rows up to date.
        if (error === 'table_missing' || error === 'group_missing') router.refresh()
      },
      undo: () => save(previous),
    })
  }

  return (
    <div className="grid min-w-0 gap-1" data-testid="pay-first-row">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {canSet ? (
          <Select value={shown} onValueChange={choose} disabled={pending}>
            <SelectTrigger
              size="sm"
              // The longest Bulgarian value wraps instead of forcing the card wider.
              className="h-auto max-w-full min-w-0 py-1.5 text-left whitespace-normal data-[size=sm]:h-auto data-[size=sm]:min-h-8 phone:data-[size=sm]:h-auto phone:data-[size=sm]:min-h-11 *:data-[slot=select-value]:line-clamp-none"
              aria-label={t('pf_t_label', { target: targetName })}
              data-testid="pay-first-select"
            >
              <SelectValue>{t('pf_t_value', { value: wordOf(shown) })}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="inherit" data-testid="pay-first-inherit">
                {inheritWord}
              </SelectItem>
              <SelectItem value="on" data-testid="pay-first-on">
                {valueWord(true)}
              </SelectItem>
              <SelectItem value="off" data-testid="pay-first-off">
                {valueWord(false)}
              </SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm" data-testid="pay-first-text">
            {label}
          </span>
        )}
        {shown === 'inherit' ? null : <OverridesBadge />}
      </div>
      {dialog}
    </div>
  )
}

function OverridesBadge() {
  const t = useTranslations('tables.row')
  return (
    <Badge variant="info" data-testid="pay-first-overrides">
      {t('overrides')}
    </Badge>
  )
}
