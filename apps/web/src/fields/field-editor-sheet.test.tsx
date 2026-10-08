// @vitest-environment jsdom
import { FIELD_TYPES, type FieldDefinition } from '@restro/core'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { FieldEditorSheet } from './field-editor-sheet'
import { EXTRA_TYPE_SAMPLES, itemDefinitions } from './samples'

function definitionOf(key: string): FieldDefinition {
  const found = itemDefinitions().find((definition) => definition.key === key)
  if (!found) throw new Error(`the Item template has no ${key}`)
  return found
}

function open(definition: FieldDefinition, value: unknown) {
  const onSave = vi.fn()
  const onOpenChange = vi.fn()
  renderWithIntl(
    <FieldEditorSheet
      definition={definition}
      value={value}
      open
      onOpenChange={onOpenChange}
      onSave={onSave}
    />,
  )
  return { onSave, onOpenChange }
}

describe('FieldEditorSheet', () => {
  it('saves a money amount typed in major units as integer minor units', async () => {
    const { onSave } = open(definitionOf('price'), { amount_minor: 1250, currency: 'EUR' })
    const input = screen.getByRole('textbox', { name: 'Price' })
    expect((input as HTMLInputElement).value).toBe('12.50')
    await userEvent.clear(input)
    await userEvent.type(input, '13,5')
    expect(screen.getByText('Stored as 1,350 cents.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave).toHaveBeenCalledWith({ amount_minor: 1350, currency: 'EUR' })
  })

  it('saves with Ctrl+Enter, through a key handler on the form (no window listener)', async () => {
    const { onSave } = open(definitionOf('abv'), 24)
    const input = screen.getByRole('textbox', { name: 'ABV' })
    await userEvent.clear(input)
    await userEvent.type(input, '41.5')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(41.5))
  })

  it('does not save from a key press outside the form', async () => {
    const { onSave } = open(definitionOf('abv'), 24)
    // The key arrives at the page, not at the form: nothing listens on the window.
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
    expect(onSave).not.toHaveBeenCalled()
  })

  it('cancels with Escape and with the Cancel button, without saving', async () => {
    const { onSave, onOpenChange } = open(definitionOf('abv'), 24)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledTimes(2)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('refuses a value outside the definition’s constraints (core validation, not a re-implementation)', async () => {
    const { onSave } = open(definitionOf('abv'), 24)
    const input = screen.getByRole('textbox', { name: 'ABV' })
    await userEvent.clear(input)
    await userEvent.type(input, '150')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText('This value is not valid for this field.')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('refuses an amount that is not a price', async () => {
    const { onSave } = open(definitionOf('price'), undefined)
    await userEvent.type(screen.getByRole('textbox', { name: 'Price' }), '12.345')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('does not let a required field be saved empty, and offers no Clear for it', async () => {
    const { onSave } = open(definitionOf('name'), { bg_BG: 'Негрони' })
    expect(screen.queryByRole('button', { name: 'Clear value' })).toBeNull()
    await userEvent.clear(screen.getByRole('textbox'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('This field is required.')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('clears an optional field to "no value"', async () => {
    const { onSave } = open(definitionOf('abv'), 24)
    await userEvent.click(screen.getByRole('button', { name: 'Clear value' }))
    expect(onSave).toHaveBeenCalledWith(undefined)
  })

  it('edits localized text with one tab per enabled language and keeps absent languages absent', async () => {
    const { onSave } = open(definitionOf('name'), { bg_BG: 'Негрони' })
    expect(screen.getByRole('tab', { name: 'BG' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'EN' })).toBeTruthy()
    await userEvent.click(screen.getByRole('tab', { name: 'EN' }))
    await userEvent.type(screen.getByRole('textbox'), 'Negroni')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ bg_BG: 'Негрони', en_US: 'Negroni' }))
  })

  it('toggles allergens as chips, with the EU labels', async () => {
    const { onSave } = open(definitionOf('allergens'), ['milk'])
    const gluten = screen.getByRole('button', { name: 'Gluten' })
    expect(gluten.getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(gluten)
    expect(gluten.getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Milk' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(['gluten']))
  })

  it('adds and removes tags', async () => {
    const { onSave } = open(definitionOf('tags'), ['signature'])
    await userEvent.type(screen.getByPlaceholderText('Type a tag and press Enter'), 'new{Enter}')
    await userEvent.click(screen.getByRole('button', { name: 'Remove tag signature' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(['new']))
  })

  it.each(['date', 'datetime', 'range', 'file', 'reference'])(
    'shows a disabled "Coming in Stage 2" notice for %s and can only be cancelled',
    async (type) => {
      const sample = EXTRA_TYPE_SAMPLES.find((entry) => entry.definition.type === type)
      if (!sample) throw new Error(`no sample for ${type}`)
      // Make sure the sample is what the registry would show.
      expect(FIELD_TYPES[sample.definition.type].validate(sample.value, sample.definition).ok).toBe(
        true,
      )
      const { onSave } = open(sample.definition, sample.value)
      expect(screen.getByTestId('editor-coming-soon')).toBeTruthy()
      expect(screen.getByText('Coming in Stage 2')).toBeTruthy()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      // The value is unchanged, so saving hands back the original value.
      await waitFor(() => expect(onSave).toHaveBeenCalledWith(sample.value))
    },
  )

  it('shows the sheet title in the interface language, with the field label from the definition', () => {
    open(definitionOf('price'), undefined)
    expect(screen.getByRole('heading', { name: 'Edit Price' })).toBeTruthy()
  })
})
