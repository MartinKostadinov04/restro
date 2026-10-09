import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE } from '@restro/core'
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { inspectImage } from './inspect-image'
import {
  jpegHeader,
  makePng,
  pngHeader,
  webpExtendedHeader,
  webpLosslessHeader,
  webpLossyHeader,
} from './test-images'

const ascii = (text: string) => Uint8Array.from([...text].map((char) => char.charCodeAt(0)))

describe('inspectImage: type by magic bytes, size from the header', () => {
  it('reads a PNG, including a real one with data', () => {
    expect(inspectImage(pngHeader(640, 480))).toEqual({
      ok: true,
      contentType: 'image/png',
      width: 640,
      height: 480,
    })
    expect(inspectImage(makePng(30, 20))).toMatchObject({ ok: true, width: 30, height: 20 })
  })

  it('reads a JPEG after its JFIF segment', () => {
    expect(inspectImage(jpegHeader(1920, 1080))).toEqual({
      ok: true,
      contentType: 'image/jpeg',
      width: 1920,
      height: 1080,
    })
  })

  it('reads the three WebP flavours', () => {
    for (const bytes of [
      webpLossyHeader(800, 600),
      webpLosslessHeader(800, 600),
      webpExtendedHeader(800, 600),
    ]) {
      expect(inspectImage(bytes)).toEqual({
        ok: true,
        contentType: 'image/webp',
        width: 800,
        height: 600,
      })
    }
  })

  it('reads sizes larger than 16 bits in a PNG', () => {
    // 20 000 x 5 is beyond the side limit, but the parser must read it right to say so.
    expect(inspectImage(pngHeader(70_000, 5))).toEqual({ ok: false, reason: 'dimensions' })
  })

  it('does not trust the name or any claimed type: only the bytes decide', () => {
    // A PNG is a PNG whatever it is called, and text called .jpg is not an image.
    expect(inspectImage(pngHeader(10, 10))).toMatchObject({ contentType: 'image/png' })
    expect(inspectImage(ascii('GIF89a\u0001\u0000\u0001\u0000'))).toEqual({
      ok: false,
      reason: 'unsupported_type',
    })
    expect(inspectImage(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toEqual({
      ok: false,
      reason: 'unsupported_type',
    })
    expect(inspectImage(ascii('%PDF-1.7\n'))).toEqual({ ok: false, reason: 'unsupported_type' })
    expect(inspectImage(ascii('RIFF....WAVEfmt '))).toEqual({
      ok: false,
      reason: 'unsupported_type',
    })
  })

  it('refuses empty and oversized files before anything else', () => {
    expect(inspectImage(new Uint8Array())).toEqual({ ok: false, reason: 'empty' })
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1)
    big.set(pngHeader(10, 10))
    expect(inspectImage(big)).toEqual({ ok: false, reason: 'too_large' })
    // Exactly at the limit is fine.
    const atLimit = new Uint8Array(MAX_IMAGE_BYTES)
    atLimit.set(pngHeader(10, 10))
    expect(inspectImage(atLimit)).toMatchObject({ ok: true })
  })

  it('refuses zero sides, sides beyond the limit and too many pixels', () => {
    expect(inspectImage(pngHeader(0, 10))).toEqual({ ok: false, reason: 'dimensions' })
    expect(inspectImage(pngHeader(10, 0))).toEqual({ ok: false, reason: 'dimensions' })
    expect(inspectImage(pngHeader(MAX_IMAGE_SIDE + 1, 10))).toEqual({
      ok: false,
      reason: 'dimensions',
    })
    expect(inspectImage(pngHeader(MAX_IMAGE_SIDE, 10))).toMatchObject({ ok: true })
    // 12 000 x 12 000 is 144 megapixels.
    expect(inspectImage(pngHeader(12_000, 12_000))).toEqual({ ok: false, reason: 'dimensions' })
    expect(inspectImage(jpegHeader(0, 5))).toEqual({ ok: false, reason: 'dimensions' })
  })

  it('calls a recognised but cut-short or inconsistent header corrupt, never throws', () => {
    expect(inspectImage(pngHeader(10, 10).slice(0, 20))).toEqual({ ok: false, reason: 'corrupt' })
    // IHDR with the wrong length field.
    const badPng = pngHeader(10, 10)
    badPng[11] = 12
    expect(inspectImage(badPng)).toEqual({ ok: false, reason: 'corrupt' })
    expect(inspectImage(Uint8Array.from([0xff, 0xd8, 0xff]))).toEqual({
      ok: false,
      reason: 'corrupt',
    })
    // JPEG that reaches the scan (or the end) before any frame header.
    expect(inspectImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toEqual({
      ok: false,
      reason: 'corrupt',
    })
    expect(inspectImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))).toEqual({
      ok: false,
      reason: 'corrupt',
    })
    // A segment whose length points past the end of the file.
    expect(inspectImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0]))).toEqual({
      ok: false,
      reason: 'corrupt',
    })
    expect(inspectImage(webpLossyHeader(10, 10).slice(0, 26))).toEqual({
      ok: false,
      reason: 'corrupt',
    })
    expect(inspectImage(ascii('RIFF\u0004\u0000\u0000\u0000WEBPJUNK'))).toEqual({
      ok: false,
      reason: 'corrupt',
    })
  })

  it('never throws and never reports a size for truncated valid headers (property)', () => {
    const valid = [
      pngHeader(321, 123),
      jpegHeader(321, 123),
      webpLossyHeader(321, 123),
      webpLosslessHeader(321, 123),
      webpExtendedHeader(321, 123),
    ]
    fc.assert(
      fc.property(fc.constantFrom(...valid), fc.nat(), (bytes, cut) => {
        const result = inspectImage(bytes.slice(0, cut % (bytes.length + 1)))
        if (result.ok) {
          expect(result).toMatchObject({ width: 321, height: 123 })
        }
      }),
    )
  })

  it('never throws on arbitrary bytes, with or without a valid signature (property)', () => {
    const signatures = [
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Uint8Array.from([0xff, 0xd8, 0xff]),
      ascii('RIFF\u0000\u0000\u0000\u0000WEBP'),
      new Uint8Array(),
    ]
    fc.assert(
      fc.property(
        fc.constantFrom(...signatures),
        fc.uint8Array({ maxLength: 200 }),
        (signature, tail) => {
          const result = inspectImage(Uint8Array.from([...signature, ...tail]))
          if (result.ok) {
            expect(result.width).toBeGreaterThanOrEqual(1)
            expect(result.height).toBeGreaterThanOrEqual(1)
            expect(result.width).toBeLessThanOrEqual(MAX_IMAGE_SIDE)
          }
        },
      ),
      { numRuns: 500 },
    )
  })
})
