// @vitest-environment jsdom
// The draft preview draws the template the draft names (brief SH-04): the registry's default when
// it names none, `faceId` over the draft's own, the menu's layout whichever template draws it
// (D92), and the preview's scheme over the snapshot's. The template is loaded on first use.
import type { MenuSnapshot } from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'
import { DraftFace } from './draft-face'

afterEach(() => {
  vi.restoreAllMocks()
})

const OVERLAY = { version: 1, items: {} }

/** The fixture menu with a venue's chosen template (or none), and a menu layout (or none). */
function snapshotWith(
  presentation: MenuSnapshot['presentation'],
  layout?: MenuSnapshot['layout'],
): MenuSnapshot {
  const { snapshot } = fixture('no-images')
  return {
    ...snapshot,
    ...(presentation === undefined ? {} : { presentation }),
    ...(layout === undefined ? {} : { layout }),
  }
}

/** The root of a template once its code has loaded (the skeleton shows until then). */
const faceRoot = (container: HTMLElement, face: string) =>
  waitFor(() => {
    const root = container.querySelector(`[data-face="${face}"]:not([data-testid])`)
    expect(root, `${face} is on the screen`).toBeTruthy()
    return root as HTMLElement
  })

describe('the draft face', () => {
  it('shows the loading skeleton first, then the default template when the draft names none', async () => {
    const { container } = renderWithIntl(
      <DraftFace snapshot={snapshotWith(undefined)} overlay={OVERLAY} scheme="light" />,
    )
    expect(screen.getByTestId('menu-skeleton')).toBeTruthy()
    // No menu layout in the draft (D92): a list.
    expect((await faceRoot(container, 'editorial-market')).dataset.layout).toBe('list')
    expect(screen.queryByTestId('menu-skeleton')).toBeNull()
  })

  it('draws the template the draft names', async () => {
    const { container } = renderWithIntl(
      <DraftFace
        snapshot={snapshotWith({ face: 'qr-phone', options: {} })}
        overlay={OVERLAY}
        scheme="light"
      />,
    )
    await faceRoot(container, 'qr-phone')
    expect(container.querySelector('[data-face="editorial-market"]')).toBeNull()
  })

  it('draws the template of faceId instead, in the menu’s layout whichever template it is', async () => {
    const draft = snapshotWith(
      { face: 'editorial-market', options: {} },
      { default: 'one', guest_switch: false },
    )
    const own = renderWithIntl(<DraftFace snapshot={draft} overlay={OVERLAY} scheme="light" />)
    expect((await faceRoot(own.container, 'editorial-market')).dataset.layout).toBe('one')
    own.unmount()

    // Another template is asked for: the options of the first one do not follow it.
    const other = renderWithIntl(
      <DraftFace snapshot={draft} overlay={OVERLAY} scheme="light" faceId="qr-phone" />,
    )
    await faceRoot(other.container, 'qr-phone')
    other.unmount()

    // And back: the draft names qr-phone, the override asks for the Editorial Market, which draws
    // the menu's layout: a setting of the menu (D92), not of a template.
    const back = renderWithIntl(
      <DraftFace
        snapshot={snapshotWith(
          { face: 'qr-phone', options: { layout: 'list' } },
          { default: 'two', guest_switch: true },
        )}
        overlay={OVERLAY}
        scheme="light"
        faceId="editorial-market"
      />,
    )
    expect((await faceRoot(back.container, 'editorial-market')).dataset.layout).toBe('two')
  })

  it('gives the default template for a name the registry does not know', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { container } = renderWithIntl(
      <DraftFace
        snapshot={snapshotWith({ face: 'removed-template', options: {} })}
        overlay={OVERLAY}
        scheme="light"
      />,
    )
    await faceRoot(container, 'editorial-market')
  })

  it('draws the services the venue switched on only in the services preview, with the demo host', async () => {
    const draft: MenuSnapshot = {
      ...snapshotWith(undefined),
      features: {
        filters: true,
        call_waiter: { enabled: false, kinds: [] },
        bill: true,
        ordering: false,
        pay: false,
      },
    }
    const SERVICE_SLOTS = ['menu.call_waiter', 'menu.bill', 'menu.bag', 'menu.pay']
    const serviceSlots = (container: HTMLElement) =>
      [...container.querySelectorAll('[data-slot]')]
        .map((node) => node.getAttribute('data-slot'))
        .filter((slot) => slot !== null && SERVICE_SLOTS.includes(slot))

    // The plain preview is the guest page: no platform behind it, so no service at all (R15).
    const plain = renderWithIntl(<DraftFace snapshot={draft} overlay={OVERLAY} scheme="light" />)
    await faceRoot(plain.container, 'editorial-market')
    expect(serviceSlots(plain.container)).toEqual([])
    plain.unmount()

    // The services preview: the venue's bill, and nothing it left off.
    const preview = renderWithIntl(
      <DraftFace snapshot={draft} overlay={OVERLAY} scheme="light" servicesPreview />,
    )
    await faceRoot(preview.container, 'editorial-market')
    expect(serviceSlots(preview.container)).toEqual(['menu.bill'])
  })

  it('forces the preview’s scheme on the template', async () => {
    const { container } = renderWithIntl(
      <DraftFace snapshot={snapshotWith(undefined)} overlay={OVERLAY} scheme="dark" />,
    )
    expect((await faceRoot(container, 'editorial-market')).dataset.scheme).toBe('dark')
  })
})
