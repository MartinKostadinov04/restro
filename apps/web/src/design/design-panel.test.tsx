// @vitest-environment jsdom
// The Design tab on a screen (briefs SH-05a and S7; D92, D93): the collapsed template chooser and
// its phone pop-up, the cards in Martin's order (logo and header name, guest features, font and
// screen, colours), the font dropdown, a brand-first colour card (the brand colour fills the page
// and the panels, a warning for a strongly saturated page, Advanced with the computed colours and
// a pair that does not read), the sticky live preview of the open menu, saving a WHOLE look, and
// the read-only view. The server actions, the toast and the upload are the only fakes.
import {
  DEFAULT_DESIGN,
  DEFAULT_GUEST_FEATURES,
  designThemeOf,
  suggestHarmony,
  THEME_PRESETS,
} from '@restro/core'
import { fixture } from '@restro/shell/testing'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as upload from '@/composer/item-sheet-upload'
import type { DesignView } from '@/server/design/service'
import { renderWithIntl } from '@/test-utils'

import { DesignPanel } from './design-panel'
import { tintsOf } from './look-state'

const actions = vi.hoisted(() => ({
  saveLookAction: vi.fn(),
  previewDraftAction: vi.fn(),
  renameMenuAction: vi.fn(),
}))
vi.mock('@/server/design/actions', () => ({
  saveLookAction: actions.saveLookAction,
}))
vi.mock('@/server/publish/actions', () => ({ previewDraftAction: actions.previewDraftAction }))
vi.mock('@/server/menus-actions', () => ({ renameMenuAction: actions.renameMenuAction }))
vi.mock('@/server/composer/guest-features-actions', () => ({
  saveGuestFeaturesAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/composer/item-sheet-upload', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/composer/item-sheet-upload')>()),
  uploadImage: vi.fn(),
}))

const VENUE = 'vn_0123456789ABCDEFGHIJKL'
const MENU = 'nd_0123456789ABCDEFGHIJKL'
const VENUE_NAME = 'Demo Club'
const OVERLAY = { version: 1, items: {} }

const NONE: DesignView = {
  revision: 0,
  theme: designThemeOf(DEFAULT_DESIGN),
  logo: null,
  canEdit: true,
}

function setup(
  initial: Partial<DesignView> = {},
  extra: { menu?: { id: string; name: string | null } | null } = {},
) {
  return renderWithIntl(
    <DesignPanel
      venueId={VENUE}
      initial={{ ...NONE, ...initial }}
      menu={extra.menu === undefined ? { id: MENU, name: null } : extra.menu}
      venueName={VENUE_NAME}
      features={DEFAULT_GUEST_FEATURES}
    />,
    { locale: 'en' },
  )
}

const save = () => screen.getByRole('button', { name: 'Save look' }) as HTMLButtonElement
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const row = (mode: 'light' | 'dark', role: string) => screen.getByTestId(`role-${mode}-${role}`)
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } })
const openAdvanced = () => userEvent.click(screen.getByRole('button', { name: 'Advanced' }))
const openChooser = () => userEvent.click(screen.getByRole('button', { name: 'Change' }))

/** The template's root in the live preview's phone frame, once its code has loaded. */
const previewRoot = () =>
  waitFor(() => {
    const root = within(screen.getByTestId('design-preview'))
      .getByTestId('phone-frame')
      .querySelector('[data-face="editorial-market"]:not([data-testid])')
    expect(root, 'the template is in the phone frame').toBeTruthy()
    return root as HTMLElement
  })

beforeEach(() => {
  actions.saveLookAction.mockReset().mockResolvedValue({ ok: true, revision: 1 })
  actions.previewDraftAction.mockReset().mockResolvedValue({
    ok: true,
    snapshot: fixture('with-images').snapshot,
    overlay: OVERLAY,
  })
  actions.renameMenuAction.mockReset().mockImplementation(async (input) => ({
    ok: true,
    menu: { id: input.menuId, name: input.name === '' ? null : input.name, live: true },
  }))
  vi.mocked(toast.success).mockReset()
  vi.mocked(upload.uploadImage).mockReset()
  URL.createObjectURL = vi.fn(() => 'blob:logo-preview')
  URL.revokeObjectURL = vi.fn()
})

