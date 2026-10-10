// @vitest-environment jsdom
// The tags field type (brief S3-06): the chips editor in the field editor sheet (switch tags of the
// venue's list on and off, create one inline) and the display.
import { type FieldDefinition, newId } from '@restro/core'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { renderWithIntl } from '@/test-utils'

import { type EnvironmentTag, FieldEnvironmentProvider, type TagDraft } from '../environment'
import { FieldEditorSheet } from '../field-editor-sheet'
import { FieldValueView } from '../registry'
import { itemDefinitions } from '../samples'

const definition = itemDefinitions().find(
  (candidate) => candidate.key === 'tags',
) as FieldDefinition

const signature: EnvironmentTag = { id: newId('tg'), name: 'Signature', color: 'accent' }
const spicy: EnvironmentTag = { id: newId('tg'), name: 'Spicy', color: 'text' }
const local: EnvironmentTag = { id: newId('tg'), name: 'Local', color: 'muted' }
const tags = [signature, spicy, local]

function openEditor(
  value: unknown,
  environment: {
    tags?: readonly EnvironmentTag[]
    createTag?: (draft: TagDraft) => Promise<EnvironmentTag | null>
  } = { tags },
) {
  const onSave = vi.fn()
  renderWithIntl(
    <FieldEnvironmentProvider {...environment}>
      <FieldEditorSheet
        definition={definition}
        value={value}
        open
        onOpenChange={vi.fn()}
        onSave={onSave}
      />
    </FieldEnvironmentProvider>,
  )
  return { onSave }
}

const toggle = (name: string) => screen.getByRole('button', { name })

describe('the tags editor', () => {
  it('shows the venue’s tags as chips, the item’s ones pressed', () => {
    openEditor([signature.id])
    expect(toggle('Signature').getAttribute('aria-pressed')).toBe('true')
    expect(toggle('Spicy').getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByTestId('tag-toggle').map((button) => button.textContent)).toEqual([
      'Signature',
      'Spicy',
      'Local',
    ])
  })

  it('switches tags on and off and saves their ids', async () => {
    const { onSave } = openEditor([signature.id])
    await userEvent.click(toggle('Spicy'))
    await userEvent.click(toggle('Signature'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([spicy.id]))
  })

  it('saves nothing (a cleared value) when the last tag is switched off', async () => {
    const { onSave } = openEditor([local.id])
    await userEvent.click(toggle('Local'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(undefined))
  })

  it('keeps ids the venue’s list does not show (an archived tag) and says so', async () => {
    const archived = newId('tg')
    const { onSave } = openEditor([archived, signature.id])
    expect(screen.getByTestId('tags-kept').textContent).toBe('1 archived tag stays on this item.')
    await userEvent.click(toggle('Signature'))
    await userEvent.click(toggle('Local'))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith([archived, local.id]))
  })

  it('says there are no tags yet, and offers to create the first one', () => {
    openEditor(undefined, { tags: [], createTag: async () => null })
    expect(screen.getByTestId('tags-editor-empty').textContent).toContain('no tags yet')
    expect(screen.getByTestId('tag-create-inline')).toBeTruthy()
  })

  it('offers no create row where tags cannot be made', () => {
    openEditor(undefined, { tags })
    expect(screen.queryByTestId('tag-create-inline')).toBeNull()
  })

  describe('creating a tag inline', () => {
    it('saves the new tag first, then switches it on; Enter does not save the sheet', async () => {
      const created: EnvironmentTag = {
        id: newId('tg'),
        name: 'Vegan friendly',
        color: 'accent_text',
      }
      const createTag = vi.fn(async (_draft: TagDraft) => created)
      const { onSave } = openEditor([signature.id], { tags, createTag })

      await userEvent.click(screen.getByTestId('tag-create-inline'))
      await userEvent.type(screen.getByTestId('tag-name-bg_BG'), 'Vegan friendly')
      await userEvent.type(screen.getByTestId('tag-name-en_US'), 'Vegan friendly EN')
      await userEvent.click(screen.getByTestId('tag-color-accent_text'))
      await userEvent.keyboard('{Enter}')

      await waitFor(() => expect(createTag).toHaveBeenCalledTimes(1))
      expect(createTag).toHaveBeenCalledWith({
        label: { bg_BG: 'Vegan friendly', en_US: 'Vegan friendly EN' },
        color: 'accent_text',
      })
      // The plain Enter created the tag; it did not save the item's tags.
      expect(onSave).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
      await waitFor(() => expect(onSave).toHaveBeenCalledWith([signature.id, created.id]))
    })

    it('needs a name in the venue’s default language', async () => {
      const createTag = vi.fn(async () => null)
      openEditor(undefined, { tags, createTag })
      await userEvent.click(screen.getByTestId('tag-create-inline'))
      await userEvent.type(screen.getByTestId('tag-name-en_US'), 'Only English')
      await userEvent.click(screen.getByTestId('tag-form-save'))
      expect((await screen.findByRole('alert')).textContent).toBe('Enter a name in Bulgarian.')
      expect(createTag).not.toHaveBeenCalled()
    })

    it('says so when the tag could not be created, and changes nothing', async () => {
      const createTag = vi.fn(async () => null)
      const { onSave } = openEditor([local.id], { tags, createTag })
      await userEvent.click(screen.getByTestId('tag-create-inline'))
      await userEvent.type(screen.getByTestId('tag-name-bg_BG'), 'Нов')
      await userEvent.click(screen.getByTestId('tag-form-save'))
      expect((await screen.findByRole('alert')).textContent).toBe(
        'The tag could not be created. Try again.',
      )
      expect(toggle('Local').getAttribute('aria-pressed')).toBe('true')
      expect(onSave).not.toHaveBeenCalled()
    })
  })
})

describe('the tags display', () => {
  it('shows the names of the venue’s tags the value holds, in the list’s order', () => {
    renderWithIntl(
      <FieldEnvironmentProvider tags={tags}>
        <FieldValueView definition={definition} value={[local.id, signature.id, newId('tg')]} />
      </FieldEnvironmentProvider>,
    )
    const list = screen.getByTestId('tags-value')
    expect(
      within(list)
        .getAllByTestId('tag-chip')
        .map((chip) => chip.textContent),
    ).toEqual(['Signature', 'Local'])
  })

  it('shows "None" when the value holds none of the venue’s tags', () => {
    renderWithIntl(
      <FieldEnvironmentProvider tags={tags}>
        <FieldValueView definition={definition} value={[newId('tg')]} />
      </FieldEnvironmentProvider>,
    )
    expect(screen.getByText('None')).toBeTruthy()
  })

  it('shows the stored text as it is where there is no list to look in', () => {
    renderWithIntl(<FieldValueView definition={definition} value={['signature']} />)
    expect(screen.getByText('signature')).toBeTruthy()
  })
})
