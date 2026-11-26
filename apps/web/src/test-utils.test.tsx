// @vitest-environment jsdom
// The test helpers' own tests. `waitUntilClickable` exists because a dialog's text lands a render
// before Radix gives its layer the pointer events back, and a type sent in that gap fails outright
// (CI, 11-26: venue-name.test.tsx). A helper that only ever saw the settled state would prove
// nothing, so these cases hold it against the inert state it is meant to wait out.
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithIntl, waitUntilClickable } from './test-utils'

describe('waitUntilClickable', () => {
  it('resolves at once when no ancestor speaks for the element', async () => {
    renderWithIntl(<button type="button">Plain</button>)
    await expect(waitUntilClickable(screen.getByRole('button'))).resolves.toBeUndefined()
  })

  it('resolves when the element sits in a layer that has its pointer events, under an inert body', async () => {
    // The shape Radix leaves behind: the body is off, the topmost layer is on.
    document.body.style.pointerEvents = 'none'
    renderWithIntl(
      <div style={{ pointerEvents: 'auto' }}>
        <button type="button">In the layer</button>
      </div>,
    )
    await expect(waitUntilClickable(screen.getByRole('button'))).resolves.toBeUndefined()
    document.body.style.pointerEvents = ''
  })

  it('waits while an ancestor is inert, and resolves once that ancestor turns on', async () => {
    const { container } = renderWithIntl(
      <div style={{ pointerEvents: 'none' }}>
        <button type="button">Not yet</button>
      </div>,
    )
    const layer = container.firstElementChild as HTMLElement
    const button = screen.getByRole('button')

    let settled = false
    const waiting = waitUntilClickable(button).then(() => {
      settled = true
    })
    // Still inert: the helper must not have resolved on the first look.
    await Promise.resolve()
    expect(settled).toBe(false)

    layer.style.pointerEvents = 'auto'
    await waiting
    expect(settled).toBe(true)
  })

  it('gives up rather than hanging for ever when the element stays inert', async () => {
    renderWithIntl(
      <div style={{ pointerEvents: 'none' }}>
        <button type="button">Never</button>
      </div>,
    )
    await expect(waitUntilClickable(screen.getByRole('button'), { timeout: 150 })).rejects.toThrow(
      /pointer events are still off/,
    )
  })
})
