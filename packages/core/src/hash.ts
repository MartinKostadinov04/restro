// Stable value hashing for `value_hash` (doc "One write path", step 3: a write whose hash equals
// the current value in its layer is a no-op). A hash collision there would silently drop a real
// change, so the hash is SHA-256, not a short checksum. It is computed synchronously in plain
// TypeScript because this package runs in the browser too and Web Crypto's digest is async.

/**
 * Serialises a JSON value with object keys sorted (UTF-16 code-unit order) and no whitespace, so
 * equal values always give the same string. Properties set to `undefined` are left out, as in
 * `JSON.stringify`; anything that is not JSON (functions, symbols, bigint, NaN, ±Infinity) throws.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: ${value} is not JSON`)
      return JSON.stringify(value)
    case 'string':
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
      const record = value as Record<string, unknown>
      const members = Object.keys(record)
        .filter((key) => record[key] !== undefined)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      return `{${members.join(',')}}`
    }
    default:
      throw new TypeError(`canonicalJson: a ${typeof value} is not JSON`)
  }
}

// SHA-256 round constants (FIPS 180-4, section 4.2.2).
const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

// Initial hash values (FIPS 180-4, section 5.3.3).
const H0 = Uint32Array.from([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
])

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n))
}

/** SHA-256 of the UTF-8 encoding of `text`, as 64 lowercase hex characters. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const blockBytes = Math.ceil((bytes.length + 9) / 64) * 64
  const data = new Uint8Array(blockBytes)
  data.set(bytes)
  data[bytes.length] = 0x80
  const view = new DataView(data.buffer)
  const bitLength = bytes.length * 8
  view.setUint32(blockBytes - 8, Math.floor(bitLength / 0x1_0000_0000))
  view.setUint32(blockBytes - 4, bitLength >>> 0)

  const h = Uint32Array.from(H0)
  const w = new Uint32Array(64)
  for (let offset = 0; offset < blockBytes; offset += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(offset + t * 4)
    for (let t = 16; t < 64; t++) {
      const w15 = w[t - 15] as number
      const w2 = w[t - 2] as number
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3)
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10)
      w[t] = (w[t - 16] as number) + s0 + (w[t - 7] as number) + s1
    }
    let a = h[0] as number
    let b = h[1] as number
    let c = h[2] as number
    let d = h[3] as number
    let e = h[4] as number
    let f = h[5] as number
    let g = h[6] as number
    let hh = h[7] as number
    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const choice = (e & f) ^ (~e & g)
      const t1 = (hh + s1 + choice + (K[t] as number) + (w[t] as number)) >>> 0
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (s0 + majority) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] = (h[0] as number) + a
    h[1] = (h[1] as number) + b
    h[2] = (h[2] as number) + c
    h[3] = (h[3] as number) + d
    h[4] = (h[4] as number) + e
    h[5] = (h[5] as number) + f
    h[6] = (h[6] as number) + g
    h[7] = (h[7] as number) + hh
  }
  return Array.from(h, (word) => word.toString(16).padStart(8, '0')).join('')
}
