'use client'

// How the floor plan's two writes run (#327: block a spot, lift a block), in the shape Tonight's
// runner has (`tonight/run.tsx`), with Reservations' own words:
//   • it worked → the short toast, and on a shared device whom the PIN named;
//   • it was refused → the error toast that **stays**, with a close button, and the plan keeps what
//     it had. A refusal that carries something to say (the party booked on the spot) is said:
//     "Ана, 4 · Маса 12 at 23:30. Move them first." is the whole point of the sentence;
//   • a shared device asks for a PIN first, because keeping a spot back from booking is not quick
//     work (D141 12.11): the sheet is the confirmation and the name in the Log. Where the device
//     already knows the person, the write runs and the sheet opens only if the server asks for a
//     PIN after all (#324) — a role that may not block is told who may, never a dead end.
//
// Lifting a block offers to put it back (`again`): Undo on this screen is the opposite write, not
// core's own Undo, which no reservation command carries.
import { unstable_rethrow } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { type ReactNode, useCallback, useState } from 'react'
import { toast } from 'sonner'

import type { RvWriteResult } from '@/server/reservations/write'
import { PinSheet } from '@/tonight/pin-sheet'

/** A refusal of one of the plan's writes. */
export type RvRefused = Extract<RvWriteResult, { ok: false }>

/** How long a toast that worked stays up; a refusal stays until it is closed. */
const DONE_MS = 8000

/** The sentence for a refused write: `reservations.errors.<code>`, else the general one. */
export function useRvFailureText() {
  const t = useTranslations('reservations')
  return useCallback(
    (error: string, retryAfterSeconds?: number) => {
      const key = `errors.${error}`
      if (error === 'device_waiting') return t(key, { seconds: retryAfterSeconds ?? 60 })
      return t.has(key) ? t(key) : t('errors.failed')
    },
    [t],
  )
}

/** One write of the plan. */
export interface RvRunSpec {
  /** A stable id built from the thing changed, so a second tap updates the same toast. */
  readonly id: string
  readonly act: (pin?: string) => Promise<RvWriteResult>
  /** The toast after it worked. */
  readonly done: string
  /** Present when a shared device must name a person first. */
  readonly pin?: { readonly title: string; readonly body: string }
  /** The write that puts it back, offered on the toast (lifting a block offers to block again). */
  readonly again?: {
    readonly label: string
    readonly done: string
    readonly act: (pin?: string) => Promise<RvWriteResult>
  }
  /**
   * This screen's own sentence for a refusal it can say more about, given the code and whatever
   * the service path sent with it; null falls back to the general wording.
   */
  readonly refusal?: (
    error: string,
    details: Readonly<Record<string, unknown>> | undefined,
  ) => string | null | Promise<string | null>
  /** It worked: the screen that asked closes its form, and reads again. */
  readonly onDone?: (details: Extract<RvWriteResult, { ok: true }>['details']) => void
  /** Read the plan again, whatever the answer was: the screen never keeps a guess. */
  readonly after?: () => void
}

/** A write whose promise never came back is a refusal, not an unhandled rejection (RR-78). */
const attempt = (write: () => Promise<RvWriteResult>): Promise<RvWriteResult> =>
  write().catch((error: unknown): RvWriteResult => {
    unstable_rethrow(error)
    return { ok: false, error: 'failed' }
  })

/**
 * The plan's write runner: `run` starts one, `busy` is true while one is in flight, and `pinSheet`
 * is drawn by the screen so the sheet belongs to the plan rather than to a provider above it.
 */
export function useReservationRun({ device }: { device: boolean }): {
  readonly run: (spec: RvRunSpec) => void
  readonly busy: boolean
  readonly pinSheet: ReactNode
} {
  const failureText = useRvFailureText()
  const [asking, setAsking] = useState<RvRunSpec | null>(null)
  const [busy, setBusy] = useState(false)

  const refuse = useCallback(
    async (spec: RvRunSpec, refused: RvRefused) => {
      const text =
        (await spec.refusal?.(refused.error, refused.details)) ??
        failureText(refused.error, refused.retryAfterSeconds)
      toast.error(text, { id: spec.id, duration: Number.POSITIVE_INFINITY, closeButton: true })
    },
    [failureText],
  )

  const accept = useCallback(
    (spec: RvRunSpec, who: string | undefined, pin: string | undefined) => {
      const { again } = spec
      toast.success(who === undefined ? spec.done : `${spec.done} · ${who}`, {
        id: spec.id,
        duration: DONE_MS,
        ...(again === undefined
          ? {}
          : {
              action: {
                label: again.label,
                onClick: () => {
                  void attempt(() => again.act(pin)).then((result) => {
                    spec.after?.()
                    if (result.ok) {
                      toast.success(again.done, { id: `${spec.id}:again`, duration: DONE_MS })
                      return
                    }
                    toast.error(failureText(result.error, result.retryAfterSeconds), {
                      id: `${spec.id}:again`,
                      duration: Number.POSITIVE_INFINITY,
                      closeButton: true,
                    })
                  })
                },
              },
            }),
      })
    },
    [failureText],
  )

  const go = useCallback(
    async (spec: RvRunSpec, pin?: string): Promise<RvWriteResult> => {
      setBusy(true)
      const result = await attempt(() => spec.act(pin))
      setBusy(false)
      spec.after?.()
      if (result.ok) {
        accept(spec, result.who, pin)
        spec.onDone?.(result.details)
      }
      return result
    },
    [accept],
  )

  const run = useCallback(
    (spec: RvRunSpec) => {
      // On a shared device the sheet comes first: the write is signed by name (D141).
      if (spec.pin !== undefined && device) {
        setAsking(spec)
        return
      }
      void go(spec).then((result) => {
        if (result.ok) return
        // The person the device remembered may not do this one: the sheet opens so whoever may
        // types theirs (#324).
        if (result.error === 'pin_required' && spec.pin !== undefined) {
          setAsking(spec)
          return
        }
        void refuse(spec, result)
      })
    },
    [device, go, refuse],
  )

  const pinSheet =
    asking?.pin === undefined ? null : (
      <PinSheet
        title={asking.pin.title}
        body={asking.pin.body}
        level="own"
        wording={(error, retryAfterSeconds, details) => {
          // A sentence that needs a read of its own comes later, as the toast; the sheet says the
          // general one for it.
          const own = asking.refusal?.(error, details)
          return (typeof own === 'string' ? own : null) ?? failureText(error, retryAfterSeconds)
        }}
        onLeave={() => setAsking(null)}
        onSubmit={async (pin) => {
          const result = await go(asking, pin)
          if (result.ok) setAsking(null)
          return result
        }}
      />
    )

  return { run, busy, pinSheet }
}
