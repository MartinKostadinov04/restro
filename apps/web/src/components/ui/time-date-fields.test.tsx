// @vitest-environment jsdom
// The shared time field (always 24-hour) and date field (day.month.year): typing, arrow keys,
// the stored values they hand back, and the announced error.
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { useFieldValidity } from '@/lib/use-field-validity'
import { renderWithIntl } from '@/test-utils'
import { DateField } from './date-field'
import { TimeField } from './time-field'

function Time({ initial = '', onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <label htmlFor="t">Time</label>
      <TimeField
        id="t"
        value={value}
        onChange={(next) => {
          setValue(next)
          onValue?.(next)
        }}
      />
    </>
  )
}

function DateOnly({ initial = '', onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <label htmlFor="d">Night</label>
      <DateField
        id="d"
        value={value}
        onChange={(next) => {
          setValue(next)
          onValue?.(next)
        }}
      />
    </>
  )
}

describe('TimeField', () => {
  it('hands back HH:mm from "0530" and shows it normalised on leaving', async () => {
    const user = userEvent.setup()
    const seen = vi.fn()
    renderWithIntl(<Time onValue={seen} />)
    const field = screen.getByLabelText('Time') as HTMLInputElement
    await user.type(field, '0530')
    await user.tab()
    expect(seen).toHaveBeenLastCalledWith('05:30')
    expect(field.value).toBe('05:30')
  })

  it('commits typed text only on blur or Enter, never a half-typed value', async () => {
    const user = userEvent.setup()
    const seen = vi.fn()
    renderWithIntl(<Time onValue={seen} />)
    const field = screen.getByLabelText('Time')
    await user.type(field, '223')
    expect(seen).not.toHaveBeenCalled()
    await user.type(field, '0')
    expect(seen).not.toHaveBeenCalled()
    await user.tab()
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen).toHaveBeenCalledWith('22:30')
    await user.clear(field)
    await user.type(field, '0615{Enter}')
    expect(seen).toHaveBeenLastCalledWith('06:15')
  })

  it('reports invalid text through onValidityChange and clears it when valid', async () => {
    const user = userEvent.setup()
    const validity = vi.fn()
    renderWithIntl(
      <TimeField id="t" value="22:00" onChange={() => {}} onValidityChange={validity} />,
    )
    const field = screen.getByRole('textbox')
    await user.clear(field)
    await user.type(field, '25:00')
    expect(validity).toHaveBeenLastCalledWith(true, 't')
    await user.tab()
    expect(validity).toHaveBeenLastCalledWith(true, 't')
    await user.clear(field)
    await user.type(field, '23:00')
    expect(validity).toHaveBeenLastCalledWith(false, 't')
  })

  it('blocks a form submit while invalid and focuses the field', async () => {
    const user = userEvent.setup()
    const saved = vi.fn()
    function Form() {
      const [value, setValue] = useState('22:00')
      const validity = useFieldValidity()
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (validity.blocked()) return
            saved(value)
          }}
        >
          <TimeField
            id="t"
            value={value}
            onChange={setValue}
            onValidityChange={validity.onValidityChange}
          />
          <button type="submit">Save</button>
        </form>
      )
    }
    renderWithIntl(<Form />)
    const field = screen.getByRole('textbox')
    await user.clear(field)
    await user.type(field, '25:00')
    await user.click(screen.getByText('Save'))
    expect(saved).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(field)
    await user.clear(field)
    await user.type(field, '23:15')
    await user.click(screen.getByText('Save'))
    expect(saved).toHaveBeenCalledWith('23:15')
  })

  it('steps with the arrow keys and wraps past midnight', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Time initial="23:55" />)
    const field = screen.getByLabelText('Time') as HTMLInputElement
    field.focus()
    await user.keyboard('{ArrowUp}')
    expect(field.value).toBe('00:00')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(field.value).toBe('23:50')
  })

  it('announces "25:00" as an error and never hands it back', async () => {
    const user = userEvent.setup()
    const seen = vi.fn()
    renderWithIntl(<Time initial="22:00" onValue={seen} />)
    const field = screen.getByLabelText('Time')
    await user.clear(field)
    seen.mockClear()
    await user.type(field, '25:00')
    await user.tab()
    expect(screen.getByRole('alert').textContent).toMatch(/24-hour/)
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(seen).not.toHaveBeenCalledWith('25:00')
  })

  it('speaks Bulgarian when the interface does', async () => {
    const user = userEvent.setup()
    renderWithIntl(<Time />, { locale: 'bg' })
    await user.type(screen.getByLabelText('Time'), '99:99')
    await user.tab()
    expect(screen.getByRole('alert').textContent).toMatch(/24-часов/)
  })
})

describe('DateField', () => {
  it('shows a stored date as day.month.year', () => {
    renderWithIntl(<DateOnly initial="2026-11-10" />)
    expect((screen.getByLabelText('Night') as HTMLInputElement).value).toBe('10.11.2026')
  })

  it('hands back yyyy-MM-dd from a typed Bulgarian date', async () => {
    const user = userEvent.setup()
    const seen = vi.fn()
    renderWithIntl(<DateOnly onValue={seen} />)
    await user.type(screen.getByLabelText('Night'), '24.12.2030')
    await user.tab()
    expect(seen).toHaveBeenLastCalledWith('2030-12-24')
  })

  it('does not commit a half-typed ISO date', async () => {
    const user = userEvent.setup()
    const seen = vi.fn()
    const validity = vi.fn()
    renderWithIntl(<DateField id="d" value="" onChange={seen} onValidityChange={validity} />)
    const field = screen.getByRole('textbox')
    await user.type(field, '2026-11-1')
    expect(seen).not.toHaveBeenCalled()
    await user.type(field, '4{Enter}')
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen).toHaveBeenCalledWith('2026-11-14')
  })

  it('reports an impossible date as invalid', async () => {
    const user = userEvent.setup()
    const validity = vi.fn()
    renderWithIntl(<DateField id="d" value="" onChange={() => {}} onValidityChange={validity} />)
    await user.type(screen.getByRole('textbox'), '31.02.2026')
    await user.tab()
    expect(validity).toHaveBeenLastCalledWith(true, 'd')
  })

  it('moves a day with the arrow keys', async () => {
    const user = userEvent.setup()
    renderWithIntl(<DateOnly initial="2026-11-30" />)
    const field = screen.getByLabelText('Night') as HTMLInputElement
    field.focus()
    await user.keyboard('{ArrowUp}')
    expect(field.value).toBe('01.12.2026')
  })

  it('announces a date that does not exist', async () => {
    const user = userEvent.setup()
    renderWithIntl(<DateOnly />)
    await user.type(screen.getByLabelText('Night'), '31.02.2026')
    await user.tab()
    expect(screen.getByRole('alert')).toBeTruthy()
  })
})
