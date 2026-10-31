// @vitest-environment jsdom

// Stripe's card form on the guest page (#114, D127): it loads Stripe's library with the venue's
// account, mounts the Payment Element from the form values in the guest's language, enables its
// button when Stripe says the form is ready, confirms with no redirect unless Stripe needs one,
// shows Stripe's own text for a card error, reports `returned` and decides no outcome.

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CardFormLook } from '../card-form-types'
import { type ElementsLike, mountStripeCardForm, type StripeLoader } from './card-form'

const VALUES = { clientSecret: 'secret-placeholder', account: 'acct_1A2b3C' }
const PROPS = {
  label: 'Pay €22.50',
  buttonClass: 'rq-pay',
  locale: 'bg',
  failedText: 'The card form could not load.',
}

afterEach(() => {
  vi.restoreAllMocks()
})

/** A Stripe whose Elements, ready event and confirmation the test controls. */
function fakeStripe(confirm: () => Promise<{ error?: { message?: string } }>) {
  const created: {
    mounted: HTMLElement | null
    destroyed: boolean
    on: Record<string, () => void>
  }[] = []
  const confirmations: Parameters<
    NonNullable<Awaited<ReturnType<StripeLoader>>>['confirmPayment']
  >[0][] = []
  const options: Parameters<NonNullable<Awaited<ReturnType<StripeLoader>>>['elements']>[0][] = []
  const updates: { locale: string }[] = []
  const elements: ElementsLike = {
    update: (given) => {
      updates.push(given)
    },
    create: () => {
      const element = {
        mounted: null as HTMLElement | null,
        destroyed: false,
        on: {} as Record<string, () => void>,
      }
      created.push(element)
      return {
        mount: (target) => {
          element.mounted = target
        },
        destroy: () => {
          element.destroyed = true
        },
        on: (event, handler) => {
          element.on[event] = handler
        },
      }
    },
  }
  const load = vi.fn<StripeLoader>(async () => ({
    elements: (given) => {
      options.push(given)
      return elements
    },
    confirmPayment: async (given) => {
      confirmations.push(given)
      return confirm()
    },
  }))
  return { load, created, confirmations, options, updates }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function context(
  over: { values?: Record<string, string>; publishableKey?: string | undefined } = {},
) {
  return {
    values: VALUES,
    publishableKey: 'pk_test_123',
    returnUrl: 'https://menu.example/m/club/bar',
    onReturned: vi.fn(),
    markRedirect: vi.fn<(on: boolean) => void>(),
    ...over,
  }
}

const buttonOf = (target: HTMLElement) => target.querySelector('button') as HTMLButtonElement
const alertOf = (target: HTMLElement) => target.querySelector('[role="alert"]') as HTMLElement

describe('mounting', () => {
  it("loads Stripe with the venue's account and mounts the Payment Element in the guest's language", async () => {
    const stripe = fakeStripe(async () => ({}))
    const target = document.createElement('div')
    mountStripeCardForm(target, PROPS, context(), stripe.load)
    expect(buttonOf(target).textContent).toBe('Pay €22.50')
    expect(buttonOf(target).className).toBe('rq-pay')
    expect(buttonOf(target).disabled).toBe(true)
    await flush()
    expect(stripe.load).toHaveBeenCalledWith('pk_test_123', { stripeAccount: 'acct_1A2b3C' })
    expect(stripe.options).toEqual([{ clientSecret: 'secret-placeholder', locale: 'bg' }])
    expect(stripe.created[0]?.mounted).toBe(target.querySelector('[data-slot="pay.form.element"]'))
  })

  it("enables the button on Stripe's ready event, not when the element is mounted", async () => {
    const stripe = fakeStripe(async () => ({}))
    const target = document.createElement('div')
    mountStripeCardForm(target, PROPS, context(), stripe.load)
    await flush()
    // Mounted, but Stripe has not drawn the form yet.
    expect(stripe.created[0]?.mounted).not.toBeNull()
    expect(buttonOf(target).disabled).toBe(true)
    stripe.created[0]?.on.ready?.()
    expect(buttonOf(target).disabled).toBe(false)
  })

  it('tells the guest, and logs without personal data, when the card form does not load', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stripe = fakeStripe(async () => ({}))
    const target = document.createElement('div')
    mountStripeCardForm(target, PROPS, context(), stripe.load)
    await flush()
    stripe.created[0]?.on.loaderror?.()
    expect(alertOf(target).textContent).toBe('The card form could not load.')
    expect(alertOf(target).hidden).toBe(false)
    expect(buttonOf(target).disabled).toBe(true)
    expect(log).toHaveBeenCalledTimes(1)
    const logged = JSON.stringify(log.mock.calls)
    expect(logged).not.toContain('secret-placeholder')
    expect(logged).not.toContain('acct_')
    expect(logged).not.toContain('pk_test')
  })

  it('tells the guest and logs when the library does not load', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const target = document.createElement('div')
    mountStripeCardForm(target, PROPS, context(), async () => null)
    await flush()
    expect(alertOf(target).textContent).toBe('The card form could not load.')
    expect(log).toHaveBeenCalledTimes(1)
  })

  it("loads nothing for values it does not know, or without the platform's publishable key, and says so", async () => {
    for (const [bad, reason] of [
      [context({ values: { clientSecret: 'x' } }), 'values'],
      [context({ values: { ...VALUES, account: 'not-an-account' } }), 'values'],
      [context({ publishableKey: undefined }), 'publishable key'],
      [context({ publishableKey: '' }), 'publishable key'],
    ] as const) {
      const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const stripe = fakeStripe(async () => ({}))
      const target = document.createElement('div')
      mountStripeCardForm(target, PROPS, bad, stripe.load)
      await flush()
      expect(stripe.load).not.toHaveBeenCalled()
      expect(buttonOf(target).disabled).toBe(true)
      expect(alertOf(target).textContent).toBe('The card form could not load.')
      expect(String(log.mock.calls[0]?.[0])).toContain(reason)
      log.mockRestore()
    }
  })

  it("follows the face's label and takes the form away", async () => {
    const stripe = fakeStripe(async () => ({}))
    const target = document.createElement('div')
    const handle = mountStripeCardForm(target, PROPS, context(), stripe.load)
    await flush()
    handle.update({ ...PROPS, label: 'Pay €25.00', buttonClass: 'other', locale: 'en' })
    expect(buttonOf(target).textContent).toBe('Pay €25.00')
    expect(buttonOf(target).className).toBe('other')
    // A language switch while the form is open changes Stripe's own text too.
    expect(stripe.updates).toEqual([{ locale: 'en' }])
    handle.unmount()
    expect(stripe.created[0]?.destroyed).toBe(true)
    expect(target.childElementCount).toBe(0)
  })
})

