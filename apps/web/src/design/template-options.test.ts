// Who owns which option of a template (brief SH-05a): the Design tab saves the `look` options and
// keeps the `feature` options the composer's panel owns; a template drops the keys it does not
// declare; only a visible template can be chosen.
import { EDITORIAL_MARKET_MANIFEST } from '@restro/editorial-market/manifest'
import type { FaceManifest } from '@restro/shell'
import { describe, expect, it } from 'vitest'

import { OPTIONS_BEFORE_D92 } from '@/faces/test-options'

import { chooseableFace, lookOptionsOf, mergeOptions, optionKeys } from './template-options'

/**
 * A template with options: the Editorial Market as it was until D92 made its layout options the
 * menu's settings (brief S6). The option machinery is generic, and these tests keep it honest.
 */
const MARKET: FaceManifest = { ...EDITORIAL_MARKET_MANIFEST, options: OPTIONS_BEFORE_D92 }

/** The Editorial Market with another set of options, standing in for a second template. */
const OTHER: FaceManifest = {
  ...MARKET,
  face: 'other-template',
  options: {
    layout: MARKET.options.layout as never,
    // `layoutSwitch` is declared here as a look option: not a feature any more.
    layoutSwitch: { ...(MARKET.options.layoutSwitch as object), group: 'look' } as never,
    onlyHere: {
      type: 'boolean',
      default: false,
      group: 'feature',
      label: { bg: 'Само тук', en: 'Only here' },
    },
  },
}

describe('which options belong to which group', () => {
  it('lists a template’s look options and its feature option apart', () => {
    expect(optionKeys(MARKET, 'look')).toEqual(['layout', 'featureFirstSection'])
    expect(optionKeys(MARKET, 'feature')).toEqual(['layoutSwitch'])
  })

  it('gives the look options with their defaults, and nothing else', () => {
    expect(lookOptionsOf(MARKET, undefined)).toEqual({ layout: 'two', featureFirstSection: true })
    expect(lookOptionsOf(MARKET, { layout: 'list', layoutSwitch: false })).toEqual({
      layout: 'list',
      featureFirstSection: true,
    })
  })
})

describe('mergeOptions', () => {
  it('saves the form’s look options and keeps the saved feature options', () => {
    const saved = { face: 'editorial-market', options: { layout: 'two', layoutSwitch: false } }
    expect(mergeOptions(MARKET, saved, { layout: 'one', featureFirstSection: false })).toEqual({
      layout: 'one',
      featureFirstSection: false,
      layoutSwitch: false,
    })
  })

  it('writes no default for a feature the venue never set', () => {
    expect(mergeOptions(MARKET, null, { layout: 'list', featureFirstSection: true })).toEqual({
      layout: 'list',
      featureFirstSection: true,
    })
  })

  it('ignores a feature key sent with the form: the composer panel owns it', () => {
    const saved = { face: 'editorial-market', options: { layoutSwitch: true } }
    expect(
      mergeOptions(MARKET, saved, {
        layout: 'two',
        featureFirstSection: true,
        layoutSwitch: false,
      }),
    ).toMatchObject({ layoutSwitch: true })
  })

  it('replaces a value the manifest does not list by the default, and a missing look key too', () => {
    expect(mergeOptions(MARKET, null, { layout: 'diagonal', featureFirstSection: 'yes' })).toEqual({
      layout: 'two',
      featureFirstSection: true,
    })
    expect(mergeOptions(MARKET, null, {})).toEqual({ layout: 'two', featureFirstSection: true })
  })

  it('takes nonsense for no options at all', () => {
    for (const nonsense of [null, undefined, 'layout', 7, ['layout']]) {
      expect(mergeOptions(MARKET, null, nonsense)).toEqual({
        layout: 'two',
        featureFirstSection: true,
      })
    }
  })

  it('drops the keys another template does not declare when the template changes', () => {
    const saved = {
      face: 'editorial-market',
      options: { layout: 'one', featureFirstSection: false, layoutSwitch: false },
    }
    const next = mergeOptions(OTHER, saved, { layout: 'list', layoutSwitch: true })
    // `featureFirstSection` is not declared by the other template: gone. `layoutSwitch` is a look
    // option there: the form's value wins over the saved feature value. `onlyHere` was never saved.
    expect(next).toEqual({ layout: 'list', layoutSwitch: true })
    expect(Object.keys(next)).not.toContain('featureFirstSection')
  })

  it('keeps a saved feature key that the new template also declares as a feature', () => {
    const saved = { face: 'editorial-market', options: { onlyHere: true, layoutSwitch: false } }
    expect(mergeOptions(OTHER, saved, { layout: 'two', layoutSwitch: true })).toEqual({
      layout: 'two',
      layoutSwitch: true,
      onlyHere: true,
    })
  })
})

describe('which templates can be chosen', () => {
  it('offers the visible template and refuses the hidden reference one and unknown names', () => {
    expect(chooseableFace('editorial-market')?.id).toBe('editorial-market')
    expect(chooseableFace('qr-phone')).toBeUndefined()
    expect(chooseableFace('no-such-template')).toBeUndefined()
    expect(chooseableFace('')).toBeUndefined()
  })
})

describe('the Editorial Market (D92)', () => {
  it('declares no option any more: its form is empty and nothing is saved for it', () => {
    expect(optionKeys(EDITORIAL_MARKET_MANIFEST, 'look')).toEqual([])
    expect(optionKeys(EDITORIAL_MARKET_MANIFEST, 'feature')).toEqual([])
    const saved = {
      face: 'editorial-market',
      options: { layout: 'two', featureFirstSection: true, layoutSwitch: false },
    }
    expect(mergeOptions(EDITORIAL_MARKET_MANIFEST, saved, { layout: 'one' })).toEqual({})
  })
})
