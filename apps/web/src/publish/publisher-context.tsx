'use client'

// One `Publisher` for the venue page's header (brief S4): the Publish bar and the warnings under
// the header (the held banner's Approve, Reject and "Publish the menu as it is now") press through
// the same one, so they agree on what is busy, and the answer is said once, under the header. The
// page keeps itself fresh while something is busy (LiveRefresh).
import { createContext, type ReactNode, useContext } from 'react'

import { LiveRefresh } from '@/integration/live-refresh'

import { OutcomeNote } from './outcome-note'
import { type Publisher, type PublisherState, usePublisher } from './use-publisher'

const PublisherContext = createContext<Publisher | null>(null)

export function PublisherProvider({
  venueId,
  state,
  children,
}: {
  venueId: string
  state: PublisherState
  children: ReactNode
}) {
  const publisher = usePublisher(venueId, state)
  return (
    <PublisherContext.Provider value={publisher}>
      <LiveRefresh active={publisher.busy} />
      {children}
    </PublisherContext.Provider>
  )
}

/** The page's publisher; only inside `PublisherProvider`. */
export function usePublisherContext(): Publisher {
  const publisher = useContext(PublisherContext)
  if (publisher === null) throw new Error('usePublisherContext is used outside PublisherProvider')
  return publisher
}

/** How the last press came out ("Version 3 is live", why it was refused), or nothing. */
export function PublishOutcome() {
  const publisher = usePublisherContext()
  return (
    <OutcomeNote outcome={publisher.outcome} slow={publisher.slow} onDismiss={publisher.dismiss} />
  )
}
