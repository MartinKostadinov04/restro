'use client'

// Runs one of the owner-settings server actions the same way everywhere (#87): the control waits
// while it works, a refusal shows its sentence in an error toast that stays, a success shows its
// sentence with Undo where the change can be put back (plans: "single reversible writes"), and a
// settings change older than 15 minutes since the password asks for it again (D122 §7) and then
// does the change: the existing sign-in (Better Auth's `signIn.email`), not a new form.
import { useTranslations } from 'next-intl'
import { type ReactNode, useCallback, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { authClient } from '@/lib/auth-client'

/** What every action answers, as far as the runner reads it. */
export interface Answer {
  readonly ok: boolean
  readonly error?: string
}

/** What a run may ask for besides the action itself. */
export interface RunOptions<R extends Answer> {
  /** The success toast; none for a change that needs none. */
  readonly done?: string
  /** Puts the change back; the toast then carries "Undo". */
  readonly undo?: () => Promise<R>
  /** Called with the accepted answer. */
  readonly onOk?: (answer: R) => void
  /** Called when the change did not happen (the control returns to its saved value). */
  readonly onFail?: (error: string) => void
  /** A sentence for a refusal this screen words itself (it names a person or a role). */
  readonly words?: (error: string) => string | undefined
}

/** Refusal codes with a sentence of their own under `ownerSettings.err`. */
const KNOWN = new Set([
  'permission_denied',
  'own_sign_in_required',
  'pin_required',
  'actor_unknown',
  'venue_missing',
  'venue_archived',
  'busy',
  'invalid',
  'pin_unavailable',
  'staff_missing',
  'role_missing',
  'device_missing',
  'own_session_required',
  'account_unknown',
  'role_read_only',
  'role_name_taken',
  'account_taken',
  'already_shared',
  'role_in_use',
  'permission_not_held',
  'pins_exhausted',
  'telegram_taken',
])

/**
 * `run(action, options)` and the dialog that asks for the password again (render `dialog` once).
 * `email` is the signed-in person's.
 */
export function useSettingsRun(email: string) {
  const t = useTranslations('ownerSettings')
  const [pending, startTransition] = useTransition()
  const [asking, setAsking] = useState(false)
  const again = useRef<(() => void) | null>(null)

  const sentence = useCallback(
    (error: string, words?: (error: string) => string | undefined): string => {
      const own = words?.(error)
      if (own !== undefined) return own
      return t(`err.${KNOWN.has(error) ? error : 'failed'}`)
    },
    [t],
  )

  const run = useCallback(
    <R extends Answer>(action: () => Promise<R>, options: RunOptions<R> = {}) => {
      startTransition(async () => {
        const answer = await action()
        if (!answer.ok) {
          const error = answer.error ?? 'failed'
          if (error === 'sign_in_again') {
            again.current = () => run(action, options)
            setAsking(true)
            options.onFail?.(error)
            return
          }
          toast.error(sentence(error, options.words), { duration: Number.POSITIVE_INFINITY })
          options.onFail?.(error)
          return
        }
        options.onOk?.(answer)
        if (options.done === undefined) return
        const { undo } = options
        toast.success(options.done, {
          ...(undo === undefined
            ? {}
            : {
                action: {
                  label: t('st_undo'),
                  onClick: () => run(undo, {}),
                },
              }),
        })
      })
    },
    [sentence, t],
  )

  const dialog = (
    <PasswordAgain
      open={asking}
      email={email}
      onOpenChange={setAsking}
      onSignedIn={() => {
        setAsking(false)
        const retry = again.current
        again.current = null
        retry?.()
      }}
    />
  )
  return { pending, run, dialog, sentence }
}

/** "Enter your password to change settings": a fresh sign-in, then the change goes through. */
function PasswordAgain({
  open,
  email,
  onOpenChange,
  onSignedIn,
}: {
  open: boolean
  email: string
  onOpenChange: (open: boolean) => void
  onSignedIn: () => void
}): ReactNode {
  const t = useTranslations('ownerSettings')
  const [password, setPassword] = useState('')
  const [wrong, setWrong] = useState<'invalid' | 'tooMany' | 'unknown' | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setWrong(null)
    const { error } = await authClient.signIn.email({ email, password })
    setBusy(false)
    if (error) {
      setWrong(error.status === 429 ? 'tooMany' : error.status === 401 ? 'invalid' : 'unknown')
      return
    }
    setPassword('')
    onSignedIn()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          method="post"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{t('st_password_title')}</DialogTitle>
            <DialogDescription>{t('st_password_line', { email })}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="settings-password">{t('st_password')}</Label>
            <Input
              id="settings-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={wrong === null ? undefined : true}
            />
            {wrong === null ? null : (
              <p className="text-sm text-destructive" role="alert">
                {t(`st_password_${wrong}`)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('st_cancel')}
            </Button>
            <Button type="submit" disabled={busy || password === ''}>
              {t('st_password_go')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
