// The template registry (SH-04). Every entry is checked, the hidden ones too: a template that is
// not offered can still be the one a venue's snapshot names, so it has to keep working. The shell's
// `faceContractSuite` runs for every registered face, so a face cannot be listed without passing.

import { readFileSync } from 'node:fs'
import { EDITORIAL_CSS, SERVICES_CSS } from '@restro/editorial-market'
import { FACE_CSS } from '@restro/qr-phone'
import { faceContractSuite, stubServices } from '@restro/shell/testing'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FONT_STACKS } from '@/fonts'
import { DEFAULT_FACE_ID, FACES, faceEntry, visibleFaces } from './registry'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the registry', () => {
  it('has the Editorial Market and the reference face, and no id twice', () => {
    expect(FACES.map((entry) => entry.id)).toEqual(['editorial-market', 'qr-phone'])
    expect(new Set(FACES.map((entry) => entry.id)).size).toBe(FACES.length)
  })

  it('has a default that is offered to venues', () => {
    const entry = FACES.find((candidate) => candidate.id === DEFAULT_FACE_ID)
    expect(entry).toBeDefined()
    expect(entry?.hidden).toBe(false)
    expect(visibleFaces()).toContain(entry)
    expect(visibleFaces()[0]?.id).toBe(DEFAULT_FACE_ID)
  })

  it('offers the venues the visible templates only', () => {
    expect(visibleFaces().map((entry) => entry.id)).toEqual(['editorial-market'])
    expect(visibleFaces().every((entry) => !entry.hidden)).toBe(true)
    expect(FACES.find((entry) => entry.id === 'qr-phone')?.hidden).toBe(true)
  })

  it('names every template in both languages and says where its picture is', () => {
    for (const entry of FACES) {
      for (const text of [entry.name, entry.description]) {
        expect(text.bg.trim(), entry.id).not.toBe('')
        expect(text.en.trim(), entry.id).not.toBe('')
      }
      expect(entry.thumbnail).toBe(`/faces/${entry.id}.png`)
    }
  })

  it('has the picture of every template under public/: a phone-width PNG of at most 150 KB', () => {
    for (const entry of FACES) {
      const bytes = readFileSync(new URL(`../../public${entry.thumbnail}`, import.meta.url))
      expect(bytes.subarray(0, 8), entry.id).toEqual(PNG_SIGNATURE)
      // The width is in the header (IHDR): the picture is of a phone screen, not a desktop.
      const width = bytes.readUInt32BE(16)
      expect(width, entry.id).toBeGreaterThanOrEqual(320)
      expect(width, entry.id).toBeLessThanOrEqual(480)
      expect(bytes.length, entry.id).toBeLessThanOrEqual(150 * 1024)
    }
  })
})

describe('faceEntry', () => {
  it('finds a template by id', () => {
    expect(faceEntry('editorial-market').id).toBe('editorial-market')
    expect(faceEntry('qr-phone').id).toBe('qr-phone')
  })

  it('gives the default to a venue that chose none, without a word', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(faceEntry(undefined).id).toBe(DEFAULT_FACE_ID)
    expect(faceEntry(null).id).toBe(DEFAULT_FACE_ID)
    expect(warn).not.toHaveBeenCalled()
  })

  it('gives the default to a template it does not know, and says so once, as a structured line', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(faceEntry('removed-template').id).toBe(DEFAULT_FACE_ID)
    expect(faceEntry('removed-template').id).toBe(DEFAULT_FACE_ID)
    expect(faceEntry('another-one').id).toBe(DEFAULT_FACE_ID)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      level: 'warn',
      event: 'unknown_face',
      face: 'removed-template',
    })
  })

  it('logs no more than the start of a very long name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    faceEntry('x'.repeat(500))
    expect(JSON.parse(String(warn.mock.calls[0]?.[0])).face).toHaveLength(64)
  })
})

/**
 * Every face's whole stylesheet, which the suite checks for colours of its own (R13). The registry
 * holds no CSS (it does not import the components), so the test names it here; a face that is
 * registered without a line here fails the first test below.
 */
const STYLESHEETS: Readonly<Record<string, string>> = {
  'editorial-market': EDITORIAL_CSS + SERVICES_CSS,
  'qr-phone': FACE_CSS,
}

describe('the stylesheets', () => {
  it('are known for every registered template', () => {
    expect(Object.keys(STYLESHEETS).sort()).toEqual(FACES.map((entry) => entry.id).sort())
  })
})

describe.each(FACES.map((entry) => [entry.id, entry] as const))('the %s entry', (_id, entry) => {
  it('is registered under the face name of its manifest', () => {
    expect(entry.id).toBe(entry.manifest.face)
  })

  it('loads the same component every time (the lazy loader keeps what it got)', async () => {
    expect(await entry.load()).toBe(await entry.load())
  })

  // The shell's suite: manifest valid (R6, R7, R9, R11, R15), the contract on every fixture and
  // channel, and a stylesheet that takes every colour from the theme (R13). The face is drawn the
  // way the guest page draws it, with every host prop set: the contract has to hold dressed too.
  faceContractSuite(`registry: ${entry.id}`, {
    manifest: entry.manifest,
    css: STYLESHEETS[entry.id] ?? '',
    render: async (view) => {
      const Face = await entry.load()
      return renderToStaticMarkup(
        createElement(Face, {
          view,
          assetBase: '/cdn',
          languages: ['bg_BG', 'en_US'],
          onLanguageChange: () => {},
          tableLabel: '12',
          fontStacks: FONT_STACKS,
          scheme: view.theme.scheme,
          options: {},
          services: stubServices(),
        }),
      )
    },
  })
})
