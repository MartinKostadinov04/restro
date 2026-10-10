'use client'

// The `tags` field type (brief S3-06, D60). A `tags` value is a list of tag ids (`tg_…`) from the
// venue's own list; the list comes from the field environment (the composer provides it). The
// editor shows the venue's tags as chips to switch on and off, and a "new tag" row that creates
// one in the venue's list and switches it on, without leaving the item.
//
// Ids the venue's active list does not know (an archived tag, a tag of another venue the item
// also sits in) are not shown and not lost: they stay in the value when the person saves.
import { CheckIcon, PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { useFieldEnvironment } from '../environment'
import { TagChip } from '../tag-chip'
import { TagForm } from '../tag-form'
import type { DisplayProps, EditorProps, FieldUi } from '../types'

function TagsDisplay({ value }: DisplayProps<'tags'>) {
  const t = useTranslations('common')
  const { tags } = useFieldEnvironment()
  // Without a list to look in (a preview outside the composer) the stored text is shown as is.
  if (tags === undefined) {
    if (value.length === 0) return <span className="text-muted-foreground">{t('none')}</span>
    return (
      <ul className="flex flex-wrap gap-1.5">
        {value.map((tag) => (
          <li key={tag}>
            <Badge variant="secondary">{tag}</Badge>
          </li>
        ))}
      </ul>
    )
  }
  const shown = tags.filter((tag) => value.includes(tag.id))
  if (shown.length === 0) return <span className="text-muted-foreground">{t('none')}</span>
  return (
    <ul className="flex flex-wrap gap-1.5" data-testid="tags-value">
      {shown.map((tag) => (
        <li key={tag.id}>
          <TagChip color={tag.color} tagId={tag.id}>
            {tag.name}
          </TagChip>
        </li>
      ))}
    </ul>
  )
}

function TagsEditor({ value, onChange, inputId }: EditorProps<'tags'>) {
  const t = useTranslations('fields.tags')
  const { tags = [], createTag, defaultLocale, enabledLocales } = useFieldEnvironment()
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const selected = value ?? []
  const known = new Set(tags.map((tag) => tag.id))
  const keptOut = selected.filter((id) => !known.has(id)).length

  function change(next: readonly string[]) {
    onChange(next.length === 0 ? undefined : [...next])
  }

  function toggle(id: string) {
    change(
      selected.includes(id) ? selected.filter((candidate) => candidate !== id) : [...selected, id],
    )
  }

  return (
    <div className="grid gap-3" data-testid="tags-editor">
      {tags.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="tags-editor-empty">
          {createTag ? t('empty') : t('emptyElsewhere')}
        </p>
      ) : (
        <fieldset id={inputId} className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
          <legend className="sr-only">{t('pick')}</legend>
          {tags.map((tag) => {
            const on = selected.includes(tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(tag.id)}
                data-testid="tag-toggle"
                data-tag-id={tag.id}
                className={cn(
                  'rounded-full focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  on
                    ? 'ring-2 ring-ring ring-offset-2 ring-offset-background'
                    : 'opacity-60 hover:opacity-100',
                )}
              >
                <TagChip color={tag.color}>
                  {on ? <CheckIcon className="size-3" aria-hidden /> : null}
                  {tag.name}
                </TagChip>
              </button>
            )
          })}
        </fieldset>
      )}
      {keptOut > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="tags-kept">
          {t('kept', { count: keptOut })}
        </p>
      ) : null}

      {createTag ? (
        creating ? (
          <div className="rounded-lg border bg-muted/30 p-3">
            <TagForm
              defaultLocale={defaultLocale}
              enabledLocales={enabledLocales}
              submitLabel={t('create')}
              busy={busy}
              onCancel={() => {
                setCreating(false)
                setFailed(false)
              }}
              onSubmit={async (draft) => {
                setBusy(true)
                setFailed(false)
                try {
                  const tag = await createTag(draft)
                  if (tag) {
                    setCreating(false)
                    change([...selected, tag.id])
                  } else {
                    setFailed(true)
                  }
                } finally {
                  setBusy(false)
                }
              }}
            />
            {failed ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {t('createFailed')}
              </p>
            ) : null}
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => setCreating(true)}
            data-testid="tag-create-inline"
          >
            <PlusIcon aria-hidden />
            {t('new')}
          </Button>
        )
      ) : null}
    </div>
  )
}

export const tags = { Display: TagsDisplay, Editor: TagsEditor } satisfies FieldUi<'tags'>
