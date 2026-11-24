// @vitest-environment jsdom
// What a tile's frame draws for an option (D159): the specimen the panel cuts from the draft, through
// the preview's own view model, drawn by the face's specimen view as the part alone. Run on the
// app's path (`specimenOf`, `previewSnapshot`, `SpecimenFrame`), so a part the app cannot feed fails
// here and not only in the face's own tests.
import { DEFAULT_DESIGN, DESIGN_PAGES } from '@restro/core'
import { specimenNeedsServices } from '@restro/editorial-market/preview'
import { fixture } from '@restro/shell/testing'
import { cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { specimenPartOf } from './advanced-model'
import { SpecimenFrame } from './design-frame'
import type { FrameContent } from './preview-frames'
import { previewSnapshot } from './preview-snapshot'
import { DEMO_ASSET_BASE, specimenOf } from './specimen'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function contentOf(pageId: string, optionId: string): FrameContent {
  const part = specimenPartOf(pageId, optionId)
  if (part === null) throw new Error(`${pageId}.${optionId} has no part`)
  const services = specimenNeedsServices(part)
  const { snapshot } = fixture('big-menu')
  return {
    snapshot: previewSnapshot(
      specimenOf(snapshot, {
        services,
        strip: pageId === 'sections' && optionId === 'strip_card_size',
        part,
      }),
      {} as never,
      DEFAULT_DESIGN.values,
    ),
    overlay: { version: 1, items: {} },
    scheme: 'light',
    services,
    assetBase: DEMO_ASSET_BASE,
    specimen: part,
  }
}

function draw(pageId: string, optionId: string) {
  const content = contentOf(pageId, optionId)
  const part = content.specimen
  if (part === undefined) throw new Error('no part')
  const { container } = renderWithIntl(
    <SpecimenFrame content={content} part={part} onHeight={() => undefined} />,
  )
  const count = (marker: string) =>
    container.querySelectorAll(`[data-design-part="${marker}"]`).length
  return { container, count, part }
}

describe("a tile's frame draws the option's part alone", () => {
  it('Items › Name size draws one dish and no header or section rail', () => {
    const { count } = draw('items', 'name_size')
    expect(count('item')).toBe(1)
    expect(count('header')).toBe(0)
    expect(count('nav')).toBe(0)
  })

  it('Header › Band draws the header and no dish', () => {
    const { count } = draw('header', 'band')
    expect(count('header')).toBe(1)
    expect(count('item')).toBe(0)
  })

  const options = DESIGN_PAGES.flatMap((page) =>
    page.options
      .filter((option) => specimenPartOf(page.id, option.id) !== null)
      .map((option) => [page.id, option.id] as const),
  )
  for (const [pageId, optionId] of options) {
    it(`${pageId} › ${optionId} draws its part from the app's specimen`, async () => {
      const { container, part } = draw(pageId, optionId)
      expect(container.querySelector(`[data-specimen="${part}"]`)).not.toBeNull()
      // Something of the guest page is drawn inside the part: not only a sheet's empty panel.
      await waitFor(() =>
        expect(
          container.querySelector(
            '[data-design-part]:not([data-specimen-panel]):not([data-design-part="sheet"])',
          ),
        ).not.toBeNull(),
      )
    })
  }
})
