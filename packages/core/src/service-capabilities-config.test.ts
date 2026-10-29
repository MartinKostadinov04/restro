import { describe, expect, it } from 'vitest'

import { NO_SERVICE_CAPABILITIES } from './connectors/service'
import {
  NO_RECORDED_SERVICE_CAPABILITIES,
  readServiceCapabilities,
  storedServiceCapabilities,
} from './service-capabilities-config'

describe('the recorded service capabilities (#78)', () => {
  it('reads all false where nothing readable is recorded (the cautious default)', () => {
    for (const config of [
      undefined,
      null,
      {},
      { sync: { '1': {} } },
      { service_capabilities: null },
      { service_capabilities: { notes_reach_ticket: 'yes' } },
      { service_capabilities: { NotesReachTicket: true } },
      { service_capabilities: {} },
    ]) {
      expect(readServiceCapabilities(config)).toEqual(NO_RECORDED_SERVICE_CAPABILITIES)
    }
  })

  it('stores a declaration snake_case and reads back what it declared', () => {
    const declared = { ...NO_SERVICE_CAPABILITIES, notesReachTicket: true }
    const stored = storedServiceCapabilities(declared)
    expect(stored).toMatchObject({ notes_reach_ticket: true, first_items_open_bill: false })
    expect(Object.keys(stored)).toHaveLength(Object.keys(declared).length)
    expect(readServiceCapabilities({ service_capabilities: stored })).toEqual({
      notesReachTicket: true,
      firstItemsOpenBill: false,
      recordTipOnClose: false,
      electronicReceipt: false,
    })
    expect(
      readServiceCapabilities({
        service_capabilities: storedServiceCapabilities({
          ...NO_SERVICE_CAPABILITIES,
          firstItemsOpenBill: true,
        }),
      }),
    ).toEqual({
      notesReachTicket: false,
      firstItemsOpenBill: true,
      recordTipOnClose: false,
      electronicReceipt: false,
    })
    expect(
      readServiceCapabilities({
        service_capabilities: storedServiceCapabilities({
          ...NO_SERVICE_CAPABILITIES,
          recordTipOnClose: true,
        }),
      }),
    ).toMatchObject({ recordTipOnClose: true })
    expect(
      readServiceCapabilities({
        service_capabilities: storedServiceCapabilities({
          ...NO_SERVICE_CAPABILITIES,
          electronicReceipt: true,
          electronicReceiptFile: true,
        }),
      }),
    ).toMatchObject({ electronicReceipt: true })
  })
})
