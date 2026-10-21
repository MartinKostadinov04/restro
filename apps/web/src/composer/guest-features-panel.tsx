'use client'

// The "Guest features" card (brief SH-05b, D71): the guest services the venue switches on and off.
// It is card 2 of the Design subtab (D92; brief S7 restyled it to sit with the other cards, with
// its own Save: it saves apart from "Save look"). Menu: the filters, the template's own feature
// switches, and the allergen line, which is never a switch (R6). Service at the table: calling a
// waiter with its request kinds, the bill, ordering and paying from the phone. A switch says what
// the venue wants; a guest sees a service only when the platform supports it, the channel is
// interactive and a table is confirmed (the shell's R15). Saving goes through the server actions in
// `@/server/composer/guest-features-actions`; a change reaches guests with the next publish.
import { CALL_WAITER_KINDS, type CallWaiterKind, type GuestFeatures } from '@restro/core'
import { LockIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { type ReactNode, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  saveFeatureOptionsAction,
  saveGuestFeaturesAction,
} from '@/server/composer/guest-features-actions'

/** One option the template declares with group `feature` (the face's manifest, SH-03). */
export interface FeatureOptionDeclaration {
  readonly key: string
  readonly type: 'boolean' | 'enum'
  /** The values an enum option takes; a switch is a boolean and has none. */
  readonly values?: readonly string[]
  readonly default: string | boolean
  readonly label: { readonly bg: string; readonly en: string }
}

/** The template's feature options: what it declares, and the venue's value for each. */
export interface TemplateFeatureOptions {
  readonly declared: readonly FeatureOptionDeclaration[]
  /** The venue's values, or the defaults, for the declared keys. */
  readonly values: Readonly<Record<string, string | boolean>>
}

export interface GuestFeaturesCardProps {
  readonly venueId: string
  readonly features: GuestFeatures
  readonly options: TemplateFeatureOptions
  /** Owners and admins only; for anyone else every switch is read-only. */
  readonly canEdit: boolean
}

/** What is saved (the baseline) and what is drawn (the draft). */
interface Settings {
  readonly features: GuestFeatures
  readonly values: Readonly<Record<string, string | boolean>>
}

/** The guest features as a card of their own on the Design subtab (D92). */
export function GuestFeaturesCard(props: GuestFeaturesCardProps) {
  const t = useTranslations('composer.guestFeatures')
  return (
    <Card data-testid="guest-features-panel">
      <CardHeader>
        <CardTitle>
          <h3 className="text-base font-semibold">{t('title')}</h3>
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <FeaturesForm {...props} />
    </Card>
  )
}

function FeaturesForm({ venueId, features, options, canEdit }: GuestFeaturesCardProps) {
  const t = useTranslations('composer.guestFeatures')
  const lang = useLocale() === 'en' ? 'en' : 'bg'
  const ids = useId()
  const [saved, setSaved] = useState<Settings>({ features, values: options.values })
  const [draft, setDraft] = useState<Settings>({ features, values: options.values })
  const [pending, startTransition] = useTransition()

  const switches = options.declared.filter((option) => option.type === 'boolean')
  const featuresChanged = !sameFeatures(draft.features, saved.features)
  const optionsChanged = options.declared.some(
    (option) => draft.values[option.key] !== saved.values[option.key],
  )
  const dirty = featuresChanged || optionsChanged
  const locked = !canEdit || pending
  const callWaiter = draft.features.call_waiter
  // Call a waiter with no request kind would show guests nothing (R15): it cannot be saved.
  const noKinds = callWaiter.enabled && callWaiter.kinds.length === 0

  function setFeature(change: (current: GuestFeatures) => GuestFeatures) {
    setDraft((current) => ({ ...current, features: change(current.features) }))
  }

  function setOption(key: string, value: boolean) {
    setDraft((current) => ({ ...current, values: { ...current.values, [key]: value } }))
  }

  function setCallWaiter(enabled: boolean) {
    setFeature((current) => ({
      ...current,
      call_waiter: {
        enabled,
        // A service with no request kind asks nothing, so switching it on checks "waiter".
        kinds:
          enabled && current.call_waiter.kinds.length === 0
            ? ['waiter']
            : current.call_waiter.kinds,
      },
    }))
  }

  function setKind(kind: CallWaiterKind, on: boolean) {
    setFeature((current) => {
      const kinds = new Set<CallWaiterKind>(current.call_waiter.kinds)
      if (on) kinds.add(kind)
      else kinds.delete(kind)
      return {
        ...current,
        call_waiter: {
          enabled: current.call_waiter.enabled,
          kinds: CALL_WAITER_KINDS.filter((known) => kinds.has(known)),
        },
      }
    })
  }

  function save() {
    startTransition(async () => {
      if (featuresChanged) {
        const result = await saveGuestFeaturesAction({ venueId, features: draft.features })
        if (!result.ok) {
          toast.error(t(`errors.${result.error}`))
          return
        }
        setSaved((current) => ({ ...current, features: draft.features }))
      }
      if (optionsChanged) {
        const values = Object.fromEntries(
          options.declared.map(
            (option) => [option.key, draft.values[option.key] ?? option.default] as const,
          ),
        )
        const result = await saveFeatureOptionsAction({ venueId, options: values })
        if (!result.ok) {
          toast.error(t(`errors.${result.error}`))
          return
        }
        setSaved((current) => ({ ...current, values: draft.values }))
      }
      toast.success(t('saved'))
    })
  }

  return (
    <form
      className="grid gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (dirty && canEdit && !noKinds) save()
      }}
      data-testid="guest-features-form"
    >
      <CardContent>
        <div className="grid gap-6">
          {canEdit ? null : <p className="text-sm text-muted-foreground">{t('readOnly')}</p>}

          <section aria-labelledby={`${ids}-menu`} className="grid gap-4">
            <h4 id={`${ids}-menu`} className="text-sm font-semibold text-muted-foreground">
              {t('groups.menu')}
            </h4>
            <SwitchRow
              id={`${ids}-filters`}
              label={t('filters')}
              checked={draft.features.filters}
              disabled={locked}
              testId="feature-filters"
              onChange={(on) => setFeature((current) => ({ ...current, filters: on }))}
            />
            {switches.map((option) => (
              <SwitchRow
                key={option.key}
                id={`${ids}-option-${option.key}`}
                label={option.label[lang]}
                checked={draft.values[option.key] === true}
                disabled={locked}
                testId={`feature-option-${option.key}`}
                onChange={(on) => setOption(option.key, on)}
              />
            ))}
            <p
              className="flex items-center gap-2 text-sm text-muted-foreground"
              data-testid="allergens-always"
            >
              <LockIcon className="size-4 shrink-0" aria-hidden />
              {t('allergensAlways')}
            </p>
          </section>

          <section aria-labelledby={`${ids}-service`} className="grid gap-4">
            <h4 id={`${ids}-service`} className="text-sm font-semibold text-muted-foreground">
              {t('groups.service')}
            </h4>
            <SwitchRow
              id={`${ids}-call`}
              label={t('callWaiter')}
              checked={callWaiter.enabled}
              disabled={locked}
              testId="feature-call-waiter"
              onChange={setCallWaiter}
            >
              <fieldset className="grid min-w-0 gap-2 border-0 p-0 ps-6">
                <legend className="mb-1 text-xs text-muted-foreground">{t('kinds.legend')}</legend>
                {CALL_WAITER_KINDS.map((kind) => (
                  <div key={kind} className="grid gap-1">
                    <div className="flex items-center gap-2 phone:min-h-11">
                      <Checkbox
                        id={`${ids}-kind-${kind}`}
                        checked={callWaiter.kinds.includes(kind)}
                        disabled={locked || !callWaiter.enabled}
                        onCheckedChange={(checked) => setKind(kind, checked === true)}
                        data-testid={`call-kind-${kind}`}
                      />
                      <Label htmlFor={`${ids}-kind-${kind}`} className="font-normal">
                        {t(`kinds.${kind}`)}
                      </Label>
                    </div>
                    {kind === 'other' ? (
                      <p className="ps-6 text-xs text-muted-foreground">{t('otherNote')}</p>
                    ) : null}
                  </div>
                ))}
              </fieldset>
              {noKinds ? (
                <p role="alert" className="text-xs text-destructive" data-testid="call-kinds-none">
                  {t('kindsNone')}
                </p>
              ) : null}
              <Note>{t('stage4')}</Note>
            </SwitchRow>
            <SwitchRow
              id={`${ids}-bill`}
              label={t('bill')}
              checked={draft.features.bill}
              disabled={locked}
              testId="feature-bill"
              onChange={(on) => setFeature((current) => ({ ...current, bill: on }))}
            >
              <Note>{t('stage4')}</Note>
            </SwitchRow>
            <SwitchRow
              id={`${ids}-ordering`}
              label={t('ordering')}
              checked={draft.features.ordering}
              disabled={locked}
              testId="feature-ordering"
              onChange={(on) => setFeature((current) => ({ ...current, ordering: on }))}
            >
              <Note>{t('stage4')}</Note>
            </SwitchRow>
            <SwitchRow
              id={`${ids}-pay`}
              label={t('pay')}
              checked={draft.features.pay}
              disabled={locked}
              testId="feature-pay"
              onChange={(on) => setFeature((current) => ({ ...current, pay: on }))}
            >
              <Note>{t('stage5')}</Note>
            </SwitchRow>
          </section>
        </div>
      </CardContent>

      <CardFooter className="justify-end">
        <Button
          type="submit"
          disabled={locked || !dirty || noKinds}
          data-testid="guest-features-save"
        >
          {t('save')}
        </Button>
      </CardFooter>
    </form>
  )
}

function SwitchRow({
  id,
  label,
  checked,
  disabled,
  testId,
  onChange,
  children,
}: {
  id: string
  label: string
  checked: boolean
  disabled: boolean
  testId: string
  onChange: (on: boolean) => void
  children?: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id} className="font-medium">
          {label}
        </Label>
        <Switch
          id={id}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onChange}
          data-testid={testId}
        />
      </div>
      {children}
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

/** True when two feature sets say the same (the request kinds are compared in their order). */
function sameFeatures(a: GuestFeatures, b: GuestFeatures): boolean {
  return (
    a.filters === b.filters &&
    a.bill === b.bill &&
    a.ordering === b.ordering &&
    a.pay === b.pay &&
    a.call_waiter.enabled === b.call_waiter.enabled &&
    a.call_waiter.kinds.join() === b.call_waiter.kinds.join()
  )
}
