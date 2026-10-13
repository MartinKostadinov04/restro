'use client'

// The menu's header name (D92, brief S7): the name guests see at the top of the open menu. It is a
// setting of the MENU (`menus.name`), not of the look, so it has its own Save, apart from "Save
// look", and goes through S4's `renameMenuAction`. Empty means the venue's name. Like every other
// change it reaches guests with the next publish.
import { MAX_MENU_NAME_LENGTH } from '@restro/core'
import { useTranslations } from 'next-intl'
import { type FormEvent, useId, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { renameMenuAction } from '@/server/menus-actions'

/** The menu the tab edits the name of. */
export interface HeaderNameMenu {
  readonly id: string
  /** The header name; null = the venue's name. */
  readonly name: string | null
}

export function HeaderNameField({
  venueId,
  menu,
  venueName,
  canEdit,
  onSaved,
}: {
  venueId: string
  /** The open menu, or null when the venue has none. */
  menu: HeaderNameMenu | null
  /** What a menu without a header name is called. */
  venueName: string
  canEdit: boolean
  /** Called after the name is saved (the preview asks for the draft again). */
  onSaved: () => void
}) {
  const t = useTranslations('design.headerName')
  const tErrors = useTranslations('venueMenus.errors')
  const id = useId()
  const [saved, setSaved] = useState(menu?.name ?? '')
  const [value, setValue] = useState(menu?.name ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startSaving] = useTransition()

  if (menu === null) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="design-header-name-none">
        {t('noMenu')}
      </p>
    )
  }
  const menuId = menu.id
  const dirty = value.trim() !== saved.trim()

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canEdit || !dirty || pending) return
    setError(null)
    startSaving(async () => {
      const result = await renameMenuAction({ venueId, menuId, name: value.trim() })
      if (result.ok) {
        const name = result.menu.name ?? ''
        setSaved(name)
        setValue(name)
        toast.success(t('saved'))
        onSaved()
      } else {
        setError(tErrors(result.error))
      }
    })
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-2" data-testid="design-header-name">
      <Label htmlFor={`${id}-name`}>{t('label')}</Label>
      <p className="text-xs text-muted-foreground">{t('help', { venue: venueName })}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`${id}-name`}
          value={value}
          maxLength={MAX_MENU_NAME_LENGTH}
          placeholder={venueName}
          disabled={!canEdit}
          autoComplete="off"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : `${id}-error`}
          onChange={(event) => {
            setError(null)
            setValue(event.target.value)
          }}
          className="max-w-sm min-w-0 flex-1"
        />
        {canEdit ? (
          <Button type="submit" variant="outline" disabled={!dirty || pending}>
            {pending ? t('saving') : t('save')}
          </Button>
        ) : null}
      </div>
      {error === null ? null : (
        <p
          id={`${id}-error`}
          role="alert"
          className="text-sm text-destructive"
          data-testid="design-header-name-error"
        >
          {error}
        </p>
      )}
    </form>
  )
}
