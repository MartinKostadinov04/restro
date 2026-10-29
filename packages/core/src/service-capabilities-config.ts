// What a connector declared its POS lets Restro do during service (D122 §3), as the integration
// layer records it in `integrations.config.service_capabilities` (#78): the floor reading writes
// it from the worker's connector (`applyFloor`), so the service path and the guest API, which
// never hold a connector, can read it. Config, not a column, so no migration.
//
// Stored snake_case, like every stored value: `notesReachTicket` is `notes_reach_ticket`. Missing,
// unreadable or not `true` reads as not declared: the cautious answer (D122 §3: "undeclared means
// not claimed"). Only derived booleans leave core: never the raw config (rule 3).
//
// Pure and free of the connectors (the service path imports nothing of them): the writer turns a
// declaration into the stored record with `storedServiceCapabilities`.

import { z } from 'zod'

/** The key of `integrations.config` the record lives under. */
export const SERVICE_CAPABILITIES_CONFIG_KEY = 'service_capabilities'

/** A stored capability name: a code name in snake_case. */
const StoredNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)

/** The stored record: every capability the connector declared, true or false. */
export const StoredServiceCapabilitiesSchema = z.record(StoredNameSchema, z.boolean())
export type StoredServiceCapabilities = z.output<typeof StoredServiceCapabilitiesSchema>

const ConfigSchema = z.object({
  [SERVICE_CAPABILITIES_CONFIG_KEY]: StoredServiceCapabilitiesSchema,
})

/** The capabilities the service path reads (#78), each false unless the connector declared it. */
export interface RecordedServiceCapabilities {
  /** Notes and options reach the ticket: else no note field, and no item that needs options. */
  readonly notesReachTicket: boolean
  /** A sent order may open a POS bill on a table with none: else the waiter puts the first item on. */
  readonly firstItemsOpenBill: boolean
  /** A tip reaches the fiscal receipt on the close (D127): else a tip above 0 is refused. */
  readonly recordTipOnClose: boolean
  /** The close can ask the POS for an electronic receipt to the guest's email (D127, #186). */
  readonly electronicReceipt: boolean
}

/** Nothing declared: the cautious answer. */
export const NO_RECORDED_SERVICE_CAPABILITIES: RecordedServiceCapabilities = Object.freeze({
  notesReachTicket: false,
  firstItemsOpenBill: false,
  recordTipOnClose: false,
  electronicReceipt: false,
})

function snakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
}

/** A declaration as it is stored (`notesReachTicket` → `notes_reach_ticket`). */
export function storedServiceCapabilities(
  declared: Readonly<Record<string, boolean>>,
): StoredServiceCapabilities {
  return StoredServiceCapabilitiesSchema.parse(
    Object.fromEntries(Object.entries(declared).map(([name, value]) => [snakeCase(name), value])),
  )
}

/** What an integration's `config` records; all false when it records nothing readable. */
export function readServiceCapabilities(config: unknown): RecordedServiceCapabilities {
  const parsed = ConfigSchema.safeParse(config)
  if (!parsed.success) return NO_RECORDED_SERVICE_CAPABILITIES
  const stored = parsed.data[SERVICE_CAPABILITIES_CONFIG_KEY]
  return {
    notesReachTicket: stored.notes_reach_ticket === true,
    firstItemsOpenBill: stored.first_items_open_bill === true,
    recordTipOnClose: stored.record_tip_on_close === true,
    electronicReceipt: stored.electronic_receipt === true,
  }
}
