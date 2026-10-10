import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { asDecimalString, hasJsonSourceAccess, isDecimalText, parseBarsyJson } from './json.ts'

describe('parseBarsyJson: examples (CLAUDE.md rule 8)', () => {
  it('has JSON.parse source-text access on this runtime', () => {
    expect(hasJsonSourceAccess()).toBe(true)
  })

  it('keeps a price with a trailing zero as its exact text', () => {
    expect(parseBarsyJson('{"actual_price": 2.40}')).toStrictEqual({ actual_price: '2.40' })
  })

  it.each([
    ['2.40', '2.40'],
    ['0.1', '0.1'],
    ['0.10', '0.10'],
    ['1.0', '1.0'],
    ['0.0', '0.0'],
    ['-3.50', '-3.50'],
    ['1e2', '1e2'],
    ['1E+2', '1E+2'],
    ['2.5e-3', '2.5e-3'],
    ['12345678901234567890', '12345678901234567890'],
    ['-12345678901234567890', '-12345678901234567890'],
    ['9007199254740992', '9007199254740992'],
    ['-9007199254740992', '-9007199254740992'],
    ['1e999', '1e999'],
    ['-0', '-0'],
  ])('turns %s into the exact text', (source, expected) => {
    expect(parseBarsyJson(source)).toBe(expected)
  })

  it.each([
    ['0', 0],
    ['7', 7],
    ['-7', -7],
    ['100', 100],
    ['9007199254740991', Number.MAX_SAFE_INTEGER],
    ['-9007199254740991', Number.MIN_SAFE_INTEGER],
  ])('keeps the safe integer %s as a number', (source, expected) => {
    expect(parseBarsyJson(source)).toBe(expected)
  })

  it('parses the ping response', () => {
    expect(parseBarsyJson('1')).toBe(1)
  })

  it('leaves strings, booleans, null, arrays and objects alone', () => {
    expect(
      parseBarsyJson('{"a":"2.40","b":true,"c":null,"d":[1,2.5,"x"],"e":{"f":3}}'),
    ).toStrictEqual({ a: '2.40', b: true, c: null, d: [1, '2.5', 'x'], e: { f: 3 } })
  })

  it('reaches numbers nested at any depth', () => {
    expect(parseBarsyJson('{"a":[{"b":{"price":1.10}}]}')).toStrictEqual({
      a: [{ b: { price: '1.10' } }],
    })
  })

  it('does not let a "__proto__" key touch the prototype', () => {
    const parsed = parseBarsyJson('{"__proto__": 1.50}') as object
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true)
  })

  it('throws SyntaxError on invalid JSON, including an empty body', () => {
    expect(() => parseBarsyJson('')).toThrow(SyntaxError)
    expect(() => parseBarsyJson('{"a":')).toThrow(SyntaxError)
    expect(() => parseBarsyJson('01')).toThrow(SyntaxError)
    expect(() => parseBarsyJson('NaN')).toThrow(SyntaxError)
  })
})

describe('asDecimalString', () => {
  it('accepts JSON number text and rejects everything else', () => {
    expect(asDecimalString('2.40')).toBe('2.40')
    expect(asDecimalString('-1e2')).toBe('-1e2')
    for (const bad of [
      '',
      ' 2.40',
      '2.40 ',
      '.5',
      '5.',
      '+5',
      '01',
      '0x10',
      'NaN',
      'Infinity',
      '1,5',
    ]) {
      expect(() => asDecimalString(bad), bad).toThrow(TypeError)
      expect(isDecimalText(bad)).toBe(false)
    }
  })
})

// Property tests -------------------------------------------------------------------------------

const digit = fc.integer({ min: 0, max: 9 })
const digits = (min: number, max: number) =>
  fc.array(digit, { minLength: min, maxLength: max }).map((list) => list.join(''))

/** Valid JSON number text: -?(0|[1-9][0-9]*)(.[0-9]+)?([eE][+-]?[0-9]+)? */
const numberText = fc
  .tuple(
    fc.boolean(),
    fc.oneof(
      fc.constant('0'),
      fc
        .tuple(fc.integer({ min: 1, max: 9 }), digits(0, 24))
        .map(([first, rest]) => `${first}${rest}`),
    ),
    fc.option(digits(1, 12), { nil: undefined }),
    fc.option(fc.tuple(fc.constantFrom('e', 'E'), fc.constantFrom('', '+', '-'), digits(1, 3)), {
      nil: undefined,
    }),
  )
  .map(([negative, integer, fraction, exponent]) => {
    const parts = [negative ? '-' : '', integer]
    if (fraction !== undefined) parts.push('.', fraction)
    if (exponent !== undefined) parts.push(exponent[0], exponent[1], exponent[2])
    return parts.join('')
  })