describe('the template chooser', () => {
  it('is one line until it is opened: "Template: <name>" and "Change"', async () => {
    setup()
    expect(screen.getByTestId('design-template-current').textContent).toBe(
      'Template: Editorial Market',
    )
    const change = screen.getByRole('button', { name: 'Change' })
    expect(change.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('template-editorial-market')).toBeNull()
    expect(screen.queryByTestId('design-gallery')).toBeNull()

    await userEvent.click(change)
    const card = screen.getByTestId('template-editorial-market')
    expect(within(card).getByText('Editorial Market')).toBeTruthy()
    expect(within(card).getByText(/photo-led, editorial menu/)).toBeTruthy()
    expect(within(card).getByTestId('template-in-use')).toBeTruthy()
    expect(within(card).getByRole('img').getAttribute('src')).toBe('/faces/editorial-market.png')
    // The hidden reference template is never offered.
    expect(screen.queryByTestId('template-qr-phone')).toBeNull()
    expect(screen.getByRole('button', { name: 'Close' }).getAttribute('aria-expanded')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('template-editorial-market')).toBeNull()
  })

  it('names the templates in Bulgarian for a Bulgarian interface', async () => {
    renderWithIntl(
      <DesignPanel
        venueId={VENUE}
        initial={NONE}
        menu={{ id: MENU, name: null }}
        venueName={VENUE_NAME}
        features={DEFAULT_GUEST_FEATURES}
      />,
      { locale: 'bg' },
    )
    expect(screen.getByTestId('design-template-current').textContent).toBe(
      'Шаблон: Редакционен пазар',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Смени' }))
    const card = screen.getByTestId('template-editorial-market')
    expect(within(card).getByText('Редакционен пазар', { selector: 'h4' })).toBeTruthy()
    expect(
      within(card).getByText('Използва се', { selector: '[data-testid="template-in-use"]' }),
    ).toBeTruthy()
  })

  it('draws no look options for the Editorial Market: its layout is the menu’s setting (D92)', () => {
    setup()
    expect(screen.queryByTestId('design-look-options')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Menu layout' })).toBeNull()
  })

  it('"Preview" opens a phone pop-up with the venue’s menu in that template, and saves nothing', async () => {
    setup()
    await openChooser()
    await userEvent.click(
      screen.getByRole('button', { name: 'Preview the template Editorial Market' }),
    )
    const dialog = await screen.findByTestId('template-preview-dialog')
    expect(within(dialog).getByText('Preview: Editorial Market')).toBeTruthy()
    // The same draft as the live preview (no second request), drawn in a phone frame, no table.
    await waitFor(() =>
      expect(
        within(dialog)
          .getByTestId('phone-frame')
          .querySelector('[data-face="editorial-market"]:not([data-testid])'),
      ).toBeTruthy(),
    )
    expect(actions.previewDraftAction).toHaveBeenCalledTimes(1)
    // There is nothing to choose yet (Styles come with the Studio): no "Use" button in the pop-up.
    expect(within(dialog).queryByRole('button', { name: /^Use this template/ })).toBeNull()

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('template-preview-dialog')).toBeNull())
    // The chooser is still open behind it.
    expect(screen.getByTestId('template-editorial-market')).toBeTruthy()
  })

  it('shows the pop-up with the look being edited, saved or not', async () => {
    setup()
    type('Your brand colour', '#2563eb')
    await openChooser()
    await userEvent.click(
      screen.getByRole('button', { name: 'Preview the template Editorial Market' }),
    )
    const dialog = await screen.findByTestId('template-preview-dialog')
    const root = await waitFor(() => {
      const found = within(dialog)
        .getByTestId('phone-frame')
        .querySelector('[data-face="editorial-market"]:not([data-testid])')
      expect(found).toBeTruthy()
      return found as HTMLElement
    })
    await waitFor(() =>
      expect(root.style.getPropertyValue('--rm-l-background')).toBe(tintsOf('#2563eb').page),
    )
  })

  it('says why in the pop-up when there is no draft', async () => {
    actions.previewDraftAction.mockResolvedValue({ ok: false, error: 'nothing_visible' })
    setup()
    await openChooser()
    await userEvent.click(
      screen.getByRole('button', { name: 'Preview the template Editorial Market' }),
    )
    const dialog = await screen.findByTestId('template-preview-dialog')
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Nothing visible to publish, so there is nothing to preview.',
    )
  })
})

