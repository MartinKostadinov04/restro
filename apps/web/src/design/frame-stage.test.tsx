// @vitest-environment jsdom
// The stages a tile can ask a frame for (ticket 8): the frame presses the renderer's own controls and
// ends on the screen the tile is about. Run against the real renderer and its demo host, on the
// specimen a tile draws, so a control the renderer renames or a screen it stops drawing fails here.
import { DEFAULT_DESIGN, DESIGN_PAGES } from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DraftFace } from '@/publish/draft-face'
import { renderWithIntl } from '@/test-utils'

import { pageOfTap, type Stage, tilePlanOf } from './advanced-model'
import { partOf } from './design-frame'
import { closeStage, drive, keepHistoryInside, stuckTop, WAYS } from './frame-stage'
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
    ['bag', ['order', 'order.bar']],
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

  it('the order stage opened again adds nothing more to the bag', async () => {
    const first = await reach('order', [])
    first.stop()
    const count = () => first.view.container.querySelector('.ro-count')?.textContent
    expect(count()).toBe('1')
    let reached = false
    const stop = drive('order', [], () => {
      reached = true
    })
    await waitFor(() => expect(reached).toBe(true), { timeout: 15_000, interval: 100 })
    stop()
    expect(count()).toBe('1')
  }, 30_000)

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

describe('around the stages', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    Reflect.deleteProperty(document, 'elementsFromPoint')
  })

  it('a part scrolled to the top stops under the stuck section rail, not behind it (S2)', () => {
    document.body.innerHTML =
      '<nav style="position:sticky;top:0" id="rail"></nav><div role="dialog"><header style="position:sticky;top:0" id="own"></header></div><p id="text"></p>'
    const rail = document.getElementById('rail') as HTMLElement
    const own = document.getElementById('own') as HTMLElement
    const text = document.getElementById('text') as HTMLElement
    vi.spyOn(rail, 'getBoundingClientRect').mockReturnValue({ height: 56 } as DOMRect)
    vi.spyOn(own, 'getBoundingClientRect').mockReturnValue({ height: 90 } as DOMRect)
    // Only the boxes at the top edge of the window are looked at.
    const atTop = vi.fn(() => [own, rail, text, document.body])
    Object.defineProperty(document, 'elementsFromPoint', { value: atTop, configurable: true })
    expect(stuckTop()).toBe(56)
    expect(atTop).toHaveBeenCalledTimes(1)
  })

  it('names the part tapped and what the tap opens, not the parts around it (S6)', () => {
    document.body.innerHTML =
      '<section data-design-part="section"><article data-design-part="item"><button data-slot="item.open"><span data-design-part="item.name" id="name">Ayran</span></button><img data-design-part="item.photo" id="photo"></article></section>'
    expect(partOf(document.getElementById('name') as Element)).toEqual({
      part: 'item.name',
      opens: 'dish',
    })
    expect(partOf(document.getElementById('photo') as Element)).toEqual({
      part: 'item.photo',
      opens: null,
    })
    expect(partOf(document.body)).toBeNull()
  })

  it('a tap anywhere in the dish shown as a sheet, its close button too, is the dish (S6)', async () => {
    // Basic shows the dish as a sheet: the renderer's sheet panel holds the dish.
    const { view, stop } = await reach('dish', [])
    stop()
    const dish = view.container.querySelector('[data-design-part="dish"]') as HTMLElement
    const panel = dish.closest('[data-design-part="sheet"]') as HTMLElement
    expect(panel).toBeTruthy()
    const close = panel.querySelector('button') as HTMLButtonElement
    expect(close.closest('[data-design-part="dish"]')).toBeNull()
    expect(partOf(close)).toEqual({ part: 'dish', opens: null })
    expect(pageOfTap(partOf(close)?.part ?? '', null, 'dish')).toBeNull()
    // A part of its own inside the dish keeps its name.
    const photo = view.container.querySelector('[data-design-part="dish.photo"]')
    if (photo !== null) expect(partOf(photo)?.part).toBe('dish.photo')
    view.unmount()
  })

  it('closes the dish the stage opened by its address, with no step through the history (S10)', async () => {
    const release = keepHistoryInside(window)
    try {
      const steps = window.history.length
      const dishOf = (view: { container: HTMLElement }) =>
        view.container.querySelector('[data-design-part="dish"]')
      const first = await reach('dish', [])
      expect(window.location.hash).toMatch(/^#item-/)
      first.stop()
      closeStage()
      await waitFor(() => expect(dishOf(first.view)).toBeNull())
      expect(window.location.hash).toBe('')
      first.view.unmount()

      // The dish's own back button still closes it afterwards: one step back inside the frame.
      const again = await reach('dish', [])
      again.stop()
      const back = dishOf(again.view)?.closest('[role="dialog"]')?.querySelector('button')
      act(() => back?.click())
      await waitFor(() => expect(dishOf(again.view)).toBeNull())
      expect(window.location.hash).toBe('')
      // No step was added to the history the Design page shares with its frames.
      expect(window.history.length).toBe(steps)
      again.view.unmount()
    } finally {
      release()
    }
  })

  for (const stage of ['bag', 'bill', 'call', 'pay', 'receipt', 'dish'] as const) {
    it(`closes the ${stage} stage's sheet by its address, with no step through the history`, async () => {
      const release = keepHistoryInside(window)
      try {
        const steps = window.history.length
        const { view, stop } = await reach(stage, [])
        expect(view.container.querySelector('[role="dialog"]')).not.toBeNull()
        stop()
        act(() => closeStage())
        await waitFor(() => expect(view.container.querySelector('[role="dialog"]')).toBeNull())
        expect(window.location.hash).toBe('')
        expect(window.history.length).toBe(steps)
        view.unmount()
      } finally {
        release()
      }
    }, 30_000)
  }

  it('closing with nothing open leaves the address alone', () => {
    window.history.replaceState(null, '', `${window.location.pathname}#elsewhere`)
    const popped = vi.fn()
    window.addEventListener('popstate', popped)
    closeStage()
    expect(window.location.hash).toBe('#elsewhere')
    expect(popped).not.toHaveBeenCalled()
    window.removeEventListener('popstate', popped)
    window.history.replaceState(null, '', window.location.pathname)
  })

  it('a step back with nothing of the frame to go back to does nothing', () => {
    const release = keepHistoryInside(window)
    try {
      const popped = vi.fn()
      window.addEventListener('popstate', popped)
      window.history.back()
      expect(popped).not.toHaveBeenCalled()
      window.removeEventListener('popstate', popped)
    } finally {
      release()
    }
  })
})
