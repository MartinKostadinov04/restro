// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithIntl } from '@/test-utils'
import { HiddenBadge, OriginBadge, SaleBadge } from './badges'

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
