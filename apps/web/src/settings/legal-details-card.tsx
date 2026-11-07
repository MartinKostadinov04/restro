'use client'

// The venue's details for guests (#116, #198, #288): the legal name, ЕИК, registered address and a
// privacy notice link, in one card with Save (more than three fields, so a form, not a control per
// field). It shows "Unsaved" and warns before leaving with unsaved edits. One form, drawn on
// Settings › Paying and on Settings › Ordering (every venue: the privacy notice link is needed
// before ordering from the phone turns on, RR-O15), saved by the same action and command
// (`settings.paying_set`, the right to connect payments). All four must be filled before card
// payments or ordering can start. The guest side (the pay screen's link to these) is #195's.
import {
  LEGAL_ADDRESS_MAX,
  LEGAL_NAME_MAX,
  LEGAL_PRIVACY_URL_MAX,
  type LegalDetails,
  type LegalDraft,
  type LegalField,
  legalProblems,
  normalizeEik,
} from '@restro/core'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { WRAPS_FORM } from '@/lib/wrapping'
import { savePayingAction } from '@/server/settings/paying-actions'

import type { useSettingsRun } from './use-settings-run'

const EMPTY: LegalDraft = { name: '', eik: '', address: '', privacyUrl: '' }

/** Where the card is drawn: its test id (and its fields' ids) and the words that differ. */
export type LegalDetailsPlace = 'paying' | 'ordering'

const PLACES: Record<
  LegalDetailsPlace,
  { readonly testId: string; readonly lede: string; readonly required: string }
> = {
  paying: { testId: 'paying-legal', lede: 'pa_legal_d', required: 'pa_req' },
  ordering: { testId: 'ord-legal', lede: 'st_legal_d', required: 'st_legal_req' },
}

/** The field's problem as its sentence key, or null. */
function problemKey(
  field: LegalField,
  problem: 'required' | 'bad' | undefined,
  required: string,
): string | null {
  if (problem === undefined) return null
  if (problem === 'required') return required
  return field === 'eik' ? 'pa_eik_err' : field === 'privacyUrl' ? 'pa_privacy_err' : required
}

export function LegalDetailsCard({
  place,
  venueId,
  legal,
  canEdit,
  runner,
}: {
  place: LegalDetailsPlace
  venueId: string
  /** The saved details, or null until all four are filled in. */
  legal: LegalDetails | null
  /** True when the person holds `settings.connect_payments`: otherwise read-only. */
  canEdit: boolean
  runner: ReturnType<typeof useSettingsRun>
}) {
  const t = useTranslations('ownerSettings')
  const { pending, run } = runner
  const can = canEdit
  const words = PLACES[place]
  const saved = legal ?? EMPTY
  const [draft, setDraft] = useState<LegalDraft>(saved)
  const [tried, setTried] = useState(false)
  const savedKey = JSON.stringify(saved)

  // A saved value that changes (this save, an Undo, another owner) replaces what is typed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the saved value's text
  useEffect(() => {
    setDraft(saved)
    setTried(false)
  }, [savedKey])

  const trimmed: LegalDraft = {
    name: draft.name.trim(),
    eik: normalizeEik(draft.eik),
    address: draft.address.trim(),
    privacyUrl: draft.privacyUrl.trim(),
  }
  const dirty = JSON.stringify(trimmed) !== savedKey
  const problems = tried ? legalProblems(draft) : {}

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function save() {
    setTried(true)
    if (Object.keys(legalProblems(draft)).length > 0) return
    const previous = legal
    run(() => savePayingAction({ venueId, changes: { legalDetails: trimmed } }), {
      done: t('st_saved'),
      // The first save has nothing to go back to: clearing the details is not offered (a connected
      // account's paying would go off with no signal, #198).
      ...(previous === null
        ? {}
        : {
            undo: () => savePayingAction({ venueId, changes: { legalDetails: previous } }),
          }),
    })
  }

  const fields: {
    field: LegalField
    label: string
    max: number
    inputMode?: 'numeric' | 'url'
  }[] = [
    { field: 'name', label: t('pa_legal_name'), max: LEGAL_NAME_MAX },
    // 13 digits, and room for the spaces of a pasted "123 456 789".
    { field: 'eik', label: t('pa_eik'), max: 20, inputMode: 'numeric' },
    { field: 'address', label: t('pa_address'), max: LEGAL_ADDRESS_MAX },
    { field: 'privacyUrl', label: t('pa_privacy'), max: LEGAL_PRIVACY_URL_MAX, inputMode: 'url' },
  ]

  if (!can) {
    if (legal === null) return null
    return (
      <section
        id={words.testId}
        className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-3"
        data-testid={words.testId}
      >
        <h3 className="font-medium">{t('pa_legal_t')}</h3>
        <dl className="grid grid-cols-1 gap-2 text-sm">
          {fields.map(({ field, label }) => (
            <div key={field} className="grid grid-cols-1 gap-0.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{legal[field]}</dd>
            </div>
          ))}
        </dl>
      </section>
    )
  }

  return (
    <form
      id={words.testId}
      className="grid grid-cols-1 gap-4 rounded-lg border bg-card p-3"
      data-testid={words.testId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <div className="grid grid-cols-1 gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{t('pa_legal_t')}</h3>
          {dirty ? <Badge variant="secondary">{t('pa_unsaved')}</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">{t(words.lede)}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {fields.map(({ field, label, max, inputMode }) => {
          const key = problemKey(field, problems[field], words.required)
          const id = `${words.testId}-${field}`
          return (
            <div
              key={field}
              className={
                field === 'address' || field === 'privacyUrl'
                  ? 'grid gap-1.5 sm:col-span-2'
                  : 'grid gap-1.5'
              }
            >
              <Label htmlFor={id}>{label}</Label>
              <Input
                id={id}
                value={draft[field]}
                inputMode={inputMode}
                maxLength={max}
                autoComplete="off"
                aria-invalid={key === null ? undefined : true}
                aria-describedby={key === null ? undefined : `${id}-problem`}
                disabled={pending}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
              />
              {key === null ? null : (
                <p id={`${id}-problem`} className="text-sm text-destructive" role="alert">
                  {t(key)}
                </p>
              )}
            </div>
          )
        })}
      </div>
      <div>
        <Button
          className={WRAPS_FORM}
          type="submit"
          variant={dirty ? 'default' : 'outline'}
          disabled={pending || !dirty}
          data-testid={`${words.testId}-save`}
        >
          {t('st_save')}
        </Button>
      </div>
    </form>
  )
}