/** What the rule says a number text must become. */
function expectedNumber(text: string): number | string {
  const value = Number(text)
  const isInteger = /^-?\d+$/.test(text)
  return isInteger && Number.isSafeInteger(value) && !Object.is(value, -0) ? value : text
}

describe('parseBarsyJson: properties', () => {
  it('turns every JSON number into a safe integer number or its exact text, never anything lossy', () => {
    fc.assert(
      fc.property(numberText, (text) => {
        const parsed = parseBarsyJson(text)
        expect(parsed).toStrictEqual(expectedNumber(text))
        if (typeof parsed === 'number') {
          // A number result must print back as exactly the source text.
          expect(String(parsed)).toBe(text)
        } else {
          expect(parsed).toBe(text)
          expect(isDecimalText(parsed as string)).toBe(true)
        }
      }),
      { numRuns: 500 },
    )
  })

  it('keeps every number with a fraction or exponent as text', () => {
    fc.assert(
      fc.property(numberText, (text) => {
        fc.pre(/[.eE]/.test(text))
        expect(parseBarsyJson(text)).toBe(text)
      }),
    )
  })

  it('keeps every integer outside the safe range as text and inside it as a number', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }), (value) => {
        const text = value.toString()
        const parsed = parseBarsyJson(text)
        const safe =
          value >= BigInt(Number.MIN_SAFE_INTEGER) &&
          value <= BigInt(Number.MAX_SAFE_INTEGER) &&
          value !== 0n
        if (value === 0n) {
          expect(parsed).toBe(0)
        } else if (safe) {
          expect(parsed).toBe(Number(value))
        } else {
          expect(parsed).toBe(text)
        }
      }),
      { numRuns: 500 },
    )
  })

  // A small model of JSON documents: render it to text, parse the text, compare with the model.
  type Node =
    | { kind: 'number'; text: string }
    | { kind: 'string'; value: string }
    | { kind: 'boolean'; value: boolean }
    | { kind: 'null' }
    | { kind: 'array'; items: Node[] }
    | { kind: 'object'; entries: [string, Node][] }

  const leaf: fc.Arbitrary<Node> = fc.oneof(
    numberText.map((text): Node => ({ kind: 'number', text })),
    fc.string().map((value): Node => ({ kind: 'string', value })),
    fc.boolean().map((value): Node => ({ kind: 'boolean', value })),
    fc.constant<Node>({ kind: 'null' }),
  )
  const nodeArb: fc.Memo<Node> = fc.memo<Node>((depth) => {
    if (depth <= 1) return leaf
    return fc.oneof(
      leaf,
      fc
        .array(nodeArb(depth - 1), { maxLength: 4 })
        .map((items): Node => ({ kind: 'array', items })),
      fc
        .uniqueArray(
          fc.tuple(
            fc.string({ maxLength: 8 }).filter((key) => key !== '__proto__'),
            nodeArb(depth - 1),
          ),
          { maxLength: 4, selector: ([key]) => key },
        )
        .map((entries): Node => ({ kind: 'object', entries })),
    )
  })

  function render(node: Node, space: string): string {
    switch (node.kind) {
      case 'number':
        return node.text
      case 'string':
        return JSON.stringify(node.value)
      case 'boolean':
        return String(node.value)
      case 'null':
        return 'null'
      case 'array':
        return `[${space}${node.items.map((item) => render(item, space)).join(`${space},${space}`)}${space}]`
      case 'object':
        return `{${space}${node.entries
          .map(([key, value]) => `${JSON.stringify(key)}${space}:${space}${render(value, space)}`)
          .join(`${space},${space}`)}${space}}`
    }
  }

  function expected(node: Node): unknown {
    switch (node.kind) {
      case 'number':
        return expectedNumber(node.text)
      case 'string':
        return node.value
      case 'boolean':
        return node.value
      case 'null':
        return null
      case 'array':
        return node.items.map(expected)
      case 'object':
        return Object.fromEntries(node.entries.map(([key, value]) => [key, expected(value)]))
    }
  }

  it('keeps every number in a random document exact, wherever it sits and however it is spaced', () => {
    fc.assert(
      fc.property(nodeArb(4), fc.constantFrom('', ' ', '\n  '), (node, space) => {
        expect(parseBarsyJson(render(node, space))).toStrictEqual(expected(node))
      }),
      { numRuns: 300 },
    )
  })
})
