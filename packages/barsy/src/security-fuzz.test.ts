// The POS boundary, fuzzed (the repair-review's A7): what a hostile or broken till answers. The JSON
// parser and the schemas refuse or pass, never crash; the mapping throws only its own error; a price
// is a non-negative safe integer or no price at all; an internal field never reaches the change set
// (rule 3); a picture URL is https or refused.
import { ChangeSetSchema } from '@restro/core'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { articleSchema, articlesSchema, categoryTreeNodeSchema, placesSchema } from './index.ts'
import { parseBarsyJson } from './json.ts'
import { mapCatalogue, readArticlePicture } from './mapping/catalogue.ts'
import { BarsyMappingError } from './mapping/errors.ts'
import { article, config, input } from './mapping/test-data.ts'
import type { Article } from './read/schemas.ts'

const SEED = { seed: 20261030, numRuns: 400 }

const number = fc.oneof(
  fc.integer(),
  fc.constantFrom(
    '-1',
    '-0.01',
    '1e400',
    '1e-400',
    '9007199254740993',
    '0.005',
    '2.40',
    '1E2',
    'NaN',
    'Infinity',
    '0x10',
    '١٢',
    '',
    ' 1',
  ),
)

describe('parseBarsyJson', () => {
  it('any text: a value or an Error, nothing else', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.json()), (text) => {
        try {
          parseBarsyJson(text)
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
        }
      }),
      SEED,
    )
  })
  it('a very long number stays exact text, and __proto__ pollutes nothing', () => {
    const parsed = parseBarsyJson('{"a":123456789012345678901234567890.12}') as { a: unknown }
    expect(parsed.a).toBe('123456789012345678901234567890.12')
    const proto = parseBarsyJson('{"__proto__":{"polluted":1}}') as object
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(proto)).toBe(Object.prototype)
  })
})

describe('the schemas', () => {
  for (const [name, schema] of Object.entries({
    articlesSchema,
    articleSchema,
    categoryTreeNodeSchema,
    placesSchema,
  })) {
    it(`${name}: arbitrary JSON never throws`, () => {
      fc.assert(
        fc.property(fc.jsonValue({ maxDepth: 4 }), (value) => {
          schema.safeParse(value)
        }),
        SEED,
      )
    })
  }
})

describe('the mapping, on a hostile article', () => {
  const hostileArticle = fc.record({
    id: fc.integer({ min: 1, max: 2 ** 31 }),
    name: fc.oneof(fc.string(), fc.constant('<script>alert(1)</script>'), fc.constant('')),
    actual: number,
    picture: fc.oneof(
      fc.constant<string | null>(null),
      fc.constantFrom(
        'http://169.254.169.254/latest/meta-data/',
        'file:///etc/passwd',
        'javascript:alert(1)',
        'data:image/png;base64,AAAA',
        'https://evil.example/x.png',
        '//evil.example/x.png',
        '',
        ' ',
      ),
    ),
  })

  it('throws only its own error; every price is a safe non-negative integer', () => {
    fc.assert(
      fc.property(fc.array(hostileArticle, { maxLength: 5 }), (rows) => {
        const articles = rows.map((row) =>
          article(row.id, {
            article_name_public: row.name,
            actual_price: row.actual as Article['actual_price'],
            picture: row.picture,
          }),
        )
        try {
          const result = mapCatalogue(input({ articles }), config())
          if (result.changeSet !== null) ChangeSetSchema.parse(result.changeSet)
          for (const op of result.changeSet?.ops ?? []) {
            if (op.op === 'setField' && op.fieldKey === 'price') {
              const { amount_minor: minor } = op.value as { amount_minor: number }
              expect(Number.isSafeInteger(minor) && minor >= 0, String(minor)).toBe(true)
            }
          }
        } catch (error) {
          expect(error).toBeInstanceOf(BarsyMappingError)
        }
      }),
      { seed: 20261030, numRuns: 100 },
    )
  })

  it('a picture that is not https is refused, whatever it says', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'ftp://x/y.png',
    ]) {
      expect(readArticlePicture({ picture: 'x.png', picture_url: url }).kind).toBe('invalid')
    }
  })

  it('rule 3: a cost price and an internal field never reach the change set', () => {
    const leaky = {
      ...article(4242),
      cost_price: '1.2345',
      purchase_price: '6.789',
      supplier_note: 'INTERNAL-SUPPLIER-NOTE',
      article_code: 'INTERNAL-CODE-42',
    } as Article
    const result = mapCatalogue(input({ articles: [leaky] }), config())
    const written = JSON.stringify(result.changeSet?.ops ?? [])
    for (const value of ['1.2345', '6.789', 'INTERNAL-SUPPLIER-NOTE', 'INTERNAL-CODE-42']) {
      expect(written).not.toContain(value)
    }
    expect(written).not.toContain('INTERNAL 4242')
  })
})
