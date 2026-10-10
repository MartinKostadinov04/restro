'use client'

// What the Publish tab's buttons share: pressing Publish, Approve, Reject or "Return to this
// version", the pending state while the worker does it, and the outcome to show afterwards.
//
// Publishing is the worker's job. "Publish" and "Approve" only queue it, so the action coming back
// does not mean it happened: the hook waits until the tab's data shows a publish run newer than the
// one that was there when the button was pressed, and words how that run ended ("Version 3 is
// live", or why it was refused). The page keeps itself fresh while `busy` (LiveRefresh).
// A return to an earlier version is done when the action comes back; only its files are late.
import { useEffect, useState, useTransition } from 'react'

import {
  approveHeldAction,
  publishNowAction,
  rejectHeldAction,
  rollbackAction,
} from '@/server/publish/actions'
import type { PublishActionError, PublishActionResult } from '@/server/publish/service'
import type { PublishRunView, PublishView, RefusalCode } from '@/server/publish/view'

/** How the last thing the person did turned out. */
export type Outcome =
  | { readonly kind: 'published'; readonly version: number | null }
  | { readonly kind: 'unchanged'; readonly version: number | null }
  | { readonly kind: 'refused'; readonly refusal: RefusalCode }
  | { readonly kind: 'failed' }
  | { readonly kind: 'returned'; readonly version: number }
  | { readonly kind: 'error'; readonly error: PublishActionError }

/** How long a queued publish may stay unanswered before the tab says the publisher is slow. */
export const SLOW_AFTER_MS = 45_000

/** The outcome a finished run stands for, or null when it says nothing about a person's press. */
export function outcomeOfRun(run: PublishRunView): Outcome | null {
  switch (run.state) {
    case 'published':
      return { kind: 'published', version: run.version }
    case 'unchanged':
      return { kind: 'unchanged', version: run.version }
    case 'refused':
      return { kind: 'refused', refusal: run.refusal ?? 'other' }
    case 'failed':
      return { kind: 'failed' }
    default:
      // Still running, or an automatic publish that was held: not the answer to a press.
      return null
  }
}

export interface Publisher {
  /** Something is happening: a press in flight, a queued publish or files being written. */
  readonly busy: boolean
  /** A queued publish has had no answer for a long time. */
  readonly slow: boolean
  readonly outcome: Outcome | null
  readonly publish: () => void
  readonly approve: (snapshotId: string) => void
  readonly reject: (snapshotId: string) => void
  /** Returns to a version; resolves to whether it worked (the dialog closes then). */
  readonly returnTo: (snapshotId: string, version: number) => Promise<boolean>
  readonly dismiss: () => void
}

export function usePublisher(venueId: string, view: PublishView): Publisher {
  const [pending, startTransition] = useTransition()
  // Set once a publish is queued: the run that was the latest then, so a newer one is the answer.
  const [waiting, setWaiting] = useState<{ readonly baseline: string | null } | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    if (waiting === null) return
    const run = view.lastRun
    if (run === null || run.id === waiting.baseline) return
    const result = outcomeOfRun(run)
    if (result === null) return
    setWaiting(null)
    setSlow(false)
    setOutcome(result)
  }, [waiting, view.lastRun])

  useEffect(() => {
    if (waiting === null) return
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS)
    return () => clearTimeout(timer)
  }, [waiting])

  const queue = (action: () => Promise<PublishActionResult>) => {
    setOutcome(null)
    setSlow(false)
    const baseline = view.lastRun?.id ?? null
    startTransition(async () => {
      const result = await action()
      if (result.ok) setWaiting({ baseline })
      else setOutcome({ kind: 'error', error: result.error })
    })
  }

  return {
    busy: pending || waiting !== null || view.busy !== null,
    slow,
    outcome,
    publish: () => queue(() => publishNowAction(venueId)),
    approve: (snapshotId) => queue(() => approveHeldAction(venueId, snapshotId)),
    reject: (snapshotId) => {
      setOutcome(null)
      startTransition(async () => {
        const result = await rejectHeldAction(venueId, snapshotId)
        // Someone decided it already: the refreshed tab shows the state, and the note says so.
        if (!result.ok) setOutcome({ kind: 'error', error: result.error })
      })
    },
    returnTo: (snapshotId, version) =>
      new Promise<boolean>((resolve) => {
        setOutcome(null)
        startTransition(async () => {
          const result = await rollbackAction(venueId, snapshotId)
          setOutcome(
            result.ok ? { kind: 'returned', version } : { kind: 'error', error: result.error },
          )
          resolve(result.ok)
        })
      }),
    dismiss: () => setOutcome(null),
  }
}
