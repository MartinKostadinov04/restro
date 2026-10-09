// What an uploaded file really is, read from its first bytes (brief S2-06b): the type comes from
// the magic bytes, never from the file name or the browser's claim, and the pixel size comes from
// the format's own header, so the web app needs no image library (no `sharp`). Only JPEG, PNG and
// WebP pass; SVG, GIF, HEIC, PDF and anything else are refused. This reads headers, it does not
// decode: a file with a good header and a broken body is caught later by the image worker.
//
// The parser never throws and never reads past the end of the bytes: every read is bounds-checked
// and a short or inconsistent header is `corrupt`.
import {
  type AssetImageType,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_SIDE,
} from '@restro/core'

/** Why a file is refused. */
export type ImageRefusal =
  /** No bytes at all. */
  | 'empty'
  /** More than `MAX_IMAGE_BYTES`. */
  | 'too_large'
  /** Not a JPEG, PNG or WebP by its first bytes. */
  | 'unsupported_type'
  /** Recognised, but the header is cut short or inconsistent. */
  | 'corrupt'
  /** A side of zero or beyond `MAX_IMAGE_SIDE`, or more than `MAX_IMAGE_PIXELS` in all. */
  | 'dimensions'

/** The result of looking at a file. */
export type ImageInspection =
  | {
      readonly ok: true
      readonly contentType: AssetImageType
      readonly width: number
      readonly height: number
    }
  | { readonly ok: false; readonly reason: ImageRefusal }

type Size = { readonly width: number; readonly height: number }

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return (
    bytes.length >= offset + signature.length &&
    signature.every((byte, index) => bytes[offset + index] === byte)
  )
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return ''
  let text = ''
  for (let index = 0; index < length; index++) {
    text += String.fromCharCode(bytes[offset + index] as number)
  }
  return text
}

function u16be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] as number) << 8) | (bytes[offset + 1] as number)
}

function u16le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] as number) | ((bytes[offset + 1] as number) << 8)
}

function u24le(bytes: Uint8Array, offset: number): number {
  return u16le(bytes, offset) | ((bytes[offset + 2] as number) << 16)
}

function u32be(bytes: Uint8Array, offset: number): number {
  // The top byte is multiplied, not shifted: a shift would turn a 32-bit value negative.
  return (
    (bytes[offset] as number) * 0x1000000 +
    (((bytes[offset + 1] as number) << 16) |
      ((bytes[offset + 2] as number) << 8) |
      (bytes[offset + 3] as number))
  )
}

/** PNG: the IHDR chunk comes first: 13 bytes of data, width and height as 32-bit big-endian. */
function pngSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 24) return null
  if (u32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') return null
  return { width: u32be(bytes, 16), height: u32be(bytes, 20) }
}

/** JPEG start-of-frame markers: C0 to CF except C4 (tables), C8 (reserved) and CC (arithmetic). */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/** JPEG: walk the marker segments to the first start-of-frame, which holds height then width. */
function jpegSize(bytes: Uint8Array): Size | null {
  let position = 2
  // A header has a few dozen segments at most; the bound keeps a hostile file from looping.
  for (let segments = 0; segments < 4096; segments++) {
    // Markers start with 0xFF, which may be repeated as padding.
    while (bytes[position] === 0xff && bytes[position + 1] === 0xff) position++
    if (bytes[position] !== 0xff) return null
    const marker = bytes[position + 1]
    if (marker === undefined) return null
    position += 2
    // Markers without a length: standalone (01, D0 to D7) and the start of image.
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue
    // End of image, or the scan itself, before any frame header: there is no size to read.
    if (marker === 0xd9 || marker === 0xda) return null
    if (position + 2 > bytes.length) return null
    const length = u16be(bytes, position)
    if (length < 2) return null
    if (isStartOfFrame(marker)) {
      // length(2) precision(1) height(2) width(2)
      if (length < 7 || position + 7 > bytes.length) return null
      return { height: u16be(bytes, position + 3), width: u16be(bytes, position + 5) }
    }
    position += length
  }
  return null
}

/** WebP: a RIFF container whose first chunk is lossy `VP8 `, lossless `VP8L` or extended `VP8X`. */
function webpSize(bytes: Uint8Array): Size | null {
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8X') {
    // flags(4) canvas width - 1 (24 bits) canvas height - 1 (24 bits)
    if (bytes.length < 30) return null
    return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 }
  }
  if (chunk === 'VP8L') {
    // signature byte 0x2F, then 14 bits of width - 1 and 14 bits of height - 1
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    const bits =
      (bytes[21] as number) |
      ((bytes[22] as number) << 8) |
      ((bytes[23] as number) << 16) |
      (((bytes[24] as number) << 24) >>> 0)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (chunk === 'VP8 ') {
    // frame tag(3) start code 9D 01 2A (3) width(2, 14 bits) height(2, 14 bits)
    if (bytes.length < 30) return null
    if (!startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return null
    return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff }
  }
  return null
}

/**
 * Looks at a file's bytes: its type from the magic bytes, its pixel size from the header, and
 * whether the limits (bytes, side, pixels) hold. The one gate every upload passes before storage.
 */
export function inspectImage(bytes: Uint8Array): ImageInspection {
  if (bytes.length === 0) return { ok: false, reason: 'empty' }
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large' }

  let contentType: AssetImageType
  let size: Size | null
  if (startsWith(bytes, PNG_SIGNATURE)) {
    contentType = 'image/png'
    size = pngSize(bytes)
  } else if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    contentType = 'image/jpeg'
    size = jpegSize(bytes)
  } else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    contentType = 'image/webp'
    size = webpSize(bytes)
  } else {
    return { ok: false, reason: 'unsupported_type' }
  }

  if (size === null) return { ok: false, reason: 'corrupt' }
  const { width, height } = size
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_IMAGE_SIDE ||
    height > MAX_IMAGE_SIDE ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    return { ok: false, reason: 'dimensions' }
  }
  return { ok: true, contentType, width, height }
}
