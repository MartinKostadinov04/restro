'use client'

// How every write of Tonight runs (plan §3, §5): a quick one saves at once and answers with the
// 8-second toast; one that must name a person on a shared device first opens the PIN sheet, which
// is its confirmation; only an answer that moves money gets no Undo (part 2's). The Undo sends the
// write's token back, and core refuses it after 30 seconds or when the thing changed (#219). A write
// that fails is the error toast that stays, with a close button, and the row stays where it was. A
// write that never reached the server (no connection, RR-78) is such a failure too.
import { unstable_rethrow } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import { toast } from 'sonner'

import type { TonightResult, UndoToken } from '@/server/tonight/tables'

import { useFailureText } from './failure'
import { type PinLevel, PinSheet } from './pin-sheet'

type Accepted = Extract<TonightResult, { ok: true }>

/**
 * The token a write answered with (#219): the Log entry it wrote. The Undo sends it back, and core
 * refuses the Undo once the write is 30 seconds old or the thing was changed again since. Absent
 * when the write changed nothing.
 */
export function undoTokenOf(done: Accepted): UndoToken | undefined {
  const entry = done.details.undoEntry
  return typeof entry === 'number' ? { entry } : undefined
}

/** `undoWhen` for a write that offers Undo only when it wrote something (it has a token). */
export const wroteSomething = (done: Accepted) => undoTokenOf(done) !== undefined

/**
 * A write's answer, or `failed` when it never came: the action's promise rejected (RR-78). A redirect
 * (the sign-in ran out) is the router's, not a failed write.
 */
const attempt = (write: () => Promise<TonightResult>): Promise<TonightResult> =>
  write().catch((error: unknown): TonightResult => {
    unstable_rethrow(error)
    return { ok: false, error: 'failed' }
  })

/** One write. */
export interface RunSpec {
  /** A stable id built from the thing changed, so a second tap updates the toast. */
  readonly id: string
  /** Present when a PIN must be entered first (a shared device, a write that names a person). */
  readonly pin?: { readonly level: PinLevel; readonly title: string; readonly body: string }
  readonly act: (pin?: string) => Promise<TonightResult>
  /** The toast after it worked. */
  readonly done: string
  /**
   * The inverse write, given what the write answered, its undo token and the PIN the write was
   * entered with (the same person undoes it, on a shared device); without one the toast has no
   * Undo. Send the token on, so core can refuse a late or stale Undo.
   */
  readonly undo?: (
    done: Accepted,
    token: UndoToken | undefined,
    pin: string | undefined,
  ) => Promise<TonightResult>
  /**
   * Whether the toast offers its Undo, given what the write answered: a repeat that changed
   * nothing (`changed: false`) must not undo someone else's mark. Left out: always.
   */
  readonly undoWhen?: (done: Accepted) => boolean
}

type Run = (spec: RunSpec) => void

const RunContext = createContext<{ readonly run: Run; readonly busy: boolean } | null>(null)

/** The runner of the screen's writes. */
export function useTonightRun() {
  const context = useContext(RunContext)
  if (context === null) throw new Error('useTonightRun outside <RunProvider>')
  return context
}

export function RunProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('tonight')
  const failureText = useFailureText()
  const [asking, setAsking] = useState<RunSpec | null>(null)
  const [busy, setBusy] = useState(false)

  const finish = useCallback(
    (spec: RunSpec, done: Accepted, pin?: string) => {
      const { undo } = spec
      // Whom a PIN named: the toast says so, on the tablet everyone shares (plan §5).
      const who = done.details.who
      toast(typeof who === 'string' ? t('toast_who', { text: spec.done, who }) : spec.done, {
        id: spec.id,
        ...(undo === undefined || spec.undoWhen?.(done) === false
          ? {}
          : {
              action: {
                label: t('undo'),
                onClick: () => {
                  void attempt(() => undo(done, undoTokenOf(done), pin)).then((result) => {
                    if (!result.ok) {
                      toast.error(
                        failureText(result.error, result.retryAfterSeconds, result.details),
                        {
                          id: `${spec.id}:undo`,
                          duration: Number.POSITIVE_INFINITY,
                          closeButton: true,
                        },
                      )
                    }
                  })
                },
              },
            }),
      })
    },
    [failureText, t],
  )

  const execute = useCallback(
    async (spec: RunSpec, pin?: string): Promise<TonightResult> => {
      setBusy(true)
      try {
        const result = await attempt(() => spec.act(pin))
        if (result.ok) finish(spec, result, pin)
        return result
      } finally {
        setBusy(false)
      }
    },
    [finish],
  )

  const run = useCallback<Run>(
    (spec) => {
      if (spec.pin !== undefined) {
        setAsking(spec)
        return
      }
      void execute(spec).then((result) => {
        if (!result.ok) {
          toast.error(failureText(result.error, result.retryAfterSeconds, result.details), {
            id: spec.id,
            duration: Number.POSITIVE_INFINITY,
            closeButton: true,
          })
        }
      })
    },
    [execute, failureText],
  )

  const value = useMemo(() => ({ run, busy }), [run, busy])
  return (
    <RunContext.Provider value={value}>
      {children}
      {asking?.pin === undefined ? null : (
        <PinSheet
          title={asking.pin.title}
          body={asking.pin.body}
          level={asking.pin.level}
          onLeave={() => setAsking(null)}
          onSubmit={async (pin) => {
            const result = await execute(asking, pin)
            if (result.ok) setAsking(null)
            return result
          }}
        />
      )}
    </RunContext.Provider>
  )
}
