// @vitest-environment jsdom
import { VENUE_MENU_TEMPLATE } from '@restro/core'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { TranslationRow } from '@/server/item-sheet/types'
import { renderWithIntl } from '@/test-utils'
import { sheetData } from './item-sheet-test-data'
import { ItemSheetTranslationsTab } from './item-sheet-translations-tab'

const definition = (key: string) => {
  const found = VENUE_MENU_TEMPLATE.nodeTypes.item?.fields.find((field) => field.key === key)
  if (!found) throw new Error(`no field ${key}`)
  return found
}

const nameRow: TranslationRow = {
  fieldKey: 'name',
  definition: definition('name'),
  cells: {
    bg_BG: {
      text: 'Негрони',
      provenance: 'till',
      ourText: null,
      editable: false,
      missing: false,
      review: false,
    },
    en_US: {
      text: null,
      provenance: 'none',
      ourText: null,
      editable: true,
      missing: true,
      review: false,
    },
  },
}

const descriptionRow: TranslationRow = {
  fieldKey: 'description',
  definition: definition('description'),
  cells: {
    bg_BG: {
      text: 'Горчив',
      provenance: 'owned',
      ourText: 'Горчив',
      editable: true,
      missing: false,
      review: false,
    },
    en_US: {
      text: 'Bitter',
      provenance: 'owned',
      ourText: 'Bitter',
      editable: true,
      missing: false,
      review: true,
    },
  },
}

function setup(rows: TranslationRow[] = [nameRow, descriptionRow], locale: 'en' | 'bg' = 'en') {
  const onSave = vi.fn(async () => true)
  renderWithIntl(
    <ItemSheetTranslationsTab
      data={sheetData({ translations: rows })}
      busy={false}
      onSave={onSave}
    />,
    { locale },
  )
  return { onSave }
}

const cell = (field: string, locale: string) => {
  const found = document.querySelector<HTMLElement>(
    `[data-testid="translation-cell"][data-field="${field}"][data-locale="${locale}"]`,
  )
  if (!found) throw new Error(`no cell ${field} ${locale}`)
  return found
}

describe('the Translations tab', () => {
  it("lays out each localized field across the venue's languages", () => {
    setup()
    const rows = screen.getAllByTestId('translation-row')
    expect(rows.map((el) => el.getAttribute('data-field'))).toEqual(['name', 'description'])
    expect(within(rows[0] as HTMLElement).getAllByTestId('translation-cell')).toHaveLength(2)
    expect(within(cell('name', 'bg_BG')).getByText('Bulgarian')).toBeTruthy()
    expect(within(cell('name', 'en_US')).getByText('English')).toBeTruthy()
  })

  it('shows a language barsy holds read-only: text, badge, a note, no input', () => {
    setup()
    const bg = cell('name', 'bg_BG')
    expect(bg.getAttribute('data-editable')).toBe('false')
    expect(within(bg).getByText('Негрони')).toBeTruthy()
    expect(within(bg).getByText('From barsy')).toBeTruthy()
    expect(within(bg).getByText('Held by barsy')).toBeTruthy()
    expect(within(bg).queryByRole('textbox')).toBeNull()
    expect(within(bg).queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('highlights a language with no text', () => {
    setup()
    const en = cell('name', 'en_US')
    expect(en.getAttribute('data-missing')).toBe('true')
    expect(within(en).getByText('Missing')).toBeTruthy()
    expect(cell('description', 'bg_BG').getAttribute('data-missing')).toBe('false')
  })

  it('flags a translation to review (D24) and says it stays live', () => {
    setup()
    const en = cell('description', 'en_US')
    expect(within(en).getByText('Review')).toBeTruthy()
    expect(within(en).getByText(/stays live/)).toBeTruthy()
  })

  it('saves an added language per language: Save, or Ctrl+Enter', async () => {
    const { onSave } = setup()
    const en = cell('name', 'en_US')
    const save = within(en).getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    const box = within(en).getByRole('textbox')
    await userEvent.type(box, 'Negroni')
    expect(save.disabled).toBe(false)
    await userEvent.click(save)
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('name', 'en_US', 'Negroni'))

    await userEvent.type(box, ' Classic{Control>}{Enter}{/Control}')
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith('name', 'en_US', 'Negroni Classic'))
  })

  it('removes a language by saving it empty', async () => {
    const { onSave } = setup()
    const bg = cell('description', 'bg_BG')
    await userEvent.clear(within(bg).getByRole('textbox'))
    await userEvent.click(within(bg).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('description', 'bg_BG', null))
  })

  it('names the languages in the interface language', () => {
    setup([nameRow], 'bg')
    expect(within(cell('name', 'bg_BG')).getByText('български')).toBeTruthy()
    expect(within(cell('name', 'en_US')).getByText('английски')).toBeTruthy()
    expect(within(cell('name', 'en_US')).getByText('Липсва')).toBeTruthy()
  })

  it('leaves each cell its own draft', async () => {
    setup()
    const nameBox = within(cell('name', 'en_US')).getByRole('textbox')
    const descriptionBox = within(cell('description', 'en_US')).getByRole('textbox')
    await userEvent.type(nameBox, 'Draft')
    expect((descriptionBox as HTMLTextAreaElement).value).toBe('Bitter')
    expect((nameBox as HTMLTextAreaElement).value).toBe('Draft')
  })
})
