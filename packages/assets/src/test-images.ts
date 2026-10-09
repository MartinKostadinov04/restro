// Small image files for tests (not part of the app): byte-exact headers of each accepted format,
// and a real, viewable PNG for the end-to-end test. Only the tests import this.
import { crc32, deflateSync } from 'node:zlib'

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0))
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = Uint8Array.from([...ascii(type), ...data])
  return Uint8Array.from([...u32be(data.length), ...body, ...u32be(crc32(body))])
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * A valid, viewable PNG of `width` x `height` pixels: a diagonal gradient between two colours.
 * Keep it small; it is built row by row in memory.
 */
export function makePng(
  width: number,
  height: number,
  from: readonly [number, number, number] = [236, 72, 153],
  to: readonly [number, number, number] = [59, 130, 246],
): Uint8Array {
  const header = Uint8Array.from([...u32be(width), ...u32be(height), 8, 2, 0, 0, 0])
  const rows: number[] = []
  for (let y = 0; y < height; y++) {
    rows.push(0)
    for (let x = 0; x < width; x++) {
      const t = (x + y) / Math.max(1, width + height - 2)
      for (let channel = 0; channel < 3; channel++) {
        rows.push(Math.round((from[channel] as number) * (1 - t) + (to[channel] as number) * t))
      }
    }
  }
  return Uint8Array.from([
    ...PNG_SIGNATURE,
    ...pngChunk('IHDR', header),
    ...pngChunk('IDAT', deflateSync(Uint8Array.from(rows))),
    ...pngChunk('IEND', new Uint8Array()),
  ])
}

/** Only the signature and IHDR of a PNG: enough for the inspector, not decodable. */
export function pngHeader(width: number, height: number): Uint8Array {
  const header = Uint8Array.from([...u32be(width), ...u32be(height), 8, 2, 0, 0, 0])
  return Uint8Array.from([...PNG_SIGNATURE, ...pngChunk('IHDR', header)])
}

/** A JPEG header: start of image, a JFIF segment, a baseline frame header, end of image. */
export function jpegHeader(width: number, height: number): Uint8Array {
  const jfif = [0xff, 0xe0, 0x00, 0x10, ...ascii('JFIF'), 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  const frame = [
    0xff,
    0xc0,
    0x00,
    0x11,
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
  ]
  return Uint8Array.from([0xff, 0xd8, ...jfif, ...frame, 0xff, 0xd9])
}

function riff(chunk: number[]): Uint8Array {
  const size = 4 + chunk.length
  return Uint8Array.from([
    ...ascii('RIFF'),
    size & 0xff,
    (size >> 8) & 0xff,
    (size >> 16) & 0xff,
    (size >> 24) & 0xff,
    ...ascii('WEBP'),
    ...chunk,
  ])
}

function le32(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]
}

/** A lossy WebP header (`VP8 `). */
export function webpLossyHeader(width: number, height: number): Uint8Array {
  const data = [
    0x00,
    0x00,
    0x00, // frame tag
    0x9d,
    0x01,
    0x2a, // start code
    width & 0xff,
    (width >> 8) & 0x3f,
    height & 0xff,
    (height >> 8) & 0x3f,
    0,
    0,
    0,
    0,
  ]
  return riff([...ascii('VP8 '), ...le32(data.length), ...data])
}

/** A lossless WebP header (`VP8L`). */
export function webpLosslessHeader(width: number, height: number): Uint8Array {
  const bits = ((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)
  const data = [0x2f, ...le32(bits >>> 0), 0, 0, 0, 0]
  return riff([...ascii('VP8L'), ...le32(data.length), ...data])
}

/** An extended WebP header (`VP8X`), as animated or alpha images have. */
export function webpExtendedHeader(width: number, height: number): Uint8Array {
  const w = width - 1
  const h = height - 1
  const data = [
    0,
    0,
    0,
    0,
    w & 0xff,
    (w >> 8) & 0xff,
    (w >> 16) & 0xff,
    h & 0xff,
    (h >> 8) & 0xff,
    (h >> 16) & 0xff,
  ]
  return riff([...ascii('VP8X'), ...le32(data.length), ...data])
}
