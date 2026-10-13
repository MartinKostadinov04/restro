'use client'

// What the venue page's publish buttons share (the Publish bar, the held banner): pressing Publish
// (of one menu), Approve or Reject, the pending state while the worker does it, and the outcome
// to show afterwards. A return to an earlier version (Settings › Versioning) has its own answer:
// it is done when the action comes back; only its files are late.
//
// Publishing is the worker's job. "Publish" and "Approve" only queue it, so the action coming back
// does not mean it happened: the hook waits until the page's data shows a publish run newer than
// the one that was there when the button was pressed, and words how that run ended ("Version 3 is
// live", or why it was refused). The page keeps itself fresh while `busy` (LiveRefresh).
import { useEffect, useState, useTransition } from 'react'

import { approveHeldAction, publishNowAction, rejectHeldAction } from '@/server/publish/actions'
import type { PublishActionError, PublishActionResult } from '@/server/publish/service'
import type { BusyView, PublishRunView, RefusalCode } from '@/server/publish/view'

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
  /** Publishes a menu of the venue: `menuId`, else the live one. */
  readonly publish: (menuId?: string) => void
  readonly approve: (snapshotId: string) => void
  readonly reject: (snapshotId: string) => void
  readonly dismiss: () => void
}

/** What the hook follows in the page's data: the last publish run, and whether a job is waiting. */
export interface PublisherState {
  readonly lastRun: PublishRunView | null
  readonly busy: BusyView
}

export function usePublisher(venueId: string, view: PublisherState): Publisher {
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
    publish: (menuId) =>
      queue(() => (menuId === undefined ? publishNowAction(venueId) : publishNowAction(venueId, menuId))),
    approve: (snapshotId) => queue(() => approveHeldAction(venueId, snapshotId)),
    reject: (snapshotId) => {
      setOutcome(null)
      startTransition(async () => {
        const result = await rejectHeldAction(venueId, snapshotId)
        // Someone decided it already: the refreshed tab shows the state, and the note says so.
        if (!result.ok) setOutcome({ kind: 'error', error: result.error })
      })
    },
    dismiss: () => setOutcome(null),
  }
}
