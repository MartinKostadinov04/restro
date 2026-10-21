'use client'

// "Add {source}" (adjustments I1, D81): a new named instance of a chosen system, in one step: what
// to call it, the system's address and the API user's name and password. The password goes to the
// server action once, to be sealed there, and is cleared from the form whatever the answer (see the
// Connection card). Saving queues the connection check; the new instance appears in the tab.
import { KeyRoundIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FormSection } from '@/components/ui/form-section'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addInstanceAction } from '@/server/integration/actions'
import type { IntegrationErrorCode, SystemOption } from '@/server/integration/view'

import { ErrorNote } from './error-note'

export function AddInstanceCard({
  system,
  sealReady,
  onClose,
}: {
  system: SystemOption
  /** The web has a usable sealing key; without one credentials cannot be saved. */
  sealReady: boolean
  /** Closes the card (cancel, or after saving); absent when it cannot be closed. */
  onClose?: () => void
}) {
  const t = useTranslations('integration.add')
  const connect = useTranslations('integration.connect')
  const connectors = useTranslations('connectors')
  const formId = useId()
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [pending, startTransition] = useTransition()
  const source = system.label

  const exampleKey = `${system.kind}.connect.hostExample`
  const example = connectors.has(exampleKey) ? connectors(exampleKey) : ''

  function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const sent = { kind: system.kind, name, host, user, password }
    // The password leaves the form the moment it is sent, whatever comes back.
    setPassword('')
    startTransition(async () => {
      const result = await addInstanceAction(sent)
      setUser('')
      if (!result.ok) {
        setError(result.error)
        return
      }
      setName('')
      setHost('')
      onClose?.()
    })
  }

  return (
    <FormSection title={t('title', { source })} description={t('description', { source })}>
      {sealReady ? (
        <form onSubmit={submit} className="grid gap-4" noValidate data-testid="add-instance-form">
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-name`}>{connect('name.label')}</Label>
            <Input
              id={`${formId}-name`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('namePlaceholder', { source })}
              maxLength={80}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t('nameHelp')}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-host`}>{connect('host', { source })}</Label>
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
              {example === '' ? connect('hostHelpPlain') : connect('hostHelp', { example })}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`${formId}-user`}>{connect('user')}</Label>
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
            <Label htmlFor={`${formId}-password`}>{connect('password')}</Label>
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
          <ErrorNote code={error} source={source} />
          <div className="flex flex-wrap justify-end gap-2">
            {onClose ? (
              <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
                {connect('cancel')}
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={pending || host.trim() === '' || user === '' || password === ''}
            >
              {pending ? connect('saving') : connect('save')}
            </Button>
          </div>
        </form>
      ) : (
        <Alert data-testid="seal-keys-missing">
          <KeyRoundIcon aria-hidden />
          <AlertTitle>{connect('keysMissing.title')}</AlertTitle>
          <AlertDescription>{connect('keysMissing.description')}</AlertDescription>
        </Alert>
      )}
    </FormSection>
  )
}
