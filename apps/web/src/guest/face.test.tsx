// @vitest-environment jsdom
// The phone face in a browser-like page (brief S3-03, component tests): the jump bar, the filter
// chips (tags and dietary), the allergen sheet, the language switch and a sold-out mark that comes
// from the live overlay. The face package itself is tested without a DOM (its contract test); the
// DOM libraries live in this app.
import type { LiveOverlay } from '@restro/core'
import { QR_PHONE_MANIFEST, QrPhoneFace } from '@restro/qr-phone'
import { buildViewModel, imageSlotsFor, type ViewModel } from '@restro/shell'
import { fixture } from '@restro/shell/testing'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

function view(name: string, overlay: LiveOverlay | null = null, locale?: 'bg_BG' | 'en_US') {
  const f = fixture(name)
  return buildViewModel(f.snapshot, overlay ?? f.overlay, {
    ...f.context,
    ...(locale ? { locale } : {}),
    images: imageSlotsFor(QR_PHONE_MANIFEST, 1),
  })
}

const itemNames = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-slot="item.name"]')].map((el) => el.textContent)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the jump bar', () => {
  const model = view('big-menu')

  it('has a link per section, in order, that scrolls to the section and highlights it', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    const { container } = render(<QrPhoneFace view={model} />)
    const links = within(container.querySelector('nav') as HTMLElement).getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(model.sections.map((s) => s.title.text))

    const second = links[1] as HTMLElement
    await userEvent.click(second)
    const target = container.querySelector(`#s-${model.sections[1]?.id}`)
    expect(scroll.mock.contexts).toContain(target)
    expect(second.getAttribute('aria-current')).toBe('true')
    expect(links.filter((link) => link.getAttribute('aria-current') === 'true')).toHaveLength(1)
  })

  it('highlights the section being read while the page scrolls', async () => {
    // The second section has reached the top of the screen; the third is still below it.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const id = (this as HTMLElement).dataset?.section
      const index = model.sections.findIndex((section) => section.id === id)
      const top = index < 0 ? 0 : index === 0 ? -600 : index === 1 ? 40 : 800
      return {
        top,
        bottom: top + 500,
        left: 0,
        right: 360,
        width: 360,
        height: 500,
        x: 0,
        y: top,
      } as DOMRect
    })
    const { container } = render(<QrPhoneFace view={model} />)
    act(() => {
      window.dispatchEvent(new Event('scroll'))
    })
    await waitFor(() => {
      const current = container.querySelector('nav a[aria-current="true"]')
      expect(current?.textContent).toBe(model.sections[1]?.title.text)
    })
  })

  it('is not drawn for a menu with a single section', () => {
    const { container } = render(<QrPhoneFace view={view('tags-dietary')} />)
    expect(container.querySelector('nav')).toBeNull()
  })
})

describe('the filter chips', () => {
  it('filters by tag (any of the chosen), keeping the order, and "All" brings everything back', async () => {
    const { container } = render(<QrPhoneFace view={view('tags-dietary')} />)
    expect(itemNames(container)).toEqual(['Негрони', 'Хумус'])

    await userEvent.click(screen.getByRole('button', { name: 'Фирмено' }))
    expect(itemNames(container)).toEqual(['Негрони'])
    expect(screen.getByRole('button', { name: 'Фирмено' }).getAttribute('aria-pressed')).toBe(
      'true',
    )

    const tags = screen.getByRole('group', { name: 'Етикети' })
    await userEvent.click(within(tags).getByRole('button', { name: 'Всички' }))
    expect(itemNames(container)).toEqual(['Негрони', 'Хумус'])
  })

  it('filters by dietary label (all of the chosen)', async () => {
    const { container } = render(<QrPhoneFace view={view('tags-dietary')} />)
    const diet = screen.getByRole('group', { name: 'Диета' })
    await userEvent.click(within(diet).getByRole('button', { name: 'Веган' }))
    expect(itemNames(container)).toEqual(['Негрони', 'Хумус'])
    await userEvent.click(within(diet).getByRole('button', { name: 'Вегетарианско' }))
    expect(itemNames(container)).toEqual(['Хумус'])
  })

  it('says nothing matches, and clearing the filters shows the menu again', async () => {
    const { container } = render(<QrPhoneFace view={view('tags-dietary')} />)
    await userEvent.click(screen.getByRole('button', { name: 'Фирмено' }))
    await userEvent.click(screen.getByRole('button', { name: 'Вегетарианско' }))
    expect(itemNames(container)).toEqual([])
    expect(screen.getByText('Нищо от менюто не отговаря на тези филтри.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Изчисти филтрите' }))
    expect(itemNames(container)).toEqual(['Негрони', 'Хумус'])
  })

  it('draws no chips when the menu has no tags or dietary labels', () => {
    const { container } = render(<QrPhoneFace view={view('no-images')} />)
    expect(container.querySelector('.rq-filters')).toBeNull()
  })
})

