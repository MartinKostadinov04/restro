import { describe, expect, it } from 'vitest'

import { ALLERGENS, DIETARY_LABELS } from './allergens'
import type { FieldDefinition } from './field-definition'
import {
  findField,
  parseTemplate,
  RESERVED_FIELD_KEYS,
  type Template,
  templateRef,
} from './template'
import { ORDER_MODES, VENUE_MENU_TEMPLATE } from './templates/venue-menu'

/** A deep, mutable copy of the default template for negative cases. */
function copyOfDefault(): Template {
  return structuredClone(VENUE_MENU_TEMPLATE)
}

function itemField(template: Template, key: string): FieldDefinition {
  const field = findField(template, 'item', key)
  if (field === undefined) throw new Error(`item has no ${key}`)
  return field
}

function expectRejected(json: unknown, fragment: string): void {
  const parsed = parseTemplate(json)
  expect(parsed.ok).toBe(false)
  if (!parsed.ok) {
    expect(parsed.code).toBe('invalid_template')
    expect(parsed.reason).toContain(fragment)
  }
}

describe('venue-menu@1', () => {
  it('parses against the template schema', () => {
    const parsed = parseTemplate(VENUE_MENU_TEMPLATE)
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.value).toEqual(VENUE_MENU_TEMPLATE)
    expect(templateRef(VENUE_MENU_TEMPLATE)).toBe('venue-menu@1')
  })

  it('survives a JSON round trip (templates are data)', () => {
    const json = JSON.parse(JSON.stringify(VENUE_MENU_TEMPLATE)) as unknown
    expect(parseTemplate(json)).toEqual({ ok: true, value: VENUE_MENU_TEMPLATE })
  })

  it('is frozen', () => {
    expect(Object.isFrozen(VENUE_MENU_TEMPLATE)).toBe(true)
    expect(Object.isFrozen(itemField(VENUE_MENU_TEMPLATE, 'price'))).toBe(true)
  })

  it('holds every standard Item field with the doc owner and combinator, plus the additions', () => {
    const expected: Record<
      string,
      [FieldDefinition['type'], FieldDefinition['owner'], FieldDefinition['combinator']]
    > = {
      name: ['localized_text', 'till', 'source_first'],
      description: ['localized_text', 'builder', 'builder_first'],
      price: ['money', 'till', 'locked'],
      image: ['image', 'builder', 'builder_first'],
      allergens: ['enum_set', 'till', 'must_agree'],
      dietary: ['enum_set', 'builder', 'union'],
      portion: ['measurement', 'till', 'source_first'],
      abv: ['number', 'builder', 'builder_first'],
      tags: ['tags', 'builder', 'union'],
      availability: ['availability', 'builder', 'builder_first'],
      internal_note: ['long_text', 'builder', 'builder_first'],
      order_mode: ['enum', 'builder', 'builder_first'],
      for_sale: ['boolean', 'till', 'all_true'],
      visible: ['boolean', 'till', 'all_true'],
    }
    const fields = VENUE_MENU_TEMPLATE.nodeTypes.item?.fields ?? []
    expect(fields.map((field) => field.key)).toEqual(Object.keys(expected))
    for (const field of fields) {
      expect([field.type, field.owner, field.combinator], field.key).toEqual(expected[field.key])
    }
  })

  it('sets the decided attributes on the sensitive fields', () => {
    const t = VENUE_MENU_TEMPLATE
    expect(itemField(t, 'price')).toMatchObject({
      required: 'when_orderable',
      overridable: 'never_when_orderable',
      critical: true,
      constraints: { min_minor: 0 },
    })
    expect(itemField(t, 'name')).toMatchObject({
      required: true,
      overridable: 'always',
      critical: true,
    })
    // D42: allergens are a plain attribute; missing or conflicting allergens warn, never block.
    expect(itemField(t, 'allergens')).toMatchObject({ critical: false, options: [...ALLERGENS] })
    expect(itemField(t, 'dietary').options).toEqual([...DIETARY_LABELS])
    // D29: builder-owned ordering mode, default orderable.
    expect(itemField(t, 'order_mode')).toMatchObject({
      options: [...ORDER_MODES],
      default: 'orderable',
    })
    expect(itemField(t, 'internal_note').visibility).toBe('internal')
    expect(itemField(t, 'abv')).toMatchObject({ unit: '%', constraints: { min: 0, max: 100 } })
  })

  it('has the Section, Menu, Modifier group and Option fields', () => {
    const keys = (type: keyof Template['nodeTypes']) =>
      (VENUE_MENU_TEMPLATE.nodeTypes[type]?.fields ?? []).map((field) => field.key)
    expect(keys('section')).toEqual(['title', 'description', 'image', 'hint_color', 'hint_icon'])
    expect(keys('menu')).toEqual(['title', 'intro', 'availability'])
    expect(keys('modifier_group')).toEqual(['name', 'min', 'max'])
    expect(keys('option')).toEqual(['name', 'price_delta'])
    expect(findField(VENUE_MENU_TEMPLATE, 'option', 'price_delta')).toMatchObject({
      type: 'money',
      owner: 'till',
      combinator: 'locked',
    })
  })

  it('keeps every field key unique per node type and clear of reserved keys', () => {
    for (const nodeType of Object.values(VENUE_MENU_TEMPLATE.nodeTypes)) {
      const keys = nodeType.fields.map((field) => field.key)
      expect(new Set(keys).size).toBe(keys.length)
      for (const key of keys) expect(RESERVED_FIELD_KEYS as readonly string[]).not.toContain(key)
    }
  })
})

