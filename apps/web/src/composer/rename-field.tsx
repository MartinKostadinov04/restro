'use client'

// A name edited in place (brief S6): a section's title in its header, an item's name in its row.
// Enter or the tick saves, Escape or the cross cancels; an empty or unchanged name saves nothing.
// It edits the text of one language, the one the composer shows (the caller decides which).
import { CheckIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { type FormEvent, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Most characters in a section title or an item name (the actions' limit). */
const MAX_NAME_LENGTH = 120

export function RenameField({
  initial,
  label,
  onSave,
  onCancel,
  className,
  testId = 'rename-field',
}: {
  /** The name shown now: the field starts with it. */
  initial: string
  /** What the field is, for screen readers ("Name of Negroni"). */
  label: string
  /** Called with the trimmed new name, only when it is not empty and not the same. */
  onSave: (name: string) => void
  onCancel: () => void
  className?: string
  testId?: string
}) {
  const t = useTranslations('composer.rename')
  const [value, setValue] = useState(initial)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const trimmed = value.trim()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (trimmed === '' || trimmed === initial.trim()) {
      onCancel()
      return
    }
    onSave(trimmed)
  }

  return (
    <form
      onSubmit={submit}
      className={cn('flex min-w-0 items-center gap-1', className)}
      data-testid={testId}
    >
      <Input
        ref={input}
        value={value}
        maxLength={MAX_NAME_LENGTH}
        aria-label={label}
        aria-invalid={trimmed === '' || undefined}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
        className="h-8 min-w-0 flex-1"
        data-testid={`${testId}-input`}
      />
      <Button
        type="submit"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        aria-label={t('save')}
        disabled={trimmed === ''}
        data-testid={`${testId}-save`}
      >
        <CheckIcon aria-hidden />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        aria-label={t('cancel')}
        onClick={onCancel}
      >
        <XIcon aria-hidden />
      </Button>
    </form>
  )
}
