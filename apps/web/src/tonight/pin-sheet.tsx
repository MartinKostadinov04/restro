'use client'

// The PIN sheet on a shared device (plan §5, Patterns row "Who is acting on a shared device"): the
// action as its title, its consequence in one sentence, "Enter your PIN" or "Enter a manager's
// PIN", four dots, a 3 × 4 pad of 56 px keys, "Leave it". It submits on the fourth digit, so there
// is no confirm tap; a wrong PIN clears the dots and says what to do. The pad also takes the
// keyboard. A staff PIN where a manager's is needed is told so.
import { DeleteIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { TonightResult } from '@/server/tonight/tables'

import { useFailureText } from './failure'

/** The PIN a write asks for on a shared device: a person's own, or a manager's. */
export type PinLevel = 'own' | 'manager'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export function PinSheet({
  title,
  body,
  level,
  onLeave,
  onSubmit,
}: {
  title: string
  body: string
  level: PinLevel
  onLeave: () => void
  onSubmit: (pin: string) => Promise<TonightResult>
}) {
  const t = useTranslations('tonight')
  const failureText = useFailureText()
  const [digits, setDigits] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)
  const sending = useRef(false)
  // The digits typed so far, kept beside the state: the fourth digit starts the write, and starting
  // it inside a state updater would set the screen's own state while this sheet renders (RR-93).
  const typed = useRef('')
  const setTyped = useCallback((next: string) => {
    typed.current = next
    setDigits(next)
  }, [])

  const submit = useCallback(
    async (pin: string) => {
      if (sending.current) return
      sending.current = true
      setWaiting(true)
      const result = await onSubmit(pin)
      sending.current = false
      setWaiting(false)
      if (result.ok) return
      setTyped('')
      // A staff member's PIN where a manager's is needed: the write was refused for the person's
      // role, which is not a wrong PIN.
      setProblem(
        result.error === 'permission_denied' && level === 'manager'
          ? t('pin.staff')
          : result.error === 'pin_wrong'
            ? t('pin.wrong')
            : failureText(result.error, result.retryAfterSeconds, result.details),
      )
    },
    [failureText, level, onSubmit, setTyped, t],
  )

  const press = useCallback(
    (digit: string) => {
      if (sending.current) return
      setProblem(null)
      if (typed.current.length >= 4) return
      const next = typed.current + digit
      setTyped(next)
      if (next.length === 4) void submit(next)
    },
    [setTyped, submit],
  )
  const erase = useCallback(() => {
    if (sending.current) return
    setProblem(null)
    setTyped(typed.current.slice(0, -1))
  }, [setTyped])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (/^\d$/.test(event.key)) {
        event.preventDefault()
        press(event.key)
      } else if (event.key === 'Backspace') {
        event.preventDefault()
        erase()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [erase, press])

  const key = 'h-14 w-full text-xl tabular-nums'
  return (
    <Dialog open onOpenChange={(open) => !open && onLeave()}>
      <DialogContent className="max-w-sm" data-testid="pin-sheet">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <p className="text-center text-base font-medium">
          {level === 'manager' ? t('pin.manager') : t('pin.own')}
        </p>
        <div
          role="img"
          aria-label={`${t('pin.label')}: ${digits.length}`}
          className="flex justify-center gap-3"
        >
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              aria-hidden
              className={`size-4 rounded-full border-2 border-foreground ${index < digits.length ? 'bg-foreground' : ''}`}
            />
          ))}
        </div>
        <p role="alert" className="min-h-10 text-center text-sm text-destructive">
          {problem}
        </p>
        <div className="grid grid-cols-3 gap-2" aria-busy={waiting}>
          {KEYS.map((digit) => (
            <Button
              key={digit}
              type="button"
              variant="outline"
              className={key}
              disabled={waiting}
              onClick={() => press(digit)}
            >
              {digit}
            </Button>
          ))}
          <span aria-hidden />
          <Button
            type="button"
            variant="outline"
            className={key}
            disabled={waiting}
            onClick={() => press('0')}
          >
            0
          </Button>
          <Button
            type="button"
            variant="outline"
            className={key}
            disabled={waiting || digits.length === 0}
            onClick={erase}
            aria-label={t('pin.delete')}
          >
            <DeleteIcon aria-hidden className="size-5" />
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" className="h-11" onClick={onLeave}>
            {t('leave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
