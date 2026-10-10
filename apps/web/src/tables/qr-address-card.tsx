'use client'

import {
  checkBaseUrl,
  checkOwnPattern,
  ourAddress,
  ownAddress,
  QR_TOKEN_PLACEHOLDER,
  type QrAddressProblem,
  type QrMode,
} from '@restro/core'
// The address card of the Tables & QR tab (brief S3-07, D61): which address the codes carry.
//
//   Our link               <base address>/t/<token>. The base address is editable; while we build
//                          it is this PC's address (a phone on the same Wi-Fi needs the network
//                          address, e.g. http://192.168.x.x:3000).
//   The venue's own link   a pattern on the venue's own domain that forwards to ours, with
//                          `{token}` where the table's code goes. It is checked while it is typed
//                          (the same function the server uses), previewed with a real table's
//                          code, and opened by the MANAGER'S BROWSER in a new tab: our server
//                          never fetches an address a venue typed.
import { ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { saveQrSettingsAction } from '@/server/tables/actions'
import type { TablesView } from '@/server/tables/view'

import { useFailureText } from './use-failure-text'

/** Shown in the preview while no table has a code yet. */
const EXAMPLE_TOKEN = 'x'.repeat(22)

/** The base address text as the person sees it: the saved one, or nothing when it is the default. */
function baseText(view: TablesView): string {
  return view.qr.baseIsDefault ? '' : (view.qr.baseUrl ?? '')
}

export function QrAddressCard({ view }: { view: TablesView }) {
  const t = useTranslations('tables')
  const failureText = useFailureText()
  const id = useId()
  const [mode, setMode] = useState<QrMode>(view.qr.mode)
  const [base, setBase] = useState(baseText(view))
  const [pattern, setPattern] = useState(view.qr.ownPattern ?? '')
  const [serverProblem, setServerProblem] = useState<{
    field: 'baseUrl' | 'ownPattern'
    text: string
  } | null>(null)
  const [pending, startTransition] = useTransition()
  const editable = view.canManage

  // What is typed, checked with the server's own functions.
  const baseTyped = base.trim()
  const baseCheck =
    baseTyped === ''
      ? view.qr.defaultBaseUrl === null
        ? ({ ok: false, problem: 'empty' } as const)
        : checkBaseUrl(view.qr.defaultBaseUrl)
      : checkBaseUrl(baseTyped)
  const patternCheck = pattern.trim() === '' ? null : checkOwnPattern(pattern)
  const patternOk = patternCheck?.ok === true
  const activeValid = mode === 'ours' ? baseCheck.ok : patternOk

  const sampleToken = view.sample?.token ?? EXAMPLE_TOKEN
  const previewAddress =
    mode === 'ours'
      ? baseCheck.ok
        ? ourAddress(baseCheck.value, sampleToken)
        : null
      : patternCheck?.ok
        ? ownAddress(patternCheck.value, sampleToken)
        : null

  const savedBase = baseText(view)
  const dirty =
    mode !== view.qr.mode ||
    (mode === 'ours' ? baseTyped !== savedBase : pattern.trim() !== (view.qr.ownPattern ?? ''))

  function problemText(problem: QrAddressProblem): string {
    return t(`problems.${problem}`, { placeholder: QR_TOKEN_PLACEHOLDER })
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!editable || !activeValid || !dirty) return
    setServerProblem(null)
    startTransition(async () => {
      // Only the address of the chosen kind is changed; the other one keeps what was saved.
      const result = await saveQrSettingsAction({
        venueId: view.venueId,
        mode,
        baseUrl: mode === 'ours' ? (baseTyped === '' ? null : baseTyped) : savedBase || null,
        ownPattern: mode === 'own' ? pattern.trim() : (view.qr.ownPattern ?? null),
      })
      if (result.ok) {
        toast.success(t('address.saved'))
      } else if (result.field !== undefined) {
        setServerProblem({ field: result.field, text: failureText(result) })
      } else {
        toast.error(failureText(result))
      }
    })
  }

  const baseProblem = !baseCheck.ok && baseTyped !== '' ? problemText(baseCheck.problem) : null
  const patternProblem =
    patternCheck !== null && !patternCheck.ok ? problemText(patternCheck.problem) : null

  return (
    <FormSection title={t('address.title')} description={t('address.description')}>
      <form onSubmit={onSubmit} className="grid gap-5" data-testid="qr-address-card">
        <fieldset className="grid gap-2" disabled={!editable || pending}>
          <legend className="mb-1 text-sm font-medium">{t('address.mode')}</legend>
          {(['ours', 'own'] as const).map((option) => (
            <label
              key={option}
              className="flex items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:opacity-70"
            >
              <input
                type="radio"
                name={`${id}-mode`}
                className="mt-0.5 size-4 accent-primary"
                checked={mode === option}
                onChange={() => setMode(option)}
                data-testid={`mode-${option}`}
              />
              <span className="grid gap-0.5">
                <span className="font-medium">{t(`address.${option}`)}</span>
                <span className="text-xs text-muted-foreground">{t(`address.${option}Help`)}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {mode === 'ours' ? (
          <div className="grid gap-2">
            <Label htmlFor={`${id}-base`}>{t('address.baseUrl')}</Label>
            <Input
              id={`${id}-base`}
              value={base}
              onChange={(event) => setBase(event.target.value)}
              disabled={!editable || pending}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={view.qr.defaultBaseUrl ?? 'http://192.168.1.20:3000'}
              className="max-w-lg font-mono"
              aria-invalid={baseProblem !== null || serverProblem?.field === 'baseUrl'}
              aria-describedby={`${id}-base-help`}
              data-testid="base-url"
            />
            <p
              id={`${id}-base-help`}
              className={
                baseProblem || serverProblem?.field === 'baseUrl'
                  ? 'text-sm text-destructive'
                  : 'text-xs text-muted-foreground'
              }
              role={baseProblem ? 'alert' : undefined}
            >
              {baseProblem ??
                (serverProblem?.field === 'baseUrl'
                  ? serverProblem.text
                  : t('address.baseUrlHelp'))}
            </p>
            <p className="text-xs text-muted-foreground">
              {baseTyped === ''
                ? view.qr.defaultBaseUrl === null
                  ? t('address.baseUrlMissing')
                  : t('address.baseUrlDefault')
                : null}
              {baseTyped !== '' && view.qr.defaultBaseUrl !== null && editable ? (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  className="h-auto p-0"
                  onClick={() => setBase('')}
                >
                  {t('address.useDefault', { address: view.qr.defaultBaseUrl })}
                </Button>
              ) : null}
            </p>
          </div>
        ) : (
          <div className="grid gap-2">
            <Label htmlFor={`${id}-pattern`}>{t('address.pattern')}</Label>
            <Input
              id={`${id}-pattern`}
              value={pattern}
              onChange={(event) => setPattern(event.target.value)}
              disabled={!editable || pending}
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={`https://menu.example.com/t/${QR_TOKEN_PLACEHOLDER}`}
              className="max-w-lg font-mono"
              aria-invalid={patternProblem !== null || serverProblem?.field === 'ownPattern'}
              aria-describedby={`${id}-pattern-help`}
              data-testid="own-pattern"
            />
            <p
              id={`${id}-pattern-help`}
              className={
                patternProblem || serverProblem?.field === 'ownPattern'
                  ? 'text-sm text-destructive'
                  : 'text-xs text-muted-foreground'
              }
              role={patternProblem ? 'alert' : undefined}
              data-testid="pattern-help"
            >
              {patternProblem ??
                (serverProblem?.field === 'ownPattern'
                  ? serverProblem.text
                  : t('address.patternHelp', { placeholder: QR_TOKEN_PLACEHOLDER }))}
            </p>
            <Link
              href={`/guides/qr-links?venue=${view.venueId}`}
              className="w-fit text-sm text-primary underline-offset-4 hover:underline"
              data-testid="guide-link"
            >
              {t('address.guide')}
            </Link>
          </div>
        )}

        <div className="grid gap-2 rounded-md bg-muted/50 p-3">
          <p className="text-xs font-medium text-muted-foreground">
            {view.sample
              ? t('address.preview', { table: view.sample.shownAs ?? t('row.noNumber') })
              : t('address.previewExample')}
          </p>
          {previewAddress ? (
            <code className="font-mono text-xs break-all" data-testid="qr-preview">
              {previewAddress}
            </code>
          ) : (
            <span className="text-xs text-muted-foreground" data-testid="qr-preview">
              —
            </span>
          )}
          <div className="flex flex-wrap items-center gap-3">
            {view.sample && previewAddress ? (
              <Button asChild variant="outline" size="sm">
                <a
                  href={previewAddress}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="open-test-link"
                >
                  <ExternalLinkIcon aria-hidden />
                  {t('address.testLink')}
                </a>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled
                data-testid="open-test-link"
              >
                <ExternalLinkIcon aria-hidden />
                {t('address.testLink')}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {view.sample ? t('address.testLinkHint') : t('address.testLinkNone')}
            </span>
          </div>
        </div>

        {dirty && editable ? (
          <p className="text-xs text-muted-foreground" data-testid="address-unsaved">
            {t('address.unsaved')}
          </p>
        ) : null}
        {editable ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={pending || !dirty || !activeValid}>
              {pending ? t('address.saving') : t('address.save')}
            </Button>
          </div>
        ) : null}
      </form>
    </FormSection>
  )
}
