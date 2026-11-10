'use client'

// Settings › Staff and roles › Where the PIN falls (D141 12.9, ticket #324). One list for the
// venue, not one per role: it is the same question for everyone standing at a shared device —
// which reservation actions go through on one tap, and which ask for four digits first. D141's
// rule, which Martin took as the default: if the tap only says where people are sitting tonight it
// is a tap; if it writes the reservations, touches money, touches a guest's details or ends the
// night, it is four digits. A venue may move any line, so each row says where the default puts it
// once the venue has moved it.
//
// Each move saves at once, with Undo, through `setPinFallAction`, which the service write path
// checks again (`settings.reservations`, a person's own sign-in, never a PIN).
import { useTranslations } from 'next-intl'

import { setPinFallAction } from '@/server/settings/staff-actions'
import type { StaffView } from '@/server/settings/staff-view'

import type { useSettingsRun } from './use-settings-run'

type Runner = ReturnType<typeof useSettingsRun>

/**
 * The actions in the order the door reads them — tonight's floor first, then the record work —
 * each with where D141 puts it. The list is the screen's own copy of core's `DEFAULT_PIN_FALL`
 * (`PERMISSION_GROUPS` does the same for the permissions): a client file names no server module.
 * `pin-fall.test.tsx` pins the two lists against each other.
 */
export const PIN_FALL_ROWS = [
  { action: 'status', fall: 'tap' },
  { action: 'guest_count', fall: 'tap' },
  { action: 'walk_in', fall: 'tap' },
  { action: 'waiting', fall: 'tap' },
  { action: 'spots', fall: 'tap' },
  { action: 'create', fall: 'pin' },
  { action: 'edit', fall: 'pin' },
  { action: 'cancel', fall: 'pin' },
  { action: 'delete', fall: 'pin' },
  { action: 'restore', fall: 'pin' },
  { action: 'put_back', fall: 'pin' },
  { action: 'copy', fall: 'pin' },
  { action: 'block', fall: 'pin' },
  { action: 'pay_rule', fall: 'pin' },
  { action: 'end_night', fall: 'pin' },
] as const

const FALLS = ['tap', 'pin'] as const

export function PinFallList({ view, runner }: { view: StaffView; runner: Runner }) {
  const t = useTranslations('ownerSettings')
  const { pending, run } = runner
  // Moving a line is a reservation-settings change (`settings.reservations`): someone without it
  // sees the list and no controls, as a role's ticks do. Restro's admin team may move one.
  // There is no row to write until the venue has reservation settings (the turn time has no
  // default and is set first, #323), so the list is shown as it stands and says what is missing.
  const may =
    (view.operator || view.held.includes('settings.reservations')) && view.pinFall.settingsExist

  function move(action: (typeof PIN_FALL_ROWS)[number]['action'], next: 'tap' | 'pin') {
    const previous = view.pinFall.falls[action]
    if (previous === next) return
    run(() => setPinFallAction({ venueId: view.venueId, action, fall: next }), {
      done: t('st_saved'),
      undo: () => setPinFallAction({ venueId: view.venueId, action, fall: previous }),
      words: (error) => (error === 'settings_missing' ? t('sf_pin_needs_settings') : undefined),
    })
  }

  return (
    <section className="grid grid-cols-1 gap-3" aria-labelledby="staff-pin-fall">
      <h3 id="staff-pin-fall" className="text-lg font-medium">
        {t('sf_pin_title')}
      </h3>
      <p className="text-sm text-muted-foreground">{t('sf_pin_lede')}</p>
      {view.pinFall.settingsExist ? null : (
        <p className="text-sm text-muted-foreground">{t('sf_pin_needs_settings')}</p>
      )}
      {may ? null : <p className="text-sm text-muted-foreground">{t('sf_pin_cant')}</p>}
      <ul className="divide-y rounded-lg border bg-card" data-testid="pin-fall">
        {PIN_FALL_ROWS.map((row) => {
          const here = view.pinFall.falls[row.action]
          return (
            <li
              key={row.action}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block break-words">{t(`sf_pin_a_${row.action}`)}</span>
                {here === row.fall ? null : (
                  <span className="block text-xs text-muted-foreground">
                    {t(row.fall === 'tap' ? 'sf_pin_default_tap' : 'sf_pin_default_pin')}
                  </span>
                )}
              </span>
              <span
                role="radiogroup"
                aria-label={t(`sf_pin_a_${row.action}`)}
                className="inline-flex shrink-0 gap-0.5 rounded-md border p-0.5"
              >
                {FALLS.map((option) => {
                  const chosen = here === option
                  return (
                    <label
                      key={option}
                      className={`cursor-pointer rounded px-2 py-1 text-xs ${
                        chosen ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                      } ${may && !pending ? '' : 'cursor-default opacity-70'}`}
                    >
                      <input
                        type="radio"
                        className="sr-only"
                        name={`pin-fall-${row.action}`}
                        value={option}
                        checked={chosen}
                        disabled={!may || pending}
                        data-testid={`pin-fall-${row.action}-${option}`}
                        onChange={() => move(row.action, option)}
                      />
                      {t(option === 'tap' ? 'sf_pin_tap' : 'sf_pin_pin')}
                    </label>
                  )
                })}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
