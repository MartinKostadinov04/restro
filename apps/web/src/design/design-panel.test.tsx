// @vitest-environment jsdom
// The Design tab on a screen (brief SH-05a): the template gallery and its look options, where a
// look starts, the three colours and the roles derived from them, the unreadable-override guard,
// "Reset to derived", the live phone preview of the unsaved look, saving a WHOLE look, and the
// read-only view. The server actions, the toast and the upload are the only fakes.
import { suggestHarmony, THEME_PRESETS } from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as upload from '@/composer/item-sheet-upload'
import type { DesignView } from '@/server/design/service'
import { renderWithIntl } from '@/test-utils'

import { DesignPanel } from './design-panel'

const actions = vi.hoisted(() => ({
  saveLookAction: vi.fn(),
  chooseTemplateAction: vi.fn(),
  previewDraftAction: vi.fn(),
}))
vi.mock('@/server/design/actions', () => ({
  saveLookAction: actions.saveLookAction,
  chooseTemplateAction: actions.chooseTemplateAction,
}))
vi.mock('@/server/publish/actions', () => ({ previewDraftAction: actions.previewDraftAction }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/composer/item-sheet-upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composer/item-sheet-upload')>()),
  uploadImage: vi.fn(),
}))

const VENUE = 'vn_0123456789ABCDEFGHIJKL'
const OVERLAY = { version: 1, items: {} }

const NONE: DesignView = {
  theme: null,
  presentation: { face: 'editorial-market', options: {} },
  logo: null,
  canEdit: true,
}

function setup(initial: Partial<DesignView> = {}) {
  return renderWithIntl(<DesignPanel venueId={VENUE} initial={{ ...NONE, ...initial }} />, {
    locale: 'en',
  })
}

const save = () => screen.getByRole('button', { name: 'Save look' }) as HTMLButtonElement
const hex = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const row = (mode: 'light' | 'dark', role: string) => screen.getByTestId(`role-${mode}-${role}`)

/** The template's root in the phone frame, once its code has loaded. */
const previewRoot = () =>
  waitFor(() => {
    const root = screen
      .getByTestId('phone-frame')
      .querySelector('[data-face="editorial-market"]:not([data-testid])')
    expect(root, 'the template is in the phone frame').toBeTruthy()
    return root as HTMLElement
  })

beforeEach(() => {
  actions.saveLookAction.mockReset().mockResolvedValue({ ok: true })
  actions.chooseTemplateAction.mockReset().mockImplementation(async (input) => ({
    ok: true,
    presentation: { face: input.face, options: input.lookOptions },
  }))
  actions.previewDraftAction.mockReset().mockResolvedValue({
    ok: true,
    snapshot: fixture('with-images').snapshot,
    overlay: OVERLAY,
  })
  vi.mocked(toast.success).mockReset()
  vi.mocked(upload.uploadImage).mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:logo-preview')
  URL.revokeObjectURL = vi.fn()
})

