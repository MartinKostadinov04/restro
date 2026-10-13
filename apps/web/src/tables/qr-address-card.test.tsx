// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { QrAddressCard } from './qr-address-card'
import { TOKEN_A, view } from './test-view'

describe('the address card (D94)', () => {
  it('says where the codes lead and has nothing to type or save', () => {
    renderWithIntl(<QrAddressCard view={view()} />)
    expect(screen.getByText('Address in the codes')).toBeTruthy()
    expect(screen.getByTestId('qr-address').textContent).toBe('http://localhost:3000/t/<code>')
    // Read-only: no field, no radio, no button except the test link.
    expect(document.querySelectorAll('input, textarea, select')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull()
    expect(screen.queryByRole('radio')).toBeNull()
  })

  it('warns that printed codes keep their address and that a domain of your own comes later', () => {
    renderWithIntl(<QrAddressCard view={view()} />)
    expect(screen.getByTestId('qr-address-warning').textContent).toContain(
      'Stickers you have already printed keep the address they were printed with.',
    )
    expect(screen.getByTestId('qr-address-domain').textContent).toBe(
      'A domain of your own for the codes comes later.',
    )
  })

  it('opens the test link, an address of the first table with a code, in a new tab', () => {
    renderWithIntl(<QrAddressCard view={view()} />)
    const link = screen.getByTestId('open-test-link') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`http://localhost:3000/t/${TOKEN_A}`)
    expect(link.target).toBe('_blank')
    expect(link.rel).toContain('noopener')
  })

  it('waits for a code before the test link works', () => {
    renderWithIntl(<QrAddressCard view={view({ sample: null })} />)
    const button = screen.getByTestId('open-test-link') as HTMLButtonElement
    expect(button.tagName).toBe('BUTTON')
    expect(button.disabled).toBe(true)
    expect(screen.getByText('Create a code for a table first, then test the link.')).toBeTruthy()
  })

  it('says so when the installation has no address, and offers no test link', () => {
    renderWithIntl(<QrAddressCard view={view({ baseUrl: null })} />)
    expect(screen.getByTestId('qr-address-none').textContent).toContain('no address configured')
    expect(screen.queryByTestId('qr-address')).toBeNull()
    expect((screen.getByTestId('open-test-link') as HTMLButtonElement).disabled).toBe(true)
  })

  it('looks the same to a member who may not manage codes', () => {
    renderWithIntl(<QrAddressCard view={view({ canManage: false })} />)
    expect(screen.getByTestId('qr-address').textContent).toBe('http://localhost:3000/t/<code>')
    expect(screen.getByTestId('open-test-link')).toBeTruthy()
  })

  it('reads in Bulgarian', () => {
    renderWithIntl(<QrAddressCard view={view()} />, { locale: 'bg' })
    expect(screen.getByText('Адрес в кодовете')).toBeTruthy()
    expect(screen.getByTestId('qr-address-domain').textContent).toBe(
      'Собствен домейн за кодовете ще има по-късно.',
    )
  })
})
