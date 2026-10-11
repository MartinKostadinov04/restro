'use client'

// The name of the till a screen shows values from (brief CF-03): the `{source}` in "From {source}",
// "Hidden by {source}", "Not on sale in {source}". The till is a role; the connector behind it
// names itself through core's `connectorLabel`, and the server puts that name in the data it hands
// over (the composer's view, the item sheet's data). Empty only where no value can come from a till.
import { createContext, type ReactNode, useContext } from 'react'

const TillLabelContext = createContext('')

/** Gives the components below the name of the till their values come from. */
export function TillLabelProvider({ label, children }: { label: string; children: ReactNode }) {
  return <TillLabelContext.Provider value={label}>{children}</TillLabelContext.Provider>
}

/** The name of the till the values on this screen come from (`{source}` in messages). */
export function useTillLabel(): string {
  return useContext(TillLabelContext)
}
