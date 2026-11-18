// @vitest-environment jsdom
// The print sheet's page says why it is empty (#441): "no table has a code yet" only for a venue
// with no coded table; when the venue has codes the worker could not reveal, it says so instead.
import { screen } from '@testing-library/react'
import { createTranslator } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadTablesView } from '@/server/tables/service'
import type { TablesView } from '@/server/tables/view'
import { SVG, TOKEN_A, VENUE_ID, view } from '@/tables/test-view'
import { renderWithIntl } from '@/test-utils'

import en from '../../../../../../messages/en.json'
import PrintTablesPage from './page'

vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: 'en', messages: en, namespace: namespace as 'tables' }),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('not found')
  },
}))
vi.mock('@/server/assets', () => ({ getAssetStore: vi.fn() }))
vi.mock('@/server/db', () => ({ getPool: vi.fn(() => ({})) }))
vi.mock('@/server/design/service', () => ({ loadVenueLogo: vi.fn(async () => null) }))
vi.mock('@/server/env', () => ({ defaultQrBaseUrl: vi.fn(() => 'http://localhost:3000') }))
vi.mock('@/server/reveal', () => ({
  revealConfig: vi.fn(() => ({ url: undefined, token: undefined })),
  revealFor: vi.fn(() => async () => new Map()),
}))
vi.mock('@/server/roles', () => ({ canManageIntegration: vi.fn(() => true) }))
vi.mock('@/server/session', () => ({
  requireTenant: vi.fn(async () => ({
    organization: { id: 'org_1', role: 'owner' },
    user: { id: 'us_1' },
    sessionId: 'se_1',
  })),
}))
vi.mock('@/server/tables/service', () => ({ loadTablesView: vi.fn() }))
vi.mock('@/server/venues', () => ({
  getVenue: vi.fn(async () => ({ id: 'vn_0123456789ABCDEFGHIJKL', name: 'Demo Club' })),
}))

const LINE = "The codes can't be shown right now."
const EMPTY = 'No table has a code yet. Create the codes in the Tables & QR tab first.'

async function renderPage(shown: TablesView) {
  vi.mocked(loadTablesView).mockResolvedValue(shown)
  const page = await PrintTablesPage({
    params: Promise.resolve({ venueId: VENUE_ID }),
  } as Parameters<typeof PrintTablesPage>[0])
  renderWithIntl(page)
}

/** The tab's view with the one coded table drawn, as the worker's reveal makes it. */
function revealed(): TablesView {
  const base = view()
  return {
    ...base,
    halls: base.halls.map((hall) => ({
      ...hall,
      tables: hall.tables.map((row) =>
        row.hasCode
          ? { ...row, address: `http://localhost:3000/t/${TOKEN_A}`, qrSvg: SVG, shownAs: '2' }
          : row,
      ),
    })),
  }
}

/** The same venue as the worker leaves it when it cannot open a code: nothing is drawn. */
function unrevealed(): TablesView {
  const base = view()
  return {
    ...base,
    sample: null,
    halls: base.halls.map((hall) => ({
      ...hall,
      tables: hall.tables.map((row) => ({ ...row, address: null, qrSvg: null })),
    })),
  }
}

beforeEach(() => {
  vi.mocked(loadTablesView).mockReset()
})

describe('the print page when it has nothing to print (#441)', () => {
  it('says the codes cannot be shown, not that none exist, when the venue has coded tables', async () => {
    await renderPage(unrevealed())
    expect(screen.getByText(LINE)).toBeTruthy()
    expect(screen.queryByText(EMPTY)).toBeNull()
    expect(screen.queryByTestId('print-pages')).toBeNull()
  })

  it('keeps "no table has a code yet" for a venue with no coded table', async () => {
    await renderPage({ ...unrevealed(), coded: 0 })
    expect(screen.getByText(EMPTY)).toBeTruthy()
    expect(screen.queryByText(LINE)).toBeNull()
  })

  it('prints the cards when the codes were revealed', async () => {
    await renderPage(revealed())
    expect(screen.getByTestId('print-pages').textContent).toBe('1 code on 1 page')
    expect(screen.queryByText(LINE)).toBeNull()
    expect(screen.queryByText(EMPTY)).toBeNull()
  })
})
