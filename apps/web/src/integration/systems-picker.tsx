'use client'

// The systems picker (adjustments I1, D81): which POS systems this organisation uses, chosen from
// the ones we support (the connectors folder's list, handed in by the server). The choice is saved
// for the organisation, and each chosen system gets its own tab below. Unselecting a system that
// still has instances is refused by the server (`has_instances`) with a sentence that names it.
import { useTranslations } from 'next-intl'
import { useId, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FormSection } from '@/components/ui/form-section'
import { saveSystemsAction } from '@/server/integration/actions'
import type { IntegrationErrorCode, SystemOption } from '@/server/integration/view'

import { ErrorNote, Notice } from './error-note'

export function SystemsPicker({
  systems,
  chosen,
  canManage,
}: {
  systems: readonly SystemOption[]
  chosen: readonly string[]
  canManage: boolean
}) {
  const t = useTranslations('integration.systems')
  const groupId = useId()
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(chosen))
  const [error, setError] = useState<IntegrationErrorCode | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const dirty = selected.size !== chosen.length || chosen.some((kind) => !selected.has(kind))
  // The systems being left out that still have instances: the server will refuse, and the
  // sentence names them.
  const blocking = systems
    .filter((system) => chosen.includes(system.kind) && !selected.has(system.kind))
    .filter((system) => system.instances > 0)
    .map((system) => system.label)
    .join(', ')

  function toggle(kind: string, on: boolean) {
    const next = new Set(selected)
    if (on) next.add(kind)
    else next.delete(kind)
    setSelected(next)
    setSaved(false)
    setError(null)
  }

  function submit() {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      // In the picker's own order, whatever the order of the clicks.
      const result = await saveSystemsAction({
        systems: systems.filter((system) => selected.has(system.kind)).map((system) => system.kind),
      })
      if (result.ok) setSaved(true)
      else setError(result.error)
    })
  }

  return (
    <FormSection title={t('title')} description={t('description')}>
      <fieldset
        className="grid gap-2"
        disabled={!canManage || pending}
        data-testid="systems-picker"
      >
        <legend className="sr-only">{t('legend')}</legend>
        {systems.map((system) => {
          const id = `${groupId}-${system.kind}`
          return (
            <div
              key={system.kind}
              className="flex items-center gap-3 rounded-md border p-3 text-sm"
              data-testid="system-option"
              data-kind={system.kind}
            >
              <Checkbox
                id={id}
                checked={selected.has(system.kind)}
                onCheckedChange={(value) => toggle(system.kind, value === true)}
              />
              <label htmlFor={id} className="grid flex-1 gap-0.5">
                <span className="font-medium">{system.label}</span>
                <span className="text-xs text-muted-foreground" data-testid="system-instances">
                  {t('instances', { count: system.instances })}
                </span>
              </label>
            </div>
          )
        })}
      </fieldset>
      {blocking !== '' && error === null ? (
        <p className="text-xs text-muted-foreground" data-testid="systems-blocking">
          {t('keepHint', { source: blocking })}
        </p>
      ) : null}
      <ErrorNote
        code={error}
        source={
          blocking !== ''
            ? blocking
            : systems
                .filter((system) => system.instances > 0)
                .map((system) => system.label)
                .join(', ')
        }
      />
      {saved ? <Notice>{t('saved')}</Notice> : null}
      {canManage ? (
        <div className="flex justify-end">
          <Button type="button" onClick={submit} disabled={pending || !dirty}>
            {pending ? t('saving') : t('save')}
          </Button>
        </div>
      ) : null}
    </FormSection>
  )
}
