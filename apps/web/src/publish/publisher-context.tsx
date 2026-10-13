'use client'

// One `Publisher` for the venue page's header (brief S4): the Publish bar and the warnings under
// the header (the held banner's Approve, Reject and "Publish the menu as it is now") press through
// the same one, so they agree on what is busy, and the answer is said once, under the header. The
// page keeps itself fresh while something is busy (LiveRefresh).
//
// The provider sits outside the header's Suspense boundaries, so the venue's name and address are
// drawn at once and only once; what it follows (the last publish run, a job waiting) arrives with
// the bar's data, which hands it over through `PublisherStateSync` on every refresh.
import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useState,
} from 'react'

import { LiveRefresh } from '@/integration/live-refresh'

import { OutcomeNote } from './outcome-note'
import { type Publisher, type PublisherState, usePublisher } from './use-publisher'

interface PublisherContextValue {
  readonly publisher: Publisher
  readonly setState: Dispatch<SetStateAction<PublisherState>>
}

const PublisherContext = createContext<PublisherContextValue | null>(null)

const NOTHING_YET: PublisherState = { lastRun: null, busy: null }

export function PublisherProvider({
  venueId,
  state = NOTHING_YET,
  children,
}: {
  venueId: string
  /** What the publisher follows until the page's data says otherwise (`PublisherStateSync`). */
  state?: PublisherState
  children: ReactNode
}) {
  const [current, setState] = useState<PublisherState>(state)
  const publisher = usePublisher(venueId, current)
  return (
    <PublisherContext.Provider value={{ publisher, setState }}>
      <LiveRefresh active={publisher.busy} />
      {children}
    </PublisherContext.Provider>
  )
}

function useContextValue(): PublisherContextValue {
  const value = useContext(PublisherContext)
  if (value === null) throw new Error('the publisher is used outside PublisherProvider')
  return value
}

/** The page's publisher; only inside `PublisherProvider`. */
export function usePublisherContext(): Publisher {
  return useContextValue().publisher
}

/** Hands the page's latest publish state to the provider (renders nothing). */
export function PublisherStateSync({ state }: { state: PublisherState }) {
  const { setState } = useContextValue()
  // By value: every refresh of the page makes a new object with the same content.
  const key = JSON.stringify(state)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `state`'s content
  useEffect(() => {
    setState(state)
  }, [key, setState])
  return null
}

/** How the last press came out ("Version 3 is live", why it was refused), or nothing. */
export function PublishOutcome() {
  const publisher = usePublisherContext()
  return (
    <OutcomeNote outcome={publisher.outcome} slow={publisher.slow} onDismiss={publisher.dismiss} />
  )
}
