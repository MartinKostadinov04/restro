// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithIntl } from '@/test-utils'
import { HiddenBadge } from './badges'

describe('HiddenBadge: new items the sync held for review (S3-04)', () => {
  it('says "New from barsy, hidden until you show it" in English', () => {
    renderWithIntl(<HiddenBadge hiddenBy="new_from_barsy" />)
    const badge = screen.getByTestId('hidden-badge')
    expect(badge.textContent).toBe('New from barsy, hidden until you show it')
    expect(badge.getAttribute('data-hidden-by')).toBe('new_from_barsy')
  })

  it('and in Bulgarian', () => {
    renderWithIntl(<HiddenBadge hiddenBy="new_from_barsy" />, { locale: 'bg' })
    expect(screen.getByTestId('hidden-badge').textContent).toBe(
      'Нов от barsy, скрит, докато не го покажете',
    )
  })

  it('the other hides keep their own words', () => {
    renderWithIntl(<HiddenBadge hiddenBy="builder" />)
    expect(screen.getByTestId('hidden-badge').textContent).toBe('Hidden')
  })
})