describe('parseTemplate', () => {
  it('rejects a duplicate field key', () => {
    const template = copyOfDefault()
    template.nodeTypes.item?.fields.push(itemField(template, 'name'))
    expectRejected(template, 'duplicate field key name')
  })

  it('rejects reserved keys', () => {
    for (const key of ['orderable', 'price_from', 'badges']) {
      const template = copyOfDefault()
      template.nodeTypes.item?.fields.push({ ...itemField(template, 'abv'), key })
      expectRejected(template, `${key} is reserved`)
    }
  })

  it('rejects an unknown field type', () => {
    const template = copyOfDefault()
    const json = JSON.parse(JSON.stringify(template)) as {
      nodeTypes: { item: { fields: { type: string }[] } }
    }
    const first = json.nodeTypes.item.fields[0]
    if (first !== undefined) first.type = 'colour'
    expectRejected(json, 'type')
  })

  it('rejects an unknown node type and a template without a menu', () => {
    const withDrink = {
      ...copyOfDefault(),
      nodeTypes: { ...copyOfDefault().nodeTypes, drink: { fields: [] } },
    }
    expectRejected(withDrink, 'drink')
    const { menu: _menu, ...rest } = copyOfDefault().nodeTypes
    expectRejected({ ...copyOfDefault(), nodeTypes: rest }, 'menu node type')
  })

  it('rejects a node type with no possible parent (option without modifier group)', () => {
    const { modifier_group: _group, ...rest } = copyOfDefault().nodeTypes
    expectRejected({ ...copyOfDefault(), nodeTypes: rest }, 'option has no possible parent')
  })

  it('rejects inconsistent field definitions', () => {
    const cases: [Partial<FieldDefinition>, string][] = [
      [{ combinator: 'all_true' }, 'all_true combines boolean fields only'],
      [{ owner: 'till' }, 'builder_first is for builder-owned fields'],
      [{ overridable: 'always' }, 'builder-owned fields use never'],
      [{ localizable: true }, 'localizable'],
      [{ unit: undefined, options: ['a'] }, 'only enum fields take options'],
      [{ constraints: { max_length: 3 } }, 'invalid number constraints'],
      [{ default: 'forty' }, 'invalid default'],
      [{ default: 140 }, 'invalid default'],
      [{ key: 'ABV' }, 'snake_case'],
      [{ label: {} }, 'at least one language'],
    ]
    for (const [change, fragment] of cases) {
      const template = copyOfDefault()
      const fields = template.nodeTypes.item?.fields ?? []
      const index = fields.findIndex((field) => field.key === 'abv')
      fields[index] = { ...itemField(template, 'abv'), ...change }
      expectRejected(template, fragment)
    }
  })

  it('rejects a locked field that is overridable, and when_orderable outside items and options', () => {
    const locked = copyOfDefault()
    const price = itemField(locked, 'price')
    price.overridable = 'always'
    expectRejected(locked, 'refuses overrides')

    const sectionRequired = copyOfDefault()
    const title = findField(sectionRequired, 'section', 'title')
    if (title !== undefined) title.required = 'when_orderable'
    expectRejected(sectionRequired, 'when_orderable')
  })

  it('keeps allergens and dietary labels on their fixed lists', () => {
    const allergens = copyOfDefault()
    itemField(allergens, 'allergens').options?.push('spicy')
    expectRejected(allergens, 'allergens must be an enum_set over the fixed list')
    const dietary = copyOfDefault()
    itemField(dietary, 'dietary').options?.push('keto')
    expectRejected(dietary, 'dietary must be an enum_set over the fixed list')
  })

  it('accepts a tenant extension: a new custom field on Item', () => {
    const template = { ...copyOfDefault(), key: 'club-x-menu', version: 2 }
    template.nodeTypes.item?.fields.push({
      key: 'calories',
      type: 'number',
      label: { bg_BG: 'Калории', en_US: 'Calories' },
      required: false,
      localizable: false,
      constraints: { min: 0, integer: true },
      owner: 'builder',
      overridable: 'never',
      combinator: 'builder_first',
      visibility: 'public',
      critical: false,
      stalePolicy: 'review',
      unit: 'kcal',
    })
    expect(parseTemplate(template).ok).toBe(true)
  })
})
