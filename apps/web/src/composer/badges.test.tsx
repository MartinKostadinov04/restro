// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { renderWithIntl } from '@/test-utils'
import {
  HiddenBadge,
  NameFromTillBadge,
  NameFromTillNotice,
  OriginBadge,
  SaleBadge,
} from './badges'

describe('HiddenBadge: new items the sync held for review (S3-04)', () => {
  it('says "New from barsy, hidden until you show it" in English', () => {
    renderWithIntl(<HiddenBadge hiddenBy="new_from_till" />)
    const badge = screen.getByTestId('hidden-badge')
    expect(badge.textContent).toBe('New from barsy, hidden until you show it')
    expect(badge.getAttribute('data-hidden-by')).toBe('new_from_till')
  })

  it('and in Bulgarian', () => {
    renderWithIntl(<HiddenBadge hiddenBy="new_from_till" />, { locale: 'bg' })
    expect(screen.getByTestId('hidden-badge').textContent).toBe(
      'Нов от barsy, скрит, докато не го покажете',
    )
  })

  it('the other hides keep their own words', () => {
    renderWithIntl(<HiddenBadge hiddenBy="builder" />)
    expect(screen.getByTestId('hidden-badge').textContent).toBe('Hidden')
  })
})

describe('the badges name the till the menu comes from, whichever connector it is (CF-03)', () => {
  it('fills {source} with the till’s name, in both languages', () => {
    const { unmount } = renderWithIntl(
      <>
        <OriginBadge origin="till" />
        <HiddenBadge hiddenBy="till" />
        <SaleBadge soldOutTonight={false} offSale="till" />
      </>,
      { tillLabel: 'Kasa 2' },
    )
    expect(screen.getByTestId('origin-badge').textContent).toBe('From Kasa 2')
    expect(screen.getByTestId('origin-badge').getAttribute('data-origin')).toBe('till')
    expect(screen.getByTestId('hidden-badge').textContent).toBe('Hidden by Kasa 2')
    expect(screen.getByTestId('hidden-badge').getAttribute('data-hidden-by')).toBe('till')
    expect(screen.getByTestId('off-sale-badge').textContent).toBe('Not on sale in Kasa 2')
    unmount()
    renderWithIntl(<HiddenBadge hiddenBy="till" />, { locale: 'bg', tillLabel: 'Kasa 2' })
    expect(screen.getByTestId('hidden-badge').textContent).toBe('Скрито от Kasa 2')
  })
})

describe('the warning that the name shown is the till’s own (D75)', () => {
  it('says "Menu name missing in {source}: its own name is shown", naming the till', () => {
    renderWithIntl(<NameFromTillBadge />, { tillLabel: 'Kasa 2' })
    expect(screen.getByTestId('name-from-till-badge').textContent).toBe(
      'Menu name missing in Kasa 2: its own name is shown',
    )
  })

  it('and in Bulgarian', () => {
    renderWithIntl(<NameFromTillBadge />, { locale: 'bg', tillLabel: 'Kasa 2' })
    expect(screen.getByTestId('name-from-till-badge').textContent).toBe(
      'Липсва име за менюто в Kasa 2: показва се собственото му име',
    )
  })

  it('shows the way out on hover or focus: fill the public name in the till, or type one here', async () => {
    const user = userEvent.setup()
    renderWithIntl(<NameFromTillBadge />, { tillLabel: 'Kasa 2' })
    await user.hover(screen.getByTestId('name-from-till-badge'))
    expect((await screen.findByTestId('name-from-till-help')).textContent).toBe(
      'Fill in the public name in Kasa 2, or type a name here.',
    )
  })

  it('a section’s help line names the till, or renaming the section here (S6)', async () => {
    const user = userEvent.setup()
    renderWithIntl(<NameFromTillBadge target="section" />, { tillLabel: 'Kasa 2' })
    await user.hover(screen.getByTestId('name-from-till-badge'))
    expect((await screen.findByTestId('name-from-till-help')).textContent).toBe(
      'Fill in the public name in Kasa 2, or rename the section here.',
    )
  })

  it('the item sheet’s notice carries both lines without a hover, in both languages', () => {
    const { unmount } = renderWithIntl(<NameFromTillNotice />, { tillLabel: 'Kasa 2' })
    const notice = screen.getByTestId('name-from-till-notice')
    expect(notice.textContent).toContain('Menu name missing in Kasa 2: its own name is shown')
    expect(notice.textContent).toContain('Fill in the public name in Kasa 2, or type a name here.')
    unmount()
    renderWithIntl(<NameFromTillNotice />, { locale: 'bg', tillLabel: 'Kasa 2' })
    expect(screen.getByTestId('name-from-till-notice').textContent).toContain(
      'Попълнете публичното име в Kasa 2 или въведете име тук.',
    )
  })
})