describe('the allergen legend sheet', () => {
  it('opens from an allergen code with the full names, marks the item’s own, and closes with Escape', async () => {
    const model = view('tags-dietary')
    render(<QrPhoneFace view={model} />)
    const trigger = screen.getAllByRole('button', { name: 'Сулфити' })[0] as HTMLElement
    // The code is the legend number; the name is for the screen reader.
    expect(trigger.textContent).toBe('12')
    await userEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Алергени' })
    const rows = within(dialog).getAllByRole('listitem')
    // The whole legend of the menu (Sesame 11, Sulphites 12), the item's own highlighted.
    expect(rows.map((row) => row.textContent)).toEqual(['11Сусам', '12Сулфити'])
    expect(rows.map((row) => row.getAttribute('data-on'))).toEqual(['false', 'true'])
    expect(within(dialog).getByText('Негрони')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Затвори')

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    // The focus goes back to where the guest was.
    expect(document.activeElement).toBe(trigger)
  })

  it('closes from the close button and from a tap outside', async () => {
    render(<QrPhoneFace view={view('tags-dietary')} />)
    await userEvent.click(screen.getAllByRole('button', { name: 'Сусам' })[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: 'Затвори' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(screen.getAllByRole('button', { name: 'Сусам' })[0] as HTMLElement)
    fireEvent.click(document.querySelector('.rq-backdrop') as HTMLElement)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('also lists every allergen in the footer, for a guest who never taps', () => {
    const { container } = render(<QrPhoneFace view={view('tags-dietary')} />)
    const legend = container.querySelector('[data-slot="menu.allergen_legend"]')
    expect(legend?.textContent).toContain('Сусам')
    expect(legend?.textContent).toContain('Сулфити')
  })
})

describe('the language switch', () => {
  it('shows both languages, marks the current one and tells the host which one was chosen', async () => {
    const onLanguageChange = vi.fn()
    render(
      <QrPhoneFace
        view={view('tags-dietary')}
        languages={['bg_BG', 'en_US']}
        onLanguageChange={onLanguageChange}
      />,
    )
    const group = screen.getByRole('group', { name: 'Език' })
    const [bg, en] = within(group).getAllByRole('button')
    expect(bg?.getAttribute('aria-pressed')).toBe('true')
    expect(en?.getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(en as HTMLElement)
    expect(onLanguageChange).toHaveBeenCalledWith('en_US')
  })

  it('draws the page in English when the view model is English (menu texts and the controls)', () => {
    const { container } = render(
      <QrPhoneFace view={view('tags-dietary', null, 'en_US')} languages={['bg_BG', 'en_US']} />,
    )
    expect(container.querySelector('.rq-root')?.getAttribute('lang')).toBe('en-US')
    expect(itemNames(container)).toEqual(['Negroni', 'Hummus'])
    expect(screen.getByRole('group', { name: 'Language' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Sulphites' })).toHaveLength(1)
  })
})

describe('sold out from the overlay', () => {
  it('marks an available item sold out with its word, and nothing else changes', () => {
    const base = view('tags-dietary')
    const negroni = base.sections[0]?.items[0]
    expect(negroni?.state.code).toBe('available')
    const overlay: LiveOverlay = {
      version: 1,
      items: { [negroni?.id as string]: { sold_out: true } },
    } as LiveOverlay
    const { container } = render(<QrPhoneFace view={view('tags-dietary', overlay)} />)
    const card = container.querySelector(`[data-item="${negroni?.id}"]`) as HTMLElement
    expect(card.getAttribute('data-state')).toBe('sold_out')
    expect(card.querySelector('[data-slot="item.state"]')?.textContent).toBe('Изчерпано')
    expect(card.querySelector('[data-slot="item.state"]')?.getAttribute('data-state')).toBe(
      'sold_out',
    )
    // The other item stays as it was.
    const other = container.querySelectorAll('[data-item]')[1] as HTMLElement
    expect(other.getAttribute('data-state')).toBe('available')
  })

  it('shows a scheduled item with its time (“от 18:00”)', () => {
    const model: ViewModel = view('scheduled')
    const states = model.sections
      .flatMap((s) => s.items)
      .filter((i) => i.state.code === 'scheduled')
    expect(states.length).toBeGreaterThan(0)
    const { container } = render(<QrPhoneFace view={model} />)
    const texts = [
      ...container.querySelectorAll('[data-state="scheduled"] [data-slot="item.state"]'),
    ]
    expect(texts.map((el) => el.textContent)).toContain(states[0]?.state.label?.text)
  })
})
