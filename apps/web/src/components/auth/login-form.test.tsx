// @vitest-environment jsdom
// WCAG 3.3.1 (lane 5 S29): a failed sign-in marks both fields invalid and names the sentence that
// says why, so a screen reader reads it with the field.
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { authClient } from '@/lib/auth-client'
import { renderWithIntl } from '@/test-utils'

import { LoginForm } from './login-form'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('@/lib/auth-client', () => ({ authClient: { signIn: { email: vi.fn() } } }))

describe('LoginForm', () => {
  it('ties a wrong email or password to both fields', async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue({
      data: null,
      error: { status: 401 },
    } as never)
    const user = userEvent.setup()
    renderWithIntl(<LoginForm next="/venues" />)
    const email = screen.getByLabelText('Email')
    const password = screen.getByLabelText('Password')
    expect(email.getAttribute('aria-invalid')).toBeNull()
    expect(email.getAttribute('aria-describedby')).toBeNull()
    await user.type(email, 'someone@example.test')
    await user.type(password, 'not-the-password')
    await waitFor(() =>
      expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false),
    )
    await user.click(screen.getByRole('button'))
    const error = await screen.findByTestId('login-error')
    expect(error.id).toBe('login-error')
    for (const field of [email, password]) {
      expect(field.getAttribute('aria-invalid')).toBe('true')
      expect(field.getAttribute('aria-describedby')).toBe('login-error')
    }
  })
})
