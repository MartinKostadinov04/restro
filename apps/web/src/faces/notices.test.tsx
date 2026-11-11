// @vitest-environment jsdom
// The host's loading skeleton and notice in the venue's General look (D130): where the menu is
// known they carry its colours for both screens, its font, corners, Buttons, text size and density;
// where it is not (no look given) they carry nothing of the kind and keep the browser's colours.
import { buildViewModel, imageSlotsFor } from '@restro/shell'
import { fixture } from '@restro/shell/testing'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { MenuNotice, MenuSkeleton, noticeLook } from './notices'
import { faceEntry } from './registry'

const f = fixture('no-images')
const view = buildViewModel(f.snapshot, f.overlay, {
  ...f.context,
  locale: 'en_US',
  images: imageSlotsFor(faceEntry(null).manifest, 1),
})

afterEach(cleanup)

const styleOf = (element: HTMLElement) => element.getAttribute('style') ?? ''

describe('noticeLook', () => {
  it('takes the venue’s colours for both screens, its font and its corners', () => {
    const look = noticeLook(view.theme, view.design, { [view.theme.font]: 'var(--font-test)' })
    const style = look.style as Record<string, string>
    expect(style['--gp-l-bg']).toBe(view.theme.colors.background)
    expect(style['--gp-l-fg']).toBe(view.theme.colors.text)
    expect(style['--gp-d-bg']).toBe(view.theme.colorsDark.background)
    expect(style['--gp-d-fg']).toBe(view.theme.colorsDark.text)
    expect(style['--gp-font']).toBe('var(--font-test)')
    expect(style['--gp-radius']).toBe(`${view.theme.radius}px`)
    expect(look.scheme).toBe(view.theme.scheme)
  })

  it('follows Buttons: the accent, or the ink with the page’s colour as its writing', () => {
    const design = (buttons: 'accent' | 'ink') =>
      ({ ...view.design, general: { ...view.design.general, buttons } }) as typeof view.design
    const accent = noticeLook(view.theme, design('accent')).style as Record<string, string>
    const ink = noticeLook(view.theme, design('ink')).style as Record<string, string>
    expect(accent['--gp-l-button']).toBe(view.theme.colors.accent)
    expect(accent['--gp-l-on-button']).toBe(view.theme.colors.onAccent)
    expect(ink['--gp-l-button']).toBe(view.theme.colors.text)
    expect(ink['--gp-l-on-button']).toBe(view.theme.colors.background)
  })

  it('follows the text size, the density and square corners', () => {
    const general = (change: Record<string, string>) =>
      noticeLook(view.theme, {
        ...view.design,
        general: { ...view.design.general, ...change },
      } as typeof view.design).style as Record<string, string>
    expect(general({ text_size: 'large' })['--gp-type']).toBe('1.125')
    expect(general({ text_size: 'standard' })['--gp-type']).toBe('1')
    expect(general({ density: 'compact' })['--gp-space']).toBe('0.75')
    expect(general({ density: 'spacious' })['--gp-space']).toBe('1.25')
    expect(general({ corners: 'square' })['--gp-pill']).toBe('0px')
    expect(general({ corners: 'soft' })['--gp-pill']).not.toBe('0px')
  })
})

describe('the skeleton and the notice', () => {
  it('draw in the venue’s look when they are given one', () => {
    const look = noticeLook(view.theme, view.design)
    render(<MenuSkeleton label="Loading" lang="en" look={look} />)
    render(<MenuNotice title="Oops" text="Try again" lang="en" look={look} />)
    for (const id of ['menu-skeleton', 'menu-notice']) {
      const root = screen.getByTestId(id)
      expect(styleOf(root)).toContain(`--gp-l-bg: ${view.theme.colors.background}`)
      expect(root.getAttribute('data-scheme')).toBe(view.theme.scheme)
    }
  })

  it('keep the browser’s colours when the menu is not known', () => {
    render(<MenuNotice title="Not here" text="No such menu" lang="en" />)
    const root = screen.getByTestId('menu-notice')
    expect(styleOf(root)).toBe('')
    expect(root.getAttribute('data-scheme')).toBeNull()
  })
})