/** A form that is ready for the card. */
async function readyForm(
  confirm: () => Promise<{ error?: { message?: string } }>,
  ctx = context(),
) {
  const stripe = fakeStripe(confirm)
  const target = document.createElement('div')
  mountStripeCardForm(target, PROPS, ctx, stripe.load)
  await flush()
  stripe.created[0]?.on.ready?.()
  return { stripe, target, ctx }
}

describe("the venue's look reaches stripe.elements (#258, D130)", () => {
  const LIGHT = {
    background: '#f6f1e9',
    surface: '#e9dccb',
    accent: '#7a2e8c',
    onAccent: '#ffffff',
    text: '#1d1a17',
    muted: '#5c544c',
    accentText: '#6a2679',
    border: '#d4c7b4',
  }
  const DARK = {
    background: '#14110f',
    surface: '#26211d',
    accent: '#c68ad6',
    onAccent: '#14110f',
    text: '#f3ece3',
    muted: '#b9afa3',
    accentText: '#d9a8e6',
    border: '#3a332d',
  }
  const LOOK: CardFormLook = {
    colors: LIGHT,
    colorsDark: DARK,
    scheme: 'light',
    fontFamily: '"Inter", system-ui, sans-serif',
    radius: 12,
    density: 'compact',
    textSize: 'large',
    sheet: 'panel',
  }

  /** Mounts with `look` and returns the one options object Stripe's `elements` was given. */
  async function optionsFor(look: CardFormLook | null | undefined) {
    const stripe = fakeStripe(async () => ({}))
    const target = document.createElement('div')
    mountStripeCardForm(target, PROPS, { ...context(), look }, stripe.load)
    await flush()
    expect(stripe.options).toHaveLength(1)
    return stripe.options[0]
  }

  afterEach(() => {
    // biome-ignore lint/performance/noDelete: jsdom has no matchMedia of its own
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('hands the Appearance API the venue’s General: colours, font, corners, density, text size', async () => {
    const given = await optionsFor(LOOK)
    expect(given).toEqual({
      clientSecret: 'secret-placeholder',
      locale: 'bg',
      appearance: {
        theme: 'flat',
        variables: expect.objectContaining({
          colorPrimary: LIGHT.accentText,
          colorBackground: LIGHT.surface,
          colorText: LIGHT.text,
          fontFamily: '"Inter", system-ui, sans-serif',
          fontSizeBase: '18px',
          spacingUnit: '3px',
          borderRadius: '12px',
        }),
      },
    })
    // No file for the font is served: the option is left out, not sent empty.
    expect(given).not.toHaveProperty('fonts')
  })

  it('passes nothing of the look when the page has none: Stripe’s own default draws', async () => {
    for (const look of [null, undefined]) {
      expect(await optionsFor(look)).toEqual({ clientSecret: 'secret-placeholder', locale: 'bg' })
    }
  })

  it('takes the dark colours for a venue that is always dark', async () => {
    const given = await optionsFor({ ...LOOK, scheme: 'dark' })
    expect(given?.appearance?.variables).toMatchObject({
      colorBackground: DARK.surface,
      colorText: DARK.text,
      colorPrimary: DARK.accentText,
    })
  })

  it('follows the phone for a venue that follows it', async () => {
    const phone = (dark: boolean) => {
      window.matchMedia = ((query: string) => ({
        matches: dark && query.includes('prefers-color-scheme: dark'),
      })) as unknown as typeof window.matchMedia
    }
    phone(true)
    expect((await optionsFor({ ...LOOK, scheme: 'auto' }))?.appearance?.variables).toMatchObject({
      colorBackground: DARK.surface,
    })
    phone(false)
    expect((await optionsFor({ ...LOOK, scheme: 'auto' }))?.appearance?.variables).toMatchObject({
      colorBackground: LIGHT.surface,
    })
  })

  it('writes the sheet’s own pair so ink on ink does not vanish', async () => {
    const given = await optionsFor({ ...LOOK, sheet: 'ink' })
    expect(given?.appearance?.variables).toMatchObject({
      colorBackground: LIGHT.text,
      colorText: LIGHT.background,
    })
  })

  it('draws no rules, no colour Stripe keeps for itself, and only hex colours', async () => {
    const given = await optionsFor(LOOK)
    const variables = given?.appearance?.variables ?? {}
    expect(given?.appearance).not.toHaveProperty('rules')
    expect(Object.keys(variables)).not.toContain('colorDanger')
    for (const name of ['colorPrimary', 'colorBackground', 'colorText']) {
      expect(variables[name], name).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('leaves the secret and the account out of the look: they are no styling', async () => {
    const given = await optionsFor(LOOK)
    expect(JSON.stringify(given?.appearance)).not.toContain('secret-placeholder')
    expect(JSON.stringify(given?.appearance)).not.toContain('acct_')
  })
})

describe('confirming', () => {
  it('confirms with no redirect unless Stripe needs one, then only reports that the guest returned', async () => {
    const { stripe, target, ctx } = await readyForm(async () => ({}))
    buttonOf(target).click()
    await flush()
    expect(stripe.confirmations).toHaveLength(1)
    expect(stripe.confirmations[0]).toMatchObject({
      redirect: 'if_required',
      confirmParams: { return_url: 'https://menu.example/m/club/bar' },
    })
    // The marker of a redirect is set while Stripe may leave the page and cleared when it did not.
    expect(ctx.markRedirect.mock.calls.map((call) => call[0])).toEqual([true, false])
    expect(ctx.onReturned).toHaveBeenCalledTimes(1)
    // No second payment from a second tap while the host reads the hold.
    expect(buttonOf(target).disabled).toBe(true)
  })

  it("shows Stripe's own text for a card error and reports nothing", async () => {
    const { target, ctx } = await readyForm(async () => ({
      error: { message: 'Your card was declined.' },
    }))
    buttonOf(target).click()
    await flush()
    expect(alertOf(target).textContent).toBe('Your card was declined.')
    expect(alertOf(target).hidden).toBe(false)
    expect(ctx.onReturned).not.toHaveBeenCalled()
    // The guest may try another card.
    expect(buttonOf(target).disabled).toBe(false)
  })

  it('lets the guest try again when the confirmation itself fails', async () => {
    const { target, ctx } = await readyForm(async () => {
      throw new Error('network')
    })
    buttonOf(target).click()
    await flush()
    expect(ctx.onReturned).not.toHaveBeenCalled()
    expect(buttonOf(target).disabled).toBe(false)
    expect(ctx.markRedirect).toHaveBeenLastCalledWith(false)
  })
})