describe('the template gallery', () => {
  it('shows the template in use as a card, with its name, description and picture', () => {
    setup()
    const card = screen.getByTestId('template-editorial-market')
    expect(within(card).getByText('Editorial Market')).toBeTruthy()
    expect(within(card).getByText(/photo-led, editorial menu/)).toBeTruthy()
    expect(within(card).getByTestId('template-in-use')).toBeTruthy()
    expect(within(card).getByRole('img').getAttribute('src')).toBe('/faces/editorial-market.png')
    // The hidden reference template is never offered.
    expect(screen.queryByTestId('template-qr-phone')).toBeNull()
    expect(
      (within(card).getByRole('button', { name: 'In use' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('names the templates in Bulgarian for a Bulgarian interface', () => {
    renderWithIntl(<DesignPanel venueId={VENUE} initial={NONE} />, { locale: 'bg' })
    const card = screen.getByTestId('template-editorial-market')
    expect(within(card).getByText('Редакционен пазар')).toBeTruthy()
    expect(
      within(card).getByText('Използва се', { selector: '[data-testid="template-in-use"]' }),
    ).toBeTruthy()
  })

  it('says so when the venue still uses the hidden reference template', () => {
    setup({ presentation: { face: 'qr-phone', options: {} } })
    expect(screen.getByTestId('design-hidden-template')).toBeTruthy()
    // Its card is not "in use", and the visible template can be chosen to switch.
    expect(screen.queryByTestId('template-in-use')).toBeNull()
    expect(screen.getByRole('button', { name: 'Use this template: Editorial Market' })).toBeTruthy()
  })
})

describe('the template’s look options', () => {
  it('are drawn from the manifest: an enum as a segmented control, a boolean as a switch', () => {
    setup()
    const options = screen.getByTestId('design-look-options')
    const layout = within(options).getByRole('group', { name: 'Menu layout' })
    expect(
      within(layout)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['List', 'One column', 'Two columns'])
    expect(
      within(layout).getByRole('button', { name: 'Two columns' }).getAttribute('aria-pressed'),
    ).toBe('true')
    const strip = within(options).getByRole('switch', { name: 'Photo strip for the first section' })
    expect(strip.getAttribute('aria-checked')).toBe('true')
    // The guest-feature option belongs to the composer’s panel, not here.
    expect(within(options).queryByText('Guests can change the layout')).toBeNull()
  })

  it('take the saved values, and the manifest’s labels in Bulgarian', () => {
    renderWithIntl(
      <DesignPanel
        venueId={VENUE}
        initial={{
          ...NONE,
          presentation: {
            face: 'editorial-market',
            options: { layout: 'list', featureFirstSection: false },
          },
        }}
      />,
      { locale: 'bg' },
    )
    const options = screen.getByTestId('design-look-options')
    const layout = within(options).getByRole('group', { name: 'Подредба на менюто' })
    expect(
      within(layout).getByRole('button', { name: 'Списък' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(
      within(options)
        .getByRole('switch', { name: 'Първата секция като лента със снимки' })
        .getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('save as soon as they are changed, with the same toast', async () => {
    setup()
    const options = screen.getByTestId('design-look-options')
    await userEvent.click(within(options).getByRole('button', { name: 'One column' }))
    await waitFor(() =>
      expect(actions.chooseTemplateAction).toHaveBeenCalledWith({
        venueId: VENUE,
        face: 'editorial-market',
        lookOptions: { layout: 'one', featureFirstSection: true },
      }),
    )
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toBe(
      'Saved. Guests see it after the next publish.',
    )

    // The controls rest while a change is on its way to the server, then take the next one.
    const strip = within(options).getByRole('switch', { name: 'Photo strip for the first section' })
    await waitFor(() => expect((strip as HTMLButtonElement).disabled).toBe(false))
    await userEvent.click(strip)
    await waitFor(() =>
      expect(actions.chooseTemplateAction).toHaveBeenLastCalledWith({
        venueId: VENUE,
        face: 'editorial-market',
        lookOptions: { layout: 'one', featureFirstSection: false },
      }),
    )
  })

  it('go back to what they were, and say so, when the server refuses', async () => {
    actions.chooseTemplateAction.mockResolvedValue({ ok: false, error: 'failed' })
    setup()
    const options = screen.getByTestId('design-look-options')
    await userEvent.click(within(options).getByRole('button', { name: 'List' }))
    expect((await screen.findByTestId('design-template-error')).textContent).toBe(
      'Something went wrong. Try again.',
    )
    expect(
      within(options).getByRole('button', { name: 'Two columns' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('where the colours start', () => {
  it('fills the three colours and all 16 roles when a preset is chosen', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Midnight' }))
    const midnight = THEME_PRESETS.find((preset) => preset.id === 'midnight')
    expect(midnight).toBeTruthy()
    expect(hex('Primary').value).toBe(midnight?.colours.primary)
    expect(hex('Secondary').value).toBe(midnight?.colours.secondary)
    expect(hex('Tertiary').value).toBe(midnight?.colours.tertiary)
    // The designer's own roles, for both screens, marked as coming from the preset.
    expect(within(row('light', 'background')).getByText('#f5f1ea')).toBeTruthy()
    expect(within(row('light', 'accent_text')).getByText('#8a5a12')).toBeTruthy()
    expect(within(row('dark', 'background')).getByText('#0e0d0c')).toBeTruthy()
    expect(within(row('dark', 'border')).getByText('#2e2a26')).toBeTruthy()
    expect(screen.getAllByText('From the preset')).toHaveLength(16)
    expect(screen.getByRole('button', { name: 'Midnight' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(save().disabled).toBe(false)
  })

  it('shows every preset by its name in the interface language', () => {
    renderWithIntl(<DesignPanel venueId={VENUE} initial={NONE} />, { locale: 'bg' })
    for (const name of ['Ботаника', 'Полунощ', 'Скандинавски', 'Теракота']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('offers one brand colour as the first version did, and Custom for the venue’s own three', async () => {
    setup({ theme: { brand: '#2563eb', logo_asset_id: null } })
    expect(
      screen.getByRole('button', { name: 'From my brand colour' }).getAttribute('aria-pressed'),
    ).toBe('true')
    expect(hex('Brand colour').value).toBe('#2563eb')
    expect(screen.queryByTestId('design-three-colours')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Custom' }))
    expect(screen.getByTestId('design-three-colours')).toBeTruthy()
    expect(hex('Tertiary').value).toBe(suggestHarmony('#2563eb', 'monochrome').tertiary)
  })
})

describe('"Suggest with colour theory"', () => {
  it('fills the primary and the secondary from the tertiary and leaves the tertiary alone', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Midnight' }))
    await userEvent.click(screen.getByRole('button', { name: 'Suggest with colour theory' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Triadic/ }))
    const wanted = suggestHarmony('#e0a43a', 'triadic')
    expect(hex('Primary').value).toBe(wanted.primary)
    expect(hex('Secondary').value).toBe(wanted.secondary)
    expect(hex('Tertiary').value).toBe('#e0a43a')
    // The look is custom now, and the preset’s pinned roles are released: the new page colour shows.
    expect(screen.getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed')).toBe('true')
    expect(within(row('light', 'background')).getByText(wanted.primary)).toBeTruthy()
  })

  it('offers the five rules', async () => {
    setup({
      theme: {
        logo_asset_id: null,
        preset: null,
        colors: { primary: '#f4efe6', secondary: '#e8dfcf', tertiary: '#d9f26b' },
      },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Suggest with colour theory' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.getAttribute('data-rule'))).toEqual([
      'complementary',
      'analogous',
      'triadic',
      'split_complementary',
      'monochrome',
    ])
  })
})

describe('the derived colours', () => {
  it('show eight roles for a light and for a dark screen with the contrast of their pairs', () => {
    setup()
    const roles = screen.getByTestId('design-roles')
    for (const mode of ['light', 'dark'] as const) {
      expect(roles.querySelectorAll(`[data-testid^="role-${mode}-"]`)).toHaveLength(8)
    }
    // Text sits on the page and on the panels: two pairs, each with a ratio of at least 4.5.
    const pairs = within(row('light', 'text')).getAllByText(/:1$/)
    expect(pairs).toHaveLength(2)
    for (const pair of pairs) {
      expect(
        Number.parseFloat(pair.textContent?.match(/(\d+\.\d):1/)?.[1] ?? '0'),
      ).toBeGreaterThanOrEqual(4.5)
    }
    expect(within(row('light', 'border')).getByText('No reading requirement.')).toBeTruthy()
    // Plain words, not role names.
    expect(within(row('dark', 'on_accent')).getByText('Text on highlights')).toBeTruthy()
  })

  it('blocks Save, in red, and names the pair when a colour set by hand does not read', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Botanical' }))
    expect(save().disabled).toBe(false)
    const text = row('light', 'text')
    await userEvent.click(within(text).getByRole('button', { name: 'Adjust Text, Light screen' }))
    const box = within(text).getByRole('textbox')
    await userEvent.clear(box)
    await userEvent.type(box, '#f4efe6')

    expect(save().disabled).toBe(true)
    expect(text.getAttribute('data-failing')).toBe('true')
    const failing = within(text).getAllByText(/needs 4\.5:1/)
    expect(failing.length).toBeGreaterThan(0)
    const alert = screen.getByTestId('design-unreadable')
    expect(
      within(alert).getByText(/Light screen: Text on Page reads at 1\.0:1, needs 4\.5:1\./),
    ).toBeTruthy()
    expect(within(alert).getByText(/Light screen: Text on Panels/)).toBeTruthy()
    expect(screen.getByTestId('design-status').textContent).toContain('hard to read')
  })

  it('"Reset to derived" takes the colour off and lets Save through again', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Botanical' }))
    const text = row('light', 'text')
    await userEvent.click(within(text).getByRole('button', { name: 'Adjust Text, Light screen' }))
    const box = within(text).getByRole('textbox')
    await userEvent.clear(box)
    await userEvent.type(box, '#f4efe6')
    expect(save().disabled).toBe(true)

    await userEvent.click(
      within(text).getByRole('button', { name: 'Reset Text, Light screen, to the derived colour' }),
    )
    expect(screen.queryByTestId('design-unreadable')).toBeNull()
    expect(text.getAttribute('data-failing')).toBeNull()
    expect(within(text).queryByTestId('role-adjusted')).toBeNull()
    expect(save().disabled).toBe(false)
  })

  it('mark a colour that is not complete and hold Save back', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Custom' }))
    const primary = hex('Primary')
    await userEvent.clear(primary)
    await userEvent.type(primary, '#12')
    expect(primary.getAttribute('aria-invalid')).toBe('true')
    expect(
      within(screen.getByTestId('design-three-colours')).getAllByRole('alert')[0]?.textContent,
    ).toBe('Enter a colour like #3366cc.')
    expect(save().disabled).toBe(true)
    // The preview and the derived colours keep the last whole look meanwhile.
    expect(screen.getByTestId('design-roles')).toBeTruthy()
  })

  it('changing a colour of a preset releases its roles, so the new colour shows at once', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Midnight' }))
    const tertiary = hex('Tertiary')
    await userEvent.clear(tertiary)
    await userEvent.type(tertiary, '#2563eb')
    expect(within(row('light', 'accent')).getByText('#2563eb')).toBeTruthy()
    expect(screen.queryAllByText('From the preset')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('the live preview', () => {
  it('draws the chosen template in a phone frame from the draft, once', async () => {
    setup()
    const root = await previewRoot()
    expect(root.dataset.layout).toBe('two')
    expect(actions.previewDraftAction).toHaveBeenCalledTimes(1)
    expect(actions.previewDraftAction).toHaveBeenCalledWith(VENUE)
  })

  it('applies the unsaved colours at once', async () => {
    setup()
    await previewRoot()
    await userEvent.click(screen.getByRole('button', { name: 'Midnight' }))
    await waitFor(async () =>
      expect((await previewRoot()).style.getPropertyValue('--rm-l-background')).toBe('#f5f1ea'),
    )
    expect((await previewRoot()).style.getPropertyValue('--rm-d-background')).toBe('#0e0d0c')
    expect((await previewRoot()).style.getPropertyValue('--rm-radius')).toBe('6px')
  })

  it('applies the font and the corners the form holds', async () => {
    setup()
    await previewRoot()
    await userEvent.click(screen.getByRole('button', { name: /^Lora/ }))
    fireEvent.change(screen.getByLabelText('Corners'), { target: { value: '20' } })
    expect(screen.getByTestId('design-radius-value').textContent).toBe('20 px')
    await waitFor(async () => {
      const root = await previewRoot()
      expect(root.style.getPropertyValue('--rm-radius')).toBe('20px')
      expect(root.style.getPropertyValue('--rm-font')).toContain('"Lora"')
    })
    fireEvent.change(screen.getByLabelText('Shadow'), { target: { value: '4' } })
    await waitFor(async () =>
      expect((await previewRoot()).style.getPropertyValue('--rm-shadow')).toBe('4'),
    )
  })

  it('applies a look option of the template, and the light/dark switch', async () => {
    setup()
    await previewRoot()
    await userEvent.click(
      within(screen.getByTestId('design-look-options')).getByRole('button', { name: 'List' }),
    )
    await waitFor(async () => expect((await previewRoot()).dataset.layout).toBe('list'))
    await userEvent.click(
      within(screen.getByTestId('design-preview')).getByRole('button', { name: 'Dark' }),
    )
    await waitFor(async () => expect((await previewRoot()).dataset.scheme).toBe('dark'))
  })

  it('follows a light/dark policy that is not "follow the phone"', async () => {
    setup()
    await previewRoot()
    await userEvent.click(screen.getByRole('button', { name: 'Always dark' }))
    await waitFor(async () => expect((await previewRoot()).dataset.scheme).toBe('dark'))
    await userEvent.click(screen.getByRole('button', { name: 'Always light' }))
    await waitFor(async () => expect((await previewRoot()).dataset.scheme).toBe('light'))
  })

  it('gives the publish preview’s message when there is nothing to show, and tries again on request', async () => {
    actions.previewDraftAction.mockResolvedValueOnce({ ok: false, error: 'nothing_visible' })
    setup()
    expect((await screen.findByTestId('design-preview-error')).textContent).toBe(
      'Nothing visible to publish, so there is nothing to preview.',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await previewRoot()
    expect(actions.previewDraftAction).toHaveBeenCalledTimes(2)
  })
})

describe('saving the look', () => {
  it('starts with nothing to save', () => {
    setup()
    expect(save().disabled).toBe(true)
    expect(screen.getByTestId('design-status').textContent).toBe('Nothing to save.')
  })

  it('saves the whole look: colours, overrides, font, corners, shadow, policy and logo', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Midnight' }))
    await userEvent.click(screen.getByRole('button', { name: /^Manrope/ }))
    fireEvent.change(screen.getByLabelText('Shadow'), { target: { value: '3' } })
    await userEvent.click(screen.getByRole('button', { name: 'Always dark' }))
    await userEvent.click(save())
    await waitFor(() => expect(actions.saveLookAction).toHaveBeenCalledTimes(1))
    const input = actions.saveLookAction.mock.calls[0]?.[0]
    expect(input.venueId).toBe(VENUE)
    expect(input.theme).toMatchObject({
      logo_asset_id: null,
      preset: 'midnight',
      colors: { primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#e0a43a' },
      font: 'manrope',
      radius: 6,
      shadow: 3,
      scheme: 'dark',
    })
    // The designer's 16 roles are saved as overrides, so the saved look is exactly the preset.
    expect(Object.keys(input.theme.overrides.light)).toHaveLength(8)
    expect(Object.keys(input.theme.overrides.dark)).toHaveLength(8)
    // The brand colour of the first version is not saved beside the three colours.
    expect(input.theme).not.toHaveProperty('brand')

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toBe(
      'Saved. Guests see it after the next publish.',
    )
    // Saved: the button is off again and the status points at the Publishing tab.
    await waitFor(() => expect(save().disabled).toBe(true))
    const status = screen.getByTestId('design-status')
    expect(status.textContent).toContain('Saved. Guests see it after the next publish.')
    expect(
      within(status).getByRole('link', { name: 'Go to Publishing' }).getAttribute('href'),
    ).toBe(`/venues/${VENUE}?tab=publishing`)
  })

  it('never saves part of a look: a venue on one brand colour saves every v2 field too', async () => {
    setup({ theme: { brand: '#2563eb', logo_asset_id: null } })
    await userEvent.click(screen.getByRole('button', { name: '#e11d48' }))
    await userEvent.click(save())
    await waitFor(() => expect(actions.saveLookAction).toHaveBeenCalledTimes(1))
    expect(actions.saveLookAction.mock.calls[0]?.[0]).toEqual({
      venueId: VENUE,
      theme: {
        logo_asset_id: null,
        brand: '#e11d48',
        font: 'inter',
        radius: 8,
        shadow: 1,
        scheme: 'auto',
      },
    })
  })

  it('keeps what a saved look had when only one thing changes', async () => {
    const theme = {
      logo_asset_id: null,
      preset: null,
      colors: { primary: '#f4efe6', secondary: '#e8dfcf', tertiary: '#d9f26b' },
      overrides: { dark: { border: '#334455' } },
      font: 'lora' as const,
      radius: 12,
      shadow: 2,
      scheme: 'light' as const,
    }
    setup({ theme })
    await userEvent.click(screen.getByRole('button', { name: 'Always dark' }))
    await userEvent.click(save())
    await waitFor(() => expect(actions.saveLookAction).toHaveBeenCalledTimes(1))
    expect(actions.saveLookAction.mock.calls[0]?.[0]).toEqual({
      venueId: VENUE,
      theme: { ...theme, scheme: 'dark' },
    })
  })

  it('shows what the server refused, naming the pairs that do not read', async () => {
    actions.saveLookAction.mockResolvedValue({
      ok: false,
      error: 'unreadable',
      issues: [{ mode: 'dark', fg: 'muted', bg: 'surface', ratio: 3.21, min: 4.5 }],
    })
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Nordic' }))
    await userEvent.click(save())
    const error = await screen.findByTestId('design-error')
    expect(error.textContent).toContain('The look was not saved: some text would be hard to read.')
    expect(error.textContent).toContain(
      'Dark screen: Secondary text on Panels reads at 3.2:1, needs 4.5:1.',
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('shows an unusable logo as the old card did', async () => {
    actions.saveLookAction.mockResolvedValue({ ok: false, error: 'logo_not_usable' })
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Nordic' }))
    await userEvent.click(save())
    expect((await screen.findByTestId('design-error')).textContent).toBe(
      'That logo could not be used. Upload it again.',
    )
  })
})

describe('the logo', () => {
  it('goes up with the same checks as the item photos and is saved with the look', async () => {
    vi.mocked(upload.uploadImage).mockResolvedValue({
      ok: true,
      assetId: 'as_0123456789ABCDEFGHIJKL',
    })
    setup({ theme: { brand: '#2563eb', logo_asset_id: null } })
    const file = new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('design-logo-input'), { target: { files: [file] } })
    expect(await screen.findByTestId('design-logo-image')).toBeTruthy()
    expect(screen.getByText('The new logo shows in the preview after you save.')).toBeTruthy()
    await userEvent.click(save())
    await waitFor(() => expect(actions.saveLookAction).toHaveBeenCalledTimes(1))
    expect(actions.saveLookAction.mock.calls[0]?.[0].theme).toMatchObject({
      brand: '#2563eb',
      logo_asset_id: 'as_0123456789ABCDEFGHIJKL',
    })
  })

  it('refuses a file that is not an image before sending it', async () => {
    setup()
    const file = new File(['x'], 'logo.txt', { type: 'text/plain' })
    fireEvent.change(screen.getByTestId('design-logo-input'), { target: { files: [file] } })
    expect((await screen.findByTestId('design-logo-error')).textContent).toContain(
      'JPEG, PNG and WebP',
    )
    expect(upload.uploadImage).not.toHaveBeenCalled()
  })

  it('can be removed, and a saved one shows from its link', async () => {
    setup({
      theme: { brand: '#2563eb', logo_asset_id: 'as_0123456789ABCDEFGHIJKL' },
      logo: {
        assetId: 'as_0123456789ABCDEFGHIJKL',
        url: '/api/assets/file/x',
        width: 10,
        height: 10,
      },
    })
    expect(screen.getByTestId('design-logo-image').getAttribute('src')).toBe('/api/assets/file/x')
    await userEvent.click(screen.getByRole('button', { name: 'Remove logo' }))
    expect(screen.queryByTestId('design-logo-image')).toBeNull()
    await userEvent.click(save())
    await waitFor(() => expect(actions.saveLookAction).toHaveBeenCalledTimes(1))
    expect(actions.saveLookAction.mock.calls[0]?.[0].theme.logo_asset_id).toBeNull()
  })
})

describe('someone who may not change the design', () => {
  it('sees the saved look and the preview, and can change nothing', async () => {
    setup({
      canEdit: false,
      theme: {
        logo_asset_id: null,
        preset: 'midnight',
        colors: { primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#e0a43a' },
        font: 'lora',
        radius: 6,
        shadow: 1,
        scheme: 'auto',
      },
    })
    expect(screen.getByTestId('design-read-only').textContent).toContain(
      'Only owners and admins can change the design.',
    )
    expect(screen.queryByRole('button', { name: 'Save look' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Use this template/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Suggest with colour theory' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Adjust/ })).toBeNull()
    expect(hex('Primary').disabled).toBe(true)
    expect(hex('Primary').value).toBe('#f5f1ea')
    expect((screen.getByLabelText('Corners') as HTMLInputElement).disabled).toBe(true)
    expect(
      (
        screen.getByRole('switch', {
          name: 'Photo strip for the first section',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    expect((screen.getByRole('button', { name: 'Midnight' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    // The preview is a read, open to anyone in the organisation.
    await previewRoot()
  })
})