describe('the cards, in order', () => {
  it('come as the chooser, logo and header name, guest features, font and screen, colours', () => {
    setup()
    const order = [
      'design-templates',
      'design-logo-section',
      'guest-features-panel',
      'design-style-section',
      'design-colours-section',
    ].map((id) => screen.getByTestId(id))
    for (let i = 1; i < order.length; i += 1) {
      const before = order[i - 1] as HTMLElement
      const after = order[i] as HTMLElement
      expect(
        before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${before.dataset.testid} comes before ${after.dataset.testid}`,
      ).toBeTruthy()
    }
  })

  it('holds the guest features as a card of their own, saved apart from the look', async () => {
    setup()
    const card = screen.getByTestId('guest-features-panel')
    expect(within(card).getByRole('heading', { name: 'Guest features' })).toBeTruthy()
    expect(within(card).getByTestId('allergens-always')).toBeTruthy()
    // Its own Save, and "Save look" is untouched by it.
    expect((within(card).getByTestId('guest-features-save') as HTMLButtonElement).disabled).toBe(
      true,
    )
    await userEvent.click(within(card).getByTestId('feature-bill'))
    expect((within(card).getByTestId('guest-features-save') as HTMLButtonElement).disabled).toBe(
      false,
    )
    expect(save().disabled).toBe(true)
  })
})

describe('the logo and the header name', () => {
  it('shows the open menu’s name; empty means the venue’s name', () => {
    setup({}, { menu: { id: MENU, name: 'Main bar' } })
    expect(field('Name at the top of the menu').value).toBe('Main bar')
    expect(screen.getByRole('button', { name: 'Save name' })).toBeTruthy()
    expect(screen.getByText(/to use the venue's name \(Demo Club\)/)).toBeTruthy()
  })

  it('uses the venue’s name as the hint while the menu has none', () => {
    setup()
    const box = field('Name at the top of the menu')
    expect(box.value).toBe('')
    expect(box.placeholder).toBe(VENUE_NAME)
    expect((screen.getByRole('button', { name: 'Save name' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('saves with the menu rename, apart from "Save look", and asks for the draft again', async () => {
    setup()
    await previewRoot()
    fireEvent.change(field('Name at the top of the menu'), { target: { value: ' Main bar ' } })
    expect(save().disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(actions.renameMenuAction).toHaveBeenCalledTimes(1))
    expect(actions.renameMenuAction).toHaveBeenCalledWith({
      venueId: VENUE,
      menuId: MENU,
      name: 'Main bar',
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toBe(
      'Name saved. Guests see it after the next publish.',
    )
    await waitFor(() => expect(actions.previewDraftAction).toHaveBeenCalledTimes(2))
    // Saved: the button is off again, and the look was never saved.
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Save name' }) as HTMLButtonElement).disabled,
      ).toBe(true),
    )
    expect(actions.saveLookAction).not.toHaveBeenCalled()
  })

  it('saves an emptied name as the venue’s name', async () => {
    setup({}, { menu: { id: MENU, name: 'Main bar' } })
    fireEvent.change(field('Name at the top of the menu'), { target: { value: '   ' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(actions.renameMenuAction).toHaveBeenCalledTimes(1))
    expect(actions.renameMenuAction.mock.calls[0]?.[0].name).toBe('')
  })

  it('shows what the server refused', async () => {
    actions.renameMenuAction.mockResolvedValue({ ok: false, error: 'not_allowed' })
    setup()
    fireEvent.change(field('Name at the top of the menu'), { target: { value: 'Main bar' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }))
    expect((await screen.findByTestId('design-header-name-error')).textContent).toBe(
      'Only an owner or admin can change the menus.',
    )
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('says to add a menu first when the venue has none, and previews the live menu', async () => {
    setup({}, { menu: null })
    expect(screen.getByTestId('design-header-name-none').textContent).toContain('no menu yet')
    expect(screen.queryByLabelText('Name at the top of the menu')).toBeNull()
    await previewRoot()
    expect(actions.previewDraftAction).toHaveBeenCalledWith(VENUE)
  })

  it('cannot be changed by someone who may not change the design', () => {
    setup({ canEdit: false }, { menu: { id: MENU, name: 'Main bar' } })
    expect(field('Name at the top of the menu').disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'Save name' })).toBeNull()
  })
})

describe('font, corners, shadow and screen', () => {
  it('has the font as a dropdown, every name drawn in its own font', async () => {
    setup()
    const trigger = screen.getByRole('combobox', { name: 'Font' })
    expect(trigger.textContent).toBe('Inter')
    // No more cards of fonts.
    expect(screen.queryByRole('button', { name: /^Lora/ })).toBeNull()
    await userEvent.click(trigger)
    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual([
      'Inter',
      'Manrope',
      'Montserrat',
      'Playfair Display',
      'Lora',
      'Unbounded',
    ])
    for (const option of options) {
      expect(option.getAttribute('style') ?? '', option.textContent ?? '').toContain(
        `"${option.textContent}"`,
      )
    }
  })

  it('applies the font chosen in the dropdown to the preview, and a sample in it', async () => {
    setup()
    await previewRoot()
    await userEvent.click(screen.getByRole('combobox', { name: 'Font' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Lora' }))
    expect(screen.getByRole('combobox', { name: 'Font' }).textContent).toBe('Lora')
    expect(screen.getByTestId('design-font-sample').getAttribute('style') ?? '').toContain('"Lora"')
    await waitFor(async () =>
      expect((await previewRoot()).style.getPropertyValue('--rm-font')).toContain('"Lora"'),
    )
    expect(save().disabled).toBe(false)
  })

  it('applies the corners and the shadow the form holds', async () => {
    setup()
    await previewRoot()
    fireEvent.change(screen.getByLabelText('Corners'), { target: { value: '16' } })
    expect(screen.getByTestId('design-radius-value').textContent).toBe('16 px')
    await waitFor(async () =>
      expect((await previewRoot()).style.getPropertyValue('--rm-radius')).toBe('16px'),
    )
    fireEvent.change(screen.getByLabelText('Shadow'), { target: { value: '0' } })
    await waitFor(async () =>
      expect((await previewRoot()).style.getPropertyValue('--rm-shadow')).toBe('0'),
    )
  })

  it('follows a light/dark policy that is not "follow the phone"', async () => {
    setup()
    await previewRoot()
    await userEvent.click(screen.getByRole('button', { name: 'Always dark' }))
    await waitFor(async () => expect((await previewRoot()).dataset.scheme).toBe('dark'))
    await userEvent.click(screen.getByRole('button', { name: 'Always light' }))
    await waitFor(async () => expect((await previewRoot()).dataset.scheme).toBe('light'))
  })
})

describe('colours, brand-first', () => {
  it('has three pickers, the brand colour first, and no presets, swatches or starting point', () => {
    setup()
    const pickers = [
      ...screen.getByTestId('design-three-colours').querySelectorAll('[data-colour]'),
    ].map((element) => element.getAttribute('data-colour'))
    expect(pickers).toEqual(['tertiary', 'primary', 'secondary'])
    expect(screen.getByLabelText('Your brand colour')).toBeTruthy()
    expect(screen.getByLabelText('Page')).toBeTruthy()
    expect(screen.getByLabelText('Panels')).toBeTruthy()
    for (const preset of ['Midnight', 'Botanical', 'Nordic', 'Terracotta', 'Custom']) {
      expect(screen.queryByRole('button', { name: preset }), preset).toBeNull()
    }
    expect(screen.queryByRole('button', { name: 'From my brand colour' })).toBeNull()
    expect(screen.queryByText('Starting point')).toBeNull()
    expect(screen.queryByRole('list', { name: 'Suggested colours' })).toBeNull()
    expect(screen.queryByRole('button', { name: '#e11d48' })).toBeNull()
  })

  it('fills the page and the panels with tints of the brand colour as it is typed', async () => {
    setup()
    expect(field('Your brand colour').value).toBe('')
    type('Your brand colour', '#2563eb')
    const tints = tintsOf('#2563eb')
    expect(field('Page').value).toBe(tints.page)
    expect(field('Panels').value).toBe(tints.panels)
    expect(save().disabled).toBe(false)
    // …and again when the brand colour changes.
    type('Your brand colour', '#e11d48')
    expect(field('Page').value).toBe(tintsOf('#e11d48').page)
    // The preview shows them at once.
    await waitFor(async () =>
      expect((await previewRoot()).style.getPropertyValue('--rm-l-background')).toBe(
        tintsOf('#e11d48').page,
      ),
    )
    expect((await previewRoot()).style.getPropertyValue('--rm-l-accent')).toBe('#e11d48')
  })

  it('stops filling a colour the person has edited, and "Use tints…" hands it back', async () => {
    setup()
    expect(screen.queryByTestId('design-follow-brand')).toBeNull()
    type('Your brand colour', '#2563eb')
    type('Page', '#f4efe6')
    type('Your brand colour', '#e11d48')
    expect(field('Page').value).toBe('#f4efe6')
    // The panels are still the brand's.
    expect(field('Panels').value).toBe(tintsOf('#e11d48').panels)

    await userEvent.click(
      screen.getByRole('button', { name: 'Use tints of my brand colour again' }),
    )
    expect(field('Page').value).toBe(tintsOf('#e11d48').page)
    expect(screen.queryByTestId('design-follow-brand')).toBeNull()
    type('Your brand colour', '#16a34a')
    expect(field('Page').value).toBe(tintsOf('#16a34a').page)
  })

  it('warns when the page colour is strongly saturated, and only then', () => {
    setup()
    type('Your brand colour', '#00ff00')
    // The brand-first pre-fill (tints of the brand) itself never warns, even for a pure green.
    expect(screen.queryByTestId('design-saturation-warning')).toBeNull()
    type('Page', '#ffcc00')
    expect(screen.getByTestId('design-saturation-warning').textContent).toContain(
      'strongly saturated',
    )
    // The warning is advice: Save stays on.
    expect(save().disabled).toBe(false)
    type('Page', '#f4efe6')
    expect(screen.queryByTestId('design-saturation-warning')).toBeNull()
  })

  it('says so in one sentence when the brand colour stands out less than 3:1 against the page', () => {
    setup()
    type('Your brand colour', '#eab308')
    // It does not promise the strong outline: no face draws it yet (D93 point 2).
    expect(screen.getByTestId('design-pale-highlight').textContent).toBe(
      'Your brand colour stands out less than 3:1 against the page (Light screen), so it stays as you chose it.',
    )
    type('Your brand colour', '#1e3a8a')
    expect(screen.queryByTestId('design-pale-highlight')).toBeNull()
  })

  it('marks a colour that is not complete and holds Save back', () => {
    setup()
    type('Your brand colour', '#2563eb')
    const page = field('Page')
    type('Page', '#12')
    expect(page.getAttribute('aria-invalid')).toBe('true')
    expect(
      within(screen.getByTestId('design-three-colours')).getAllByRole('alert')[0]?.textContent,
    ).toBe('Enter a colour like #3366cc.')
    expect(save().disabled).toBe(true)
    expect(screen.getByTestId('design-status').textContent).toContain('not complete')
  })

  it('"Suggest with colour theory" is a small link that fills the page and the panels', async () => {
    setup()
    type('Your brand colour', '#e0a43a')
    await userEvent.click(screen.getByRole('button', { name: 'Suggest with colour theory' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.getAttribute('data-rule'))).toEqual([
      'complementary',
      'analogous',
      'triadic',
      'split_complementary',
      'monochrome',
    ])
    await userEvent.click(screen.getByRole('menuitem', { name: /^Triadic/ }))
    const wanted = suggestHarmony('#e0a43a', 'triadic')
    expect(field('Page').value).toBe(wanted.primary)
    expect(field('Panels').value).toBe(wanted.secondary)
    expect(field('Your brand colour').value).toBe('#e0a43a')
  })
})

describe('Advanced: the computed colours', () => {
  it('is collapsed until it is opened, and then lists them for both screens', async () => {
    setup()
    type('Your brand colour', '#2563eb')
    expect(screen.queryByTestId('design-roles')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Advanced' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    await userEvent.click(toggle)
    const roles = screen.getByTestId('design-roles')
    // Text, secondary text, button text, highlight as text and borders on both screens; the page,
    // the panels and the highlight on the dark screen only (the light ones are the pickers).
    for (const role of ['text', 'muted', 'on_accent', 'accent_text', 'border']) {
      expect(row('light', role), role).toBeTruthy()
      expect(row('dark', role), role).toBeTruthy()
    }
    for (const role of ['background', 'surface', 'accent']) {
      expect(row('dark', role), role).toBeTruthy()
      expect(screen.queryByTestId(`role-light-${role}`), role).toBeNull()
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
    expect(
      within(screen.getByTestId('design-role-on_accent')).getByText('Text on highlights'),
    ).toBeTruthy()
    expect(roles.querySelectorAll('[data-testid^="role-"]').length).toBeGreaterThan(13)
  })

  it('lists the ten roles of D93 with their contrast, and none can be adjusted by hand yet', async () => {
    setup()
    type('Your brand colour', '#2563eb')
    await openAdvanced()
    const more = screen.getByTestId('design-more-roles')
    for (const role of [
      'error',
      'error_text',
      'success',
      'success_text',
      'disabled_text',
      'selected',
      'selected_text',
      'focus',
      'backdrop',
      'border_strong',
    ]) {
      expect(within(more).getByTestId(`design-role-${role}`), role).toBeTruthy()
    }
    expect(within(more).queryByRole('button', { name: /^Adjust/ })).toBeNull()
    const focus = within(row('light', 'focus')).getByRole('list', {
      name: 'Contrast of Focus ring',
    })
    expect(within(focus).getAllByRole('listitem')).toHaveLength(2)
    for (const item of within(focus).getAllByRole('listitem')) {
      expect(item.getAttribute('data-ok')).toBe('true')
    }
  })

  it('a colour set by hand that does not read blocks Save, in red, and names the pair', async () => {
    setup()
    type('Your brand colour', '#16a34a')
    await openAdvanced()
    expect(save().disabled).toBe(false)
    const text = row('light', 'text')
    await userEvent.click(within(text).getByRole('button', { name: 'Adjust Text, Light screen' }))
    const box = within(text).getByLabelText('Colour code for Text, Light screen')
    fireEvent.change(box, { target: { value: tintsOf('#16a34a').page } })

    expect(save().disabled).toBe(true)
    expect(text.getAttribute('data-failing')).toBe('true')
    expect(within(text).getAllByText(/needs 4\.5:1/).length).toBeGreaterThan(0)
    const alert = screen.getByTestId('design-unreadable')
    expect(
      within(alert).getByText(/Light screen: Text on Page reads at 1\.\d:1, needs 4\.5:1\./),
    ).toBeTruthy()
    expect(within(alert).getByText(/Light screen: Text on Panels/)).toBeTruthy()
    expect(screen.getByTestId('design-status').textContent).toContain('hard to read')
    // It is adjusted, and Advanced stays open while a pair does not read.
    expect(within(text).getByTestId('role-adjusted')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(screen.getByTestId('design-roles')).toBeTruthy()

    // "Reset" hands the colour back and lets Save through again.
    await userEvent.click(
      within(text).getByRole('button', { name: 'Reset Text, Light screen, to the derived colour' }),
    )
    expect(screen.queryByTestId('design-unreadable')).toBeNull()
    expect(text.getAttribute('data-failing')).toBeNull()
    expect(within(text).queryByTestId('role-adjusted')).toBeNull()
    expect(save().disabled).toBe(false)
  })

  it('names the pair even when Advanced was never opened by the person, in the colour card', async () => {
    // A look that was saved with a hand-set colour that does not read cannot be saved again; the
    // alert is in the card, not inside the collapsed list.
    setup({
      theme: {
        logo_asset_id: null,
        preset: null,
        colors: { primary: '#f4efe6', secondary: '#e8dfcf', tertiary: '#d9f26b' },
        overrides: { light: { text: '#f4efe6' } },
        font: 'inter',
        radius: 8,
        shadow: 1,
        scheme: 'auto',
      },
    })
    expect(screen.getByTestId('design-unreadable')).toBeTruthy()
    expect(screen.getByTestId('design-roles')).toBeTruthy()
    expect(save().disabled).toBe(true)
  })

  it('"Reset all adjusted colours" takes every hand-set colour off at once', async () => {
    setup({
      theme: {
        logo_asset_id: null,
        preset: null,
        colors: { primary: '#f4efe6', secondary: '#e8dfcf', tertiary: '#d9f26b' },
        overrides: { dark: { border: '#334455', muted: '#aaaaaa' } },
        font: 'inter',
        radius: 8,
        shadow: 1,
        scheme: 'auto',
      },
    })
    await openAdvanced()
    expect(screen.getAllByTestId('role-adjusted')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Reset all adjusted colours' }))
    expect(screen.queryAllByTestId('role-adjusted')).toHaveLength(0)
    expect(save().disabled).toBe(false)
  })
})

describe('the live preview', () => {
  it('draws the open menu in the chosen template from the draft, once', async () => {
    setup()
    const root = await previewRoot()
    // The draft's menu layout (D92): a snapshot without one looks as before, two columns.
    expect(root.dataset.layout).toBe('two')
    expect(actions.previewDraftAction).toHaveBeenCalledTimes(1)
    expect(actions.previewDraftAction).toHaveBeenCalledWith(VENUE, MENU)
    expect(screen.getByTestId('design-preview-menu').textContent).toBe('Menu: Demo Club')
  })

  it('names the open menu by its header name', async () => {
    setup({}, { menu: { id: MENU, name: 'Main bar' } })
    await previewRoot()
    expect(screen.getByTestId('design-preview-menu').textContent).toBe('Menu: Main bar')
  })

  it('stays beside the form on wide screens (sticky) and below it at phone width', () => {
    setup()
    const aside = screen.getByTestId('design-preview-aside')
    expect(aside.className).toContain('lg:sticky')
    expect(aside.className).toContain('lg:top-4')
    // It follows the form in the page, so a phone shows it underneath.
    const form = screen.getByTestId('design-templates')
    expect(form.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('applies the light/dark switch', async () => {
    setup()
    await previewRoot()
    await userEvent.click(
      within(screen.getByTestId('design-preview')).getByRole('button', { name: 'Dark' }),
    )
    await waitFor(async () => expect((await previewRoot()).dataset.scheme).toBe('dark'))
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

  it('saves the whole look as three colours with no preset and no brand colour', async () => {
    setup()
    type('Your brand colour', '#2563eb')
    await userEvent.click(screen.getByRole('combobox', { name: 'Font' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Manrope' }))
    fireEvent.change(screen.getByLabelText('Shadow'), { target: { value: '0' } })
    await userEvent.click(screen.getByRole('button', { name: 'Always dark' }))
    await userEvent.click(save())
    await waitFor(() => expect(actions.saveLookAction).toHaveBeenCalledTimes(1))
    const tints = tintsOf('#2563eb')
    expect(actions.saveLookAction.mock.calls[0]?.[0]).toEqual({
      venueId: VENUE,
      expectedRevision: 0,
      theme: {
        logo_asset_id: null,
        preset: null,
        colors: { primary: tints.page, secondary: tints.panels, tertiary: '#2563eb' },
        font: 'manrope',
        radius: 8,
        shadow: 0,
        scheme: 'dark',
      },
    })

    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1))
    expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toBe(
      'Saved. Guests see it after the next publish.',
    )
    // Saved: the button is off again.
    await waitFor(() => expect(save().disabled).toBe(true))
    expect(screen.getByTestId('design-status').textContent).toBe(
      'Saved. Guests see it after the next publish.',
    )
  })

  it('saves a page and panels the person set, and the roles they set by hand', async () => {
    setup()
    type('Your brand colour', '#2563eb')
    type('Page', '#f4efe6')
    await openAdvanced()
    const border = row('dark', 'border')
    await userEvent.click(
      within(border).getByRole('button', { name: 'Adjust Borders, Dark screen' }),
    )
    fireEvent.change(within(border).getByLabelText('Colour code for Borders, Dark screen'), {
      target: { value: '#334455' },
    })
    await userEvent.click(save())
    await waitFor(() => expect(actions.saveLookAction).toHaveBeenCalledTimes(1))
    expect(actions.saveLookAction.mock.calls[0]?.[0].theme).toMatchObject({
      preset: null,
      colors: { primary: '#f4efe6', secondary: tintsOf('#2563eb').panels, tertiary: '#2563eb' },
      overrides: { dark: { border: '#334455' } },
    })
  })

  it('saves only the look’s own settings for a venue that never chose colours', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Always light' }))
    await userEvent.click(save())
    await waitFor(() => expect(actions.saveLookAction).toHaveBeenCalledTimes(1))
    expect(actions.saveLookAction.mock.calls[0]?.[0]).toEqual({
      venueId: VENUE,
      expectedRevision: 0,
      theme: { logo_asset_id: null, font: 'inter', radius: 8, shadow: 1, scheme: 'light' },
    })
  })

  it('shows a look saved as one brand colour as its three colours, to be saved from here', async () => {
    setup({ theme: { brand: '#2563eb', logo_asset_id: null } })
    const tints = tintsOf('#2563eb')
    expect(field('Your brand colour').value).toBe('#2563eb')
    expect(field('Page').value).toBe(tints.page)
    expect(field('Panels').value).toBe(tints.panels)
    // Guests have the old colours: it is an unsaved change until it is saved from here.
    expect(save().disabled).toBe(false)
    expect(screen.getByTestId('design-status').textContent).toContain('Unsaved changes')
    await userEvent.click(save())
    await waitFor(() => expect(actions.saveLookAction).toHaveBeenCalledTimes(1))
    const theme = actions.saveLookAction.mock.calls[0]?.[0].theme
    expect(theme).toEqual({
      logo_asset_id: null,
      preset: null,
      colors: { primary: tints.page, secondary: tints.panels, tertiary: '#2563eb' },
      font: 'inter',
      radius: 8,
      shadow: 1,
      scheme: 'auto',
    })
    expect(theme).not.toHaveProperty('brand')
  })

  it.each(THEME_PRESETS)(
    'shows a look saved from the preset $id as its three colours, saved the same',
    async (preset) => {
      setup({
        theme: {
          logo_asset_id: null,
          preset: preset.id,
          colors: preset.colours,
          overrides: preset.overrides,
          font: 'inter',
          radius: preset.radius,
          shadow: 1,
          scheme: 'auto',
        },
      })
      expect(field('Your brand colour').value).toBe(preset.colours.tertiary)
      expect(field('Page').value).toBe(preset.colours.primary)
      expect(field('Panels').value).toBe(preset.colours.secondary)
      expect(screen.queryByRole('button', { name: preset.label.en })).toBeNull()
      // The look is as saved: nothing to save, and a change to one thing keeps all the rest.
      expect(save().disabled).toBe(true)
      await userEvent.click(screen.getByRole('button', { name: 'Always dark' }))
      await userEvent.click(save())
      await waitFor(() => expect(actions.saveLookAction).toHaveBeenCalledTimes(1))
      expect(actions.saveLookAction.mock.calls[0]?.[0].theme).toEqual({
        logo_asset_id: null,
        preset: null,
        colors: preset.colours,
        overrides: preset.overrides,
        font: 'inter',
        radius: preset.radius,
        shadow: 1,
        scheme: 'dark',
      })
    },
  )

  it('keeps what a saved look had when only one thing changes', async () => {
    const theme = {
      logo_asset_id: null,
      preset: null,
      colors: { primary: '#f4efe6', secondary: '#e8dfcf', tertiary: '#d9f26b' },
      overrides: { dark: { border: '#334455' } },
      font: 'lora' as const,
      radius: 16,
      shadow: 1,
      scheme: 'light' as const,
    }
    setup({ revision: 7, theme })
    await userEvent.click(screen.getByRole('button', { name: 'Always dark' }))
    await userEvent.click(save())
    await waitFor(() => expect(actions.saveLookAction).toHaveBeenCalledTimes(1))
    expect(actions.saveLookAction.mock.calls[0]?.[0]).toEqual({
      venueId: VENUE,
      expectedRevision: 7,
      theme: { ...theme, scheme: 'dark' },
    })
  })

  it('names the revision the save answered with on the next save', async () => {
    actions.saveLookAction.mockResolvedValue({ ok: true, revision: 4 })
    setup({ revision: 3 })
    await userEvent.click(screen.getByRole('button', { name: 'Always dark' }))
    await userEvent.click(save())
    await waitFor(() => expect(save().disabled).toBe(true))
    await userEvent.click(screen.getByRole('button', { name: 'Always light' }))
    await userEvent.click(save())
    await waitFor(() => expect(actions.saveLookAction).toHaveBeenCalledTimes(2))
    expect(actions.saveLookAction.mock.calls[0]?.[0].expectedRevision).toBe(3)
    expect(actions.saveLookAction.mock.calls[1]?.[0].expectedRevision).toBe(4)
  })

  it('takes the stored design and says so when someone else saved in between', async () => {
    const stored = {
      logo_asset_id: null,
      colors: { primary: '#f5f1ea', secondary: '#e7e0d4', tertiary: '#e0a43a' },
      font: 'lora' as const,
      radius: 16,
      shadow: 0,
      scheme: 'dark' as const,
    }
    actions.saveLookAction.mockResolvedValue({
      ok: false,
      error: 'stale',
      view: { ...NONE, revision: 5, theme: stored },
    })
    setup({ revision: 4 })
    type('Your brand colour', '#2563eb')
    await userEvent.click(save())
    expect((await screen.findByTestId('design-error')).textContent).toContain(
      'Someone else saved the design in the meantime.',
    )
    expect(toast.success).not.toHaveBeenCalled()
    // The form holds the stored look, nothing to save, and the next save names its revision.
    await waitFor(() => expect(field('Your brand colour').value).toBe('#e0a43a'))
    expect(field('Page').value).toBe('#f5f1ea')
    await waitFor(() => expect(save().disabled).toBe(true))
    actions.saveLookAction.mockResolvedValue({ ok: true, revision: 6 })
    await userEvent.click(screen.getByRole('button', { name: 'Always light' }))
    await userEvent.click(save())
    await waitFor(() => expect(actions.saveLookAction).toHaveBeenCalledTimes(2))
    expect(actions.saveLookAction.mock.calls[1]?.[0].expectedRevision).toBe(5)
  })

  it('shows what the server refused, naming the pairs that do not read', async () => {
    actions.saveLookAction.mockResolvedValue({
      ok: false,
      error: 'unreadable',
      issues: [{ mode: 'dark', fg: 'muted', bg: 'surface', ratio: 3.21, min: 4.5 }],
    })
    setup()
    type('Your brand colour', '#2563eb')
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
    type('Your brand colour', '#2563eb')
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
      colors: { tertiary: '#2563eb' },
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
      theme: {
        logo_asset_id: 'as_0123456789ABCDEFGHIJKL',
        preset: null,
        colors: { primary: '#f4efe6', secondary: '#e8dfcf', tertiary: '#d9f26b' },
      },
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
        preset: null,
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
    expect(screen.queryByRole('button', { name: 'Suggest with colour theory' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Adjust/ })).toBeNull()
    expect(field('Page').disabled).toBe(true)
    expect(field('Page').value).toBe('#f5f1ea')
    expect(field('Your brand colour').disabled).toBe(true)
    expect((screen.getByLabelText('Corners') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('combobox', { name: 'Font' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    // They can look at the templates.
    await userEvent.click(screen.getByRole('button', { name: 'See templates' }))
    expect(
      screen.getByRole('button', { name: 'Preview the template Editorial Market' }),
    ).toBeTruthy()
    // The preview is a read, open to anyone in the organisation.
    await previewRoot()
  })
})
