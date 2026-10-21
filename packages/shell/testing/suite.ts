// `faceContractSuite(name, { manifest, render, css })`: the tests every face has to pass, in one
// call. A face's own test file calls it once, and SH-04's registry test calls it for every face
// the gallery lists, so a face cannot be listed without passing. It registers Vitest tests, so
// call it at the top level of a `*.test.ts(x)` file.
//
// It checks that
//   - the manifest passes `validateManifest` (R6, R7, R9, R11, R15);
//   - the face passes `runFaceContract` on every fixture and every channel it declares (R1–R15,
//     including the fail-closed feature slots), with no failure;
//   - the stylesheet chooses no colour of its own (R13): `assertThemeOnlyCss` finds nothing;
//   - the stylesheet styles nothing outside the face's own root (no `html`, `body` or `:root`):
//     `assertFaceScopedCss` finds nothing.

import { describe, expect, it } from 'vitest'

import { type FaceManifest, validateManifest } from '../src/manifest'
import { type RenderFn, runFaceContract } from './contract'
import { assertFaceScopedCss, assertThemeOnlyCss } from './css'
import { fixtures } from './fixtures'

/** What a face hands to the suite. */
export interface FaceContractSuiteOptions {
  /** The face's validated manifest. */
  readonly manifest: FaceManifest
  /** The face as a function from a view model to markup (`renderToStaticMarkup` of its component). */
  readonly render: RenderFn
  /** The face's whole stylesheet as one string. */
  readonly css: string
}

/** The rendering of the largest fixture (300 items) is slow on a busy machine; the checks are not. */
const RENDER_TIMEOUT_MS = 60_000

/** Registers the face-contract tests for one face. */
export function faceContractSuite(name: string, options: FaceContractSuiteOptions): void {
  const { manifest, render, css } = options
  describe(`${name}: the face contract`, () => {
    it('has a manifest that passes validateManifest', () => {
      const result = validateManifest(manifest)
      expect(result.ok ? [] : result.issues).toEqual([])
    })

    it(
      'passes the contract on every fixture and every channel it declares',
      async () => {
        const report = await runFaceContract(render, manifest)
        expect(report.failures).toEqual([])
        // Guards against a suite that checks nothing: every fixture is rendered on every channel.
        expect(report.renders).toBe(fixtures().length * manifest.channels.length)
      },
      RENDER_TIMEOUT_MS,
    )

    it('chooses no colour of its own: the stylesheet takes every colour from the theme (R13)', () => {
      expect(assertThemeOnlyCss(css)).toEqual([])
    })

    it('styles nothing outside its own root: no html, body or :root rules (the host owns the page)', () => {
      expect(assertFaceScopedCss(css)).toEqual([])
    })
  })
}
