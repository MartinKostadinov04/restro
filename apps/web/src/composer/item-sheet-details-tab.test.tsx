// @vitest-environment jsdom
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ITEM_GROUPS } from '@/fields/item-groups'
import { renderWithIntl } from '@/test-utils'

import { ItemSheetDetailsTab, type ItemSheetDetailsTabProps } from './item-sheet-details-tab'
import { sheetData } from './item-sheet-test-data'

function setup(
  data = sheetData(),
  props: Partial<ItemSheetDetailsTabProps> = {},
  locale: 'en' | 'bg' = 'en',
) {
  const handlers = {
    onSave: vi.fn(async () => true),
    onRevert: vi.fn(async () => true),
    onKeep: vi.fn(async () => true),
    onOpenMedia: vi.fn(),
    onSoldOut: vi.fn(async () => true),
  }
  renderWithIntl(<ItemSheetDetailsTab data={data} busy={false} {...handlers} {...props} />, {
    locale,
  })
  return handlers
}

const row = (key: string) => {
  const found = document.querySelector<HTMLElement>(
    `[data-testid="field-row"][data-field-key="${key}"]`,
  )
  if (!found) throw new Error(`no row for ${key}`)
  return found
}

describe('the Details tab', () => {
  it('warns that the name is the till’s own when it has no public one (D75)', () => {
    setup(sheetData({ nameFromTill: true }))
    expect(screen.getByTestId('name-from-till-notice').textContent).toContain(
      'Menu name missing in',
    )
  })

  it('has no such warning for a name that is public or typed here', () => {
    setup(sheetData({ nameFromTill: false }))
    expect(screen.queryByTestId('name-from-till-notice')).toBeNull()
  })

  it('shows one row for every Item field, grouped under dividers, in template order', () => {
    setup()
    const keys = [...document.querySelectorAll('[data-testid="field-row"]')].map((el) =>
      el.getAttribute('data-field-key'),
    )
    expect(keys).toEqual(ITEM_GROUPS.flatMap((group) => group.keys))
    expect(keys).toHaveLength(14)
    for (const name of [
      'Content',
      'Price and portion',
      'Attributes',
      'Ordering and availability',
      'Internal',
    ]) {
      expect(screen.getByText(name)).toBeTruthy()
    }
  })

  it('shows the price of a linked item locked: a badge and "Change this in barsy", no edit button', () => {
    setup(
      sheetData({
        fields: {
          price: {
            value: { amount_minor: 1250, currency: 'EUR' },
            provenance: 'locked',
            layer: 'till',
            access: { kind: 'readonly', reason: 'locked_to_till' },
          },
        },
      }),
    )
    const price = row('price')
    expect(within(price).getByText('Locked')).toBeTruthy()
    expect(within(price).getByTestId('read-only-note').textContent).toBe('Change this in barsy.')
    expect(within(price).queryByRole('button', { name: /edit price/i })).toBeNull()
    expect(within(price).getByText(/12\.50/)).toBeTruthy()
  })

  it('says it in Bulgarian too', () => {
    setup(
      sheetData({
        fields: {
          price: {
            value: { amount_minor: 1250, currency: 'EUR' },
            provenance: 'locked',
            access: { kind: 'readonly', reason: 'locked_to_till' },
          },
        },
      }),
      {},
      'bg',
    )
    expect(within(row('price')).getByText('Заключено')).toBeTruthy()
    expect(within(row('price')).getByTestId('read-only-note').textContent).toBe(
      'Променете това в barsy.',
    )
  })

  it('shows the provenance badge of each value', () => {
    setup(
      sheetData({
        fields: {
          name: { value: { bg_BG: 'Негрони' }, provenance: 'till', layer: 'till' },
          description: { value: { bg_BG: 'Горчив' }, provenance: 'owned', layer: 'manual' },
          portion: {
            value: { value: 80, unit: 'ml' },
            provenance: 'overridden',
            layer: 'override',
          },
        },
      }),
    )
    expect(within(row('name')).getByText('From barsy')).toBeTruthy()
    expect(within(row('description')).getByText('Owned here')).toBeTruthy()
    expect(within(row('portion')).getByText('Overridden')).toBeTruthy()
    expect(within(row('abv')).queryByText(/barsy|Owned|Overridden/)).toBeNull()
  })

  it('shows read-only reasons for the flags and sends the image to the Media tab', async () => {
    const { onOpenMedia } = setup(
      sheetData({
        fields: {
          visible: {
            value: true,
            provenance: 'till',
            access: { kind: 'readonly', reason: 'composer_toggle' },
          },
          for_sale: {
            value: true,
            provenance: 'till',
            access: { kind: 'readonly', reason: 'sold_out_control' },
          },
          image: { access: { kind: 'media' } },
        },
      }),
    )
    expect(within(row('visible')).getByTestId('read-only-note').textContent).toMatch(/composer/)
    expect(within(row('for_sale')).getByTestId('read-only-note').textContent).toMatch(
      /sold out tonight/i,
    )
    expect(within(row('visible')).queryByRole('button', { name: /edit/i })).toBeNull()
    await userEvent.click(within(row('image')).getByRole('button', { name: /^(edit|set) image/i }))
    expect(onOpenMedia).toHaveBeenCalledTimes(1)
  })

  it("an overridden value shows barsy's value beside it and Revert", async () => {
    const { onRevert } = setup(
      sheetData({
        fields: {
          allergens: {
            value: ['gluten', 'milk'],
            provenance: 'overridden',
            layer: 'override',
            canRevert: true,
            tillValue: ['gluten'],
          },
        },
      }),
    )
    const allergens = row('allergens')
    expect(within(within(allergens).getByTestId('till-value')).getByText('Gluten')).toBeTruthy()
    await userEvent.click(within(allergens).getByRole('button', { name: /revert allergens/i }))
    expect(onRevert).toHaveBeenCalledWith('allergens')
  })

  it('a stale override offers "Keep mine" and "Take barsy\'s"', async () => {
    const { onKeep, onRevert } = setup(
      sheetData({
        fields: {
          portion: {
            value: { value: 90, unit: 'ml' },
            provenance: 'stale',
            layer: 'override',
            canRevert: true,
            canKeep: true,
            tillValue: { value: 100, unit: 'ml' },
          },
        },
      }),
    )
    const portion = row('portion')
    expect(within(portion).getByText('Stale')).toBeTruthy()
    expect(within(portion).getByText(/barsy changed this after you replaced it/i)).toBeTruthy()
    await userEvent.click(within(portion).getByRole('button', { name: /keep my value/i }))
    expect(onKeep).toHaveBeenCalledWith('portion')
    await userEvent.click(within(portion).getByRole('button', { name: /take barsy's value/i }))
    expect(onRevert).toHaveBeenCalledWith('portion')
  })

  it("lists the resolver's findings at the top, blocking ones first", () => {
    setup(
      sheetData({
        issues: [
          { code: 'V7', severity: 'warning', fieldKey: 'name', locale: 'en_US' },
          { code: 'V6', severity: 'block_node', fieldKey: 'price' },
          { code: 'SOMETHING_NEW', severity: 'warning' },
        ],
      }),
    )
    const items = within(screen.getByTestId('item-sheet-issues')).getAllByRole('listitem')
    expect(items[0]?.textContent).toMatch(/There is no price/)
    expect(items[0]?.getAttribute('data-severity')).toBe('block_node')
    expect(items[1]?.textContent).toBe('Name has no text in English.')
    expect(items[2]?.textContent).toBe('Finding SOMETHING_NEW.')
  })

  it('shows no findings block when there are none', () => {
    setup()
    expect(screen.queryByTestId('item-sheet-issues')).toBeNull()
  })

  it('folds a long list of findings behind "Show more"', async () => {
    setup(
      sheetData({
        issues: ['V3', 'V4', 'V6', 'unplaced_item', 'link_missing', 'price_not_venue_scoped'].map(
          (code) => ({ code, severity: 'warning' as const }),
        ),
      }),
    )
    const block = screen.getByTestId('item-sheet-issues')
    expect(within(block).getAllByRole('listitem')).toHaveLength(4)
    await userEvent.click(within(block).getByRole('button', { name: 'Show 2 more' }))
    expect(within(block).getAllByRole('listitem')).toHaveLength(6)
    await userEvent.click(within(block).getByRole('button', { name: 'Show fewer' }))
    expect(within(block).getAllByRole('listitem')).toHaveLength(4)
  })

  it('edits a field in the editor and hands the saved value up; the editor closes on success', async () => {
    const { onSave } = setup(
      sheetData({
        fields: { abv: { value: 24, provenance: 'owned', layer: 'manual' } },
      }),
    )
    await userEvent.click(within(row('abv')).getByRole('button', { name: /edit abv/i }))
    const input = await screen.findByRole('textbox', { name: 'ABV' })
    await userEvent.clear(input)
    await userEvent.type(input, '30')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('abv', 30))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).toBeNull())
  })

  it('keeps the editor open when the save fails', async () => {
    const onSave = vi.fn(async () => false)
    setup(sheetData({ fields: { abv: { value: 24, provenance: 'owned' } } }), { onSave })
    await userEvent.click(within(row('abv')).getByRole('button', { name: /edit abv/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy()
  })

  it('clearing a value hands up null', async () => {
    const { onSave } = setup(sheetData({ fields: { abv: { value: 24, provenance: 'owned' } } }))
    await userEvent.click(within(row('abv')).getByRole('button', { name: /edit abv/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Clear value' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('abv', null))
  })

  it('does not say the save is local: the editor describes the real save', async () => {
    setup(sheetData({ fields: { abv: { value: 24, provenance: 'owned' } } }))
    await userEvent.click(within(row('abv')).getByRole('button', { name: /edit abv/i }))
    expect(await screen.findByText(/saved to the menu at once/i)).toBeTruthy()
    expect(screen.queryByText(/local for now/i)).toBeNull()
  })

  it("names a mixed-language value's sources one language at a time", () => {
    setup(
      sheetData({
        fields: {
          name: {
            value: { bg_BG: 'Негрони', en_US: 'Negroni' },
            provenance: 'till',
            localeProvenance: { bg_BG: 'till', en_US: 'owned' },
          },
        },
      }),
    )
    const list = within(row('name')).getByTestId('locale-provenance')
    expect(within(list).getByText('From barsy')).toBeTruthy()
    expect(within(list).getByText('Owned here')).toBeTruthy()
  })
})
