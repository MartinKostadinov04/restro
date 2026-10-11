'use client'

// The Connection card: the barsy address and the API user's name and password (brief S2-05). One
// connection for the whole organisation (D73), set on Settings -> Integrations.
//
// The password goes to the server action once, to be sealed there, and is cleared from the form
// whatever the answer. Nothing sent back ever holds it, so after a save the card can only say
// "Credentials saved"; changing them means typing both values again (the sealed envelope is
// bound to the address, so a new address needs them too).
import { CheckCircle2Icon, KeyRoundIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { saveConnectionAction } from '@/server/integration/actions'
import type { IntegrationErrorCode, IntegrationView } from '@/server/integration/view'

import { ErrorNote, Notice } from './error-note'
import { useClearWhenIdle } from './use-clear-when-idle'

interface ConnectCardProps {
  readonly view: IntegrationView
}

export function ConnectCard({ view }: ConnectCardProps) {
  const t = useTranslations('integration')
  const formId = useId()
  const info = view.integration
  const [justSaved, setJustSaved] = useState(false)
  // Saved now (the page is still catching up) or saved before.
  const saved = info?.hasCredentials === true || justSaved
  const [editing, setEditing] = useState(false)
  const [host, setHost] = useState(info?.host ?? '')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [notice, setNotice] = useState<'queued' | 'notQueued' | null>(null)
  const [pending, startTransition] = useTransition()
  useClearWhenIdle(view.activeJob, () => setNotice(null))

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    const sent = { host, user, password }
    // The password leaves the form the moment it is sent, whatever comes back.
    setPassword('')
    startTransition(async () => {
      const result = await saveConnectionAction(sent)
      setUser('')
      if (!result.ok) {
        setError(result.error)
        return
      }
      setJustSaved(true)
      setEditing(false)
      setNotice(result.queued === false ? 'notQueued' : 'queued')
    })
  }

  function cancel() {
    setEditing(false)
    setError(null)
    setUser('')
    setPassword('')
    setHost(info?.host ?? '')
  }

  const showForm = view.canManage && view.sealReady && (!saved || editing)

  return (
    <FormSection title={t('connect.title')} description={t('connect.description')}>
      {view.canManage && !view.sealReady ? (
        <Alert data-testid="seal-keys-missing">
          <KeyRoundIcon aria-hidden />
          <AlertTitle>{t('connect.keysMissing.title')}</AlertTitle>
          <AlertDescription>{t('connect.keysMissing.description')}</AlertDescription>
        </Alert>
      ) : null}

      {saved && !editing ? (
        <div className="grid gap-3" data-testid="credentials-saved">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2Icon aria-hidden className="size-4 text-success" />
            {t('connect.saved')}
          </p>
          {info ? (
            <p className="text-sm text-muted-foreground">
              {t('connect.savedHost', { host: info.host })}
            </p>
          ) : null}
          {view.canManage && view.sealReady ? (
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setHost(info?.host ?? host)
                  setEditing(true)
                }}
              >
                {t('connect.change')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!saved && !showForm ? (
        <p className="text-sm text-muted-foreground">{t('connect.none')}</p>
      ) : null}

      {showForm ? (
        <form onSubmit={submit} className="grid gap-4" noValidate data-testid="connect-form">
          {saved ? (
            <p className="text-sm text-muted-foreground">{t('connect.changeHelp')}</p>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-host`}>{t('connect.host')}</Label>
            <Input
              id={`${formId}-host`}
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder={t('connect.hostPlaceholder')}
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
            <p className="text-xs text-muted-foreground">{t('connect.hostHelp')}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-user`}>{t('connect.user')}</Label>
            <Input
              id={`${formId}-user`}
              value={user}
              onChange={(event) => setUser(event.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={256}
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-password`}>{t('connect.password')}</Label>
            <Input
              id={`${formId}-password`}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              maxLength={1024}
              required
            />
          </div>
          <ErrorNote code={error} />
          <div className="flex flex-wrap justify-end gap-2">
            {saved ? (
              <Button type="button" variant="outline" onClick={cancel} disabled={pending}>
                {t('connect.cancel')}
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={pending || host.trim() === '' || user === '' || password === ''}
            >
              {pending ? t('connect.saving') : t('connect.save')}
            </Button>
          </div>
        </form>
      ) : null}

      {!showForm ? <ErrorNote code={error} /> : null}
      {notice ? <Notice>{t(`connect.${notice}`)}</Notice> : null}
    </FormSection>
  )
}
