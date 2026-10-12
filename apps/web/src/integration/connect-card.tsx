'use client'

// The Connection card of one instance (adjustments I1, D81): its name, the system's address and
// the API user's name and password. One card per instance; several instances of a system are
// told apart by name.
//
// The password goes to the server action once, to be sealed there, and is cleared from the form
// whatever the answer. Nothing sent back ever holds it, so after a save the card can only say
// "Credentials saved"; changing them means typing both values again (the sealed envelope is
// bound to the address, so a new address needs them too).
import { CheckCircle2Icon, KeyRoundIcon, PencilIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { renameInstanceAction, saveConnectionAction } from '@/server/integration/actions'
import type { InstanceView, IntegrationErrorCode } from '@/server/integration/view'

import { ErrorNote, Notice } from './error-note'
import { useClearWhenIdle } from './use-clear-when-idle'

interface ConnectCardProps {
  readonly instance: InstanceView
  readonly canManage: boolean
  /** The web has a usable sealing key; without one credentials cannot be saved. */
  readonly sealReady: boolean
}

/** The instance's name, with "Rename" for those who may. */
function NameRow({ instance, canManage }: { instance: InstanceView; canManage: boolean }) {
  const t = useTranslations('integration.connect')
  const fieldId = useId()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(instance.name)
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [pending, startTransition] = useTransition()

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await renameInstanceAction({ integrationId: instance.id, name })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setEditing(false)
    })
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-0.5">
          <span className="text-sm font-medium">{t('name.label')}</span>
          <span className="text-sm text-muted-foreground" data-testid="instance-name">
            {instance.name}
          </span>
        </div>
        {canManage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setName(instance.name)
              setEditing(true)
            }}
          >
            <PencilIcon aria-hidden />
            {t('name.rename')}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="grid gap-2" noValidate data-testid="rename-form">
      <Label htmlFor={fieldId}>{t('name.label')}</Label>
      <Input
        id={fieldId}
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={80}
        autoComplete="off"
        required
      />
      <ErrorNote code={error} source={instance.source} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => setEditing(false)}
        >
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={pending || name.trim() === ''}>
          {pending ? t('saving') : t('name.save')}
        </Button>
      </div>
    </form>
  )
}

export function ConnectCard({ instance, canManage, sealReady }: ConnectCardProps) {
  const t = useTranslations('integration.connect')
  const connectors = useTranslations('connectors')
  const formId = useId()
  const [justSaved, setJustSaved] = useState(false)
  // Saved now (the page is still catching up) or saved before.
  const saved = instance.hasCredentials || justSaved
  const [editing, setEditing] = useState(false)
  const [host, setHost] = useState(instance.host)
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [notice, setNotice] = useState<'queued' | 'notQueued' | null>(null)
  const [pending, startTransition] = useTransition()
  useClearWhenIdle(instance.activeJob, () => setNotice(null))

  const exampleKey = `${instance.kind}.connect.hostExample`
  const example = connectors.has(exampleKey) ? connectors(exampleKey) : ''

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setNotice(null)
    const sent = { integrationId: instance.id, host, user, password }
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
    setHost(instance.host)
  }

  const showForm = canManage && sealReady && (!saved || editing)

  return (
    <FormSection title={t('title')} description={t('description', { source: instance.source })}>
      <NameRow instance={instance} canManage={canManage} />

      {canManage && !sealReady ? (
        <Alert data-testid="seal-keys-missing">
          <KeyRoundIcon aria-hidden />
          <AlertTitle>{t('keysMissing.title')}</AlertTitle>
          <AlertDescription>{t('keysMissing.description')}</AlertDescription>
        </Alert>
      ) : null}

      {saved && !editing ? (
        <div className="grid gap-3" data-testid="credentials-saved">
          <p className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle2Icon aria-hidden className="size-4 text-success" />
            {t('saved')}
          </p>
          <p className="text-sm text-muted-foreground">{t('savedHost', { host: instance.host })}</p>
          {canManage && sealReady ? (
            <div>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setHost(instance.host)
                  setEditing(true)
                }}
              >
                {t('change')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {!saved && !showForm ? <p className="text-sm text-muted-foreground">{t('none')}</p> : null}

      {showForm ? (
        <form onSubmit={submit} className="grid gap-4" noValidate data-testid="connect-form">
          {saved ? <p className="text-sm text-muted-foreground">{t('changeHelp')}</p> : null}
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-host`}>{t('host', { source: instance.source })}</Label>
            <Input
              id={`${formId}-host`}
              value={host}
              onChange={(event) => setHost(event.target.value)}
              placeholder={example}
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
            <p className="text-xs text-muted-foreground">
              {example === '' ? t('hostHelpPlain') : t('hostHelp', { example })}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-user`}>{t('user')}</Label>
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
            <Label htmlFor={`${formId}-password`}>{t('password')}</Label>
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
          <ErrorNote code={error} source={instance.source} />
          <div className="flex flex-wrap justify-end gap-2">
            {saved ? (
              <Button type="button" variant="outline" onClick={cancel} disabled={pending}>
                {t('cancel')}
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={pending || host.trim() === '' || user === '' || password === ''}
            >
              {pending ? t('saving') : t('save')}
            </Button>
          </div>
        </form>
      ) : null}

      {!showForm ? <ErrorNote code={error} source={instance.source} /> : null}
      {notice ? <Notice>{t(notice)}</Notice> : null}
    </FormSection>
  )
}
