// @vitest-environment jsdom
// The stages a tile can ask a frame for (ticket 8): the frame presses the renderer's own controls and
// ends on the screen the tile is about. Run against the real renderer and its demo host, on the
// specimen a tile draws, so a control the renderer renames or a screen it stops drawing fails here.
import { DEFAULT_DESIGN, DESIGN_PAGES } from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DraftFace } from '@/publish/draft-face'
import { renderWithIntl } from '@/test-utils'

import { type Stage, tilePlanOf } from './advanced-model'
import { drive, WAYS } from './frame-stage'
import { previewSnapshot } from './preview-snapshot'
import { DEMO_ASSET_BASE, specimenOf } from './specimen'

const OVERLAY = { version: 1, items: {} }

beforeEach(() => {
  window.scrollTo = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  vi.restoreAllMocks()
})

function specimen(services: boolean, strip = false) {
  const { snapshot } = fixture('big-menu')
  return previewSnapshot(
    specimenOf(snapshot, { services, strip }),
    {} as never,
    DEFAULT_DESIGN.values,
  )
}

/** The stage reached, with the part the tile looks at, and what was scrolled to. */
async function reach(stage: Stage, focus: string[], strip = false) {
  const services = stage !== 'menu' && stage !== 'dish'
  const view = renderWithIntl(
    <DraftFace
      snapshot={specimen(services, strip)}
      overlay={OVERLAY}
      scheme="light"
      servicesPreview={services}
      assetBase={DEMO_ASSET_BASE}
    />,
  )
  await waitFor(() => expect(view.container.querySelector('[data-face]')).toBeTruthy())
  let reached = false
  const stop = drive(stage, focus, () => {
    reached = true
  })
  await waitFor(() => expect(reached).toBe(true), { timeout: 15_000, interval: 100 })
  return { view, stop }
}

describe('the stages of a frame', () => {
  it('the specimen is a menu with three items a section, each with the demo photo', () => {
    const snapshot = specimen(false)
    const ids = snapshot.menu.sections.flatMap((id) => snapshot.sections[id]?.items ?? [])
    expect(snapshot.menu.sections.length).toBeLessThanOrEqual(2)
    expect(ids.length).toBeGreaterThan(0)
    for (const section of snapshot.menu.sections) {
      expect(snapshot.sections[section]?.items.length).toBeLessThanOrEqual(3)
    }
    for (const id of ids) expect(snapshot.items[id]?.image).toBeTruthy()
    // The demo photo is the only asset, so the frame's photo base is the app's folder.
    expect(Object.keys(snapshot.assets)).toHaveLength(1)
  })

  const STAGES: [Stage, string[]][] = [
    ['menu', ['item']],
    ['dish', ['dish']],
    ['order', ['order.bar']],
    ['bag', ['order']],
    ['bill', ['bill.lines']],
    ['call', ['call']],
    ['pay', ['pay.tip']],
    ['receipt', ['receipt.venue']],
  ]

  for (const [stage, focus] of STAGES) {
    it(`reaches ${stage}`, async () => {
      const { view, stop } = await reach(stage, focus)
      const way = WAYS[stage]
      if (way.until !== null)
        expect(view.container.ownerDocument.querySelector(way.until)).toBeTruthy()
      stop()
    }, 30_000)
  }

  it('a tile of a browsing page scrolls to the part it styles', async () => {
    const { stop } = await reach('menu', ['item'])
    expect(window.scrollTo).toHaveBeenCalled()
    stop()
  })
})

describe('what every option looks at', () => {
  // One frame for each distinct (stage, part) a tile asks for: the part must be on the screen it opens.
  const asked = new Map<string, { stage: Stage; focus: readonly string[]; who: string[] }>()
  for (const page of DESIGN_PAGES) {
    for (const option of page.options) {
      if (option.kind !== 'choice') continue
      const plan = tilePlanOf(page.id, option.id)
      if (plan.focus.length === 0) continue
      const key = `${plan.stage}|${plan.focus.join(',')}`
      const entry = asked.get(key) ?? { stage: plan.stage, focus: plan.focus, who: [] }
      entry.who.push(`${page.id}.${option.id}`)
      asked.set(key, entry)
    }
  }
  for (const [key, { stage, focus, who }] of asked) {
    it(`${key} is on the screen for ${who.join(', ')}`, async () => {
      const { view, stop } = await reach(
        stage,
        [...focus],
        who.includes('sections.strip_card_size'),
      )
      const doc = view.container.ownerDocument
      const found = focus.some((marker) => doc.querySelector(`[data-design-part="${marker}"]`))
      expect(found, `none of ${focus.join(', ')} is drawn at ${stage}`).toBe(true)
      stop()
    }, 30_000)
  }
})
