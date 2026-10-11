// @vitest-environment jsdom
// The draft preview draws the template the draft names (brief SH-04): the registry's default when
// it names none, `faceId` over the draft's own, the draft's options only for the template they
// belong to, and the preview's scheme over the snapshot's. The template is loaded on first use.
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

/** The fixture menu with a venue's chosen template (or none). */
function snapshotWith(presentation: MenuSnapshot['presentation']): MenuSnapshot {
  const { snapshot } = fixture('no-images')
  return presentation === undefined ? snapshot : { ...snapshot, presentation }
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
    expect((await faceRoot(container, 'editorial-market')).dataset.layout).toBe('two')
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

  it('draws the template of faceId instead, and the draft’s options only for their own template', async () => {
    const draft = snapshotWith({
      face: 'editorial-market',
      options: { layout: 'list', layoutSwitch: false },
    })
    const own = renderWithIntl(<DraftFace snapshot={draft} overlay={OVERLAY} scheme="light" />)
    expect((await faceRoot(own.container, 'editorial-market')).dataset.layout).toBe('list')
    own.unmount()

    // Another template is asked for: the options of the first one do not follow it.
    const other = renderWithIntl(
      <DraftFace snapshot={draft} overlay={OVERLAY} scheme="light" faceId="qr-phone" />,
    )
    await faceRoot(other.container, 'qr-phone')
    other.unmount()

    // And back: the draft names qr-phone with options, the override asks for the Editorial Market,
    // which starts from its own defaults.
    const back = renderWithIntl(
      <DraftFace
        snapshot={snapshotWith({ face: 'qr-phone', options: { layout: 'list' } })}
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

  it('forces the preview’s scheme on the template', async () => {
    const { container } = renderWithIntl(
      <DraftFace snapshot={snapshotWith(undefined)} overlay={OVERLAY} scheme="dark" />,
    )
    expect((await faceRoot(container, 'editorial-market')).dataset.scheme).toBe('dark')
  })
})
