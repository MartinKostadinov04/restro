// A seeded random source (mulberry32): the same seed gives the same draws, so a chaos run or an
// id sequence can be replayed exactly (#51 design §2.6).

export interface Random {
  /** A draw in [0, 1). */
  next(): number
  /** A whole number in [min, max]. */
  int(min: number, max: number): number
  /** 32 hexadecimal digits. */
  hex32(): string
}

export function seededRandom(seed: number): Random {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
  const word = () =>
    Math.floor(next() * 4_294_967_296)
      .toString(16)
      .padStart(8, '0')
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    hex32: () => `${word()}${word()}${word()}${word()}`,
  }
}
