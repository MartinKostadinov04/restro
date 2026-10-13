'use client'

// "Add area" at the end of the Tables & QR tab (brief S5, D95): a venue made by hand makes its own
// areas. One field and one button.
import { PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createAreaAction } from '@/server/tables/actions'

import { useRun } from './use-run'

export function AddAreaForm({ venueId }: { venueId: string }) {
  const t = useTranslations('tables.addArea')
  const { pending, run } = useRun()
  const id = useId()
  const [name, setName] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (name.trim() === '') return
    run(
      () => createAreaAction({ venueId, name }),
      t('done'),
      (ok) => {
        if (ok) setName('')
      },
    )
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-3"
      aria-label={t('title')}
      data-testid="add-area-form"
    >
      <div className="grid gap-1">
        <Label htmlFor={id} className="text-xs text-muted-foreground">
          {t('label')}
        </Label>
        <Input
          id={id}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('placeholder')}
          maxLength={60}
          disabled={pending}
          autoComplete="off"
          className="w-64 max-w-full"
          data-testid="new-area-name"
        />
      </div>
      <Button
        type="submit"
        variant="outline"
        disabled={pending || name.trim() === ''}
        data-testid="add-area"
      >
        <PlusIcon aria-hidden />
        {t('button')}
      </Button>
    </form>
  )
}
