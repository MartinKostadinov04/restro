// Demo Bar for `pnpm db:seed:dev` (#71; test-POS design §6): the third seed venue, on a `sim`
// instance. Its menu is what the venue's POS would have given: it is read from the SAME scenario
// file the simulator loads (`packages/connectors/sim-pos/scenarios/`), so the menu and the POS's
// catalogue can never drift apart, and written through `apply()` with POS provenance (till-layer
// values citing a source record), exactly as a barsy pull would be. Pure: the seed script
// (`seed-demo-bar.ts` here) does the database work, this file only reads the scenario and describes
// the change set.
//
// The web app never imports a connector package (dependency-cruiser), so the scenario is read from
// disk as plain JSON and checked with a schema of this file's own that holds only what the seed
// needs: the catalogue (names, prices), the tables' numbers and payment marks, and the menu.
//
// What the scenario's menu holds that no field carries yet: a pay-first mark on three bottle
// items. Part 2 (paying in the app) adds the payment-mode field; until then the mark stays in the
// scenario file and the items are written as ordinary ones.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  type ChangeSet,
  type ChangeSetOp,
  type LocalizedText,
  type NodeId,
  newId,
  type SourceLink,
  tillSource,
} from '@restro/core'
import { z } from 'zod'

/** The mapping version the demo's POS values record. */
export const DEMO_BAR_MAPPING_VERSION = 1

/** The scenario the seed starts from (the one `pnpm sim:serve` starts from too). */
export const DEMO_BAR_SCENARIO = 'quiet-night'

/** The venue and its organisation's instance. */
export const DEMO_BAR_VENUE = { name: 'Demo Bar', slug: 'demo-bar' } as const
export const DEMO_BAR_INSTANCE_NAME = 'Simulated POS'

/** Where `pnpm sim:serve` listens by default (`packages/connectors/sim-pos/src/control/server.ts`). */
export const DEMO_BAR_HOST = 'localhost:4010'

/** The till venue (`bid`) Demo Bar serves on its instance. */
export const DEMO_BAR_BID = 1

const SCENARIOS_DIR = fileURLToPath(
  new URL('../../../../packages/connectors/sim-pos/scenarios/', import.meta.url),
)

const Localized = z.object({ bg_BG: z.string().min(1), en_US: z.string().min(1).optional() })
const Option = z.object({
  id: z.string().min(1),
  name: Localized,
  priceDeltaMinor: z.int().nonnegative(),
})
const OptionGroup = z.object({
  id: z.string().min(1),
  name: Localized,
  min: z.int().nonnegative(),
  max: z.int().positive(),
  options: z.array(Option).min(1),
})
const MenuItem = z.object({
  article: z.string().min(1),
  name: Localized,
  soldOut: z.boolean().optional(),
  payment: z.enum(['on_the_bill', 'pay_first']).optional(),
  optionGroups: z.array(OptionGroup).optional(),
})
const MenuSection = z.object({ id: z.string().min(1), title: Localized, items: z.array(MenuItem) })

/** The parts of a scenario file the seed reads (it ignores the engine's switches and faults). */
const ScenarioPart = z.object({
  name: z.string(),
  extends: z.string().optional(),
  articles: z
    .array(z.object({ id: z.string(), name: z.string(), priceMinor: z.int(), tip: z.boolean() }))
    .optional(),
  tables: z
    .array(z.object({ id: z.string(), number: z.string(), payment: z.boolean() }))
    .optional(),
  menu: z.object({ sections: z.array(MenuSection).min(1) }).optional(),
})

/** What the seed takes from a scenario, base applied. */
export interface DemoBarScenario {
  readonly name: string
  readonly articles: ReadonlyMap<string, { readonly name: string; readonly priceMinor: number }>
  /** The POS's names of the payment tables: the venue's floor source marks them when they appear. */
  readonly paymentTableNames: readonly string[]
  readonly sections: readonly z.output<typeof MenuSection>[]
}

function readPart(name: string): z.output<typeof ScenarioPart> {
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) throw new Error(`"${name}" is not a scenario name`)
  const text = readFileSync(`${SCENARIOS_DIR}${name}.json`, 'utf8')
  return ScenarioPart.parse(JSON.parse(text))
}

/** Reads a scenario file (and the base it extends) from disk. */
export function loadDemoBarScenario(name: string = DEMO_BAR_SCENARIO): DemoBarScenario {
  const file = readPart(name)
  const base = file.extends === undefined ? null : readPart(file.extends)
  const articles = file.articles ?? base?.articles
  const tables = file.tables ?? base?.tables
  const menu = file.menu ?? base?.menu
  if (articles === undefined || tables === undefined || menu === undefined) {
    throw new Error(`scenario ${name} has no catalogue, floor or menu to seed`)
  }
  const known = new Map(articles.map((a) => [a.id, { name: a.name, priceMinor: a.priceMinor }]))
  for (const section of menu.sections) {
    for (const item of section.items) {
      if (!known.has(item.article)) {
        throw new Error(`the menu sells article ${item.article}, which the catalogue lacks`)
      }
    }
  }
  return {
    name,
    articles: known,
    paymentTableNames: tables.filter((t) => t.payment).map((t) => t.number),
    sections: menu.sections,
  }
}

// --- the records and the change set ---------------------------------------------------------------

const eur = (amountMinor: number) => ({ amount_minor: amountMinor, currency: 'EUR' })
const text = (value: z.output<typeof Localized>): LocalizedText =>
  value.en_US === undefined ? { bg_BG: value.bg_BG } : { bg_BG: value.bg_BG, en_US: value.en_US }

export type DemoBarExternalType = 'category' | 'article' | 'option_group' | 'option'

/** The external id of an option group and of an option (the article's own id is the article's). */
export const groupKey = (article: string, group: string) => `${article}:${group}`
export const optionKey = (article: string, group: string, option: string) =>
  `${article}:${group}:${option}`

/** The tier-1 records the seed cites: one per category, article, option group and option. */
export function demoBarSourceRecords(scenario: DemoBarScenario): {
  externalType: DemoBarExternalType
  externalId: string
  raw: string
  payload: unknown
}[] {
  const records: {
    externalType: DemoBarExternalType
    externalId: string
    raw: string
    payload: unknown
  }[] = []
  const add = (externalType: DemoBarExternalType, externalId: string, payload: object) =>
    records.push({ externalType, externalId, raw: JSON.stringify(payload), payload })
  for (const section of scenario.sections) {
    add('category', section.id, { simulated: true, id: section.id, name: section.title.bg_BG })
    for (const item of section.items) {
      const article = scenario.articles.get(item.article)
      add('article', item.article, {
        simulated: true,
        id: item.article,
        name: article?.name,
        price_minor: article?.priceMinor,
      })
      for (const group of item.optionGroups ?? []) {
        add('option_group', groupKey(item.article, group.id), {
          simulated: true,
          id: group.id,
          min: group.min,
          max: group.max,
        })
        for (const option of group.options) {
          add('option', optionKey(item.article, group.id, option.id), {
            simulated: true,
            id: option.id,
            price_delta_minor: option.priceDeltaMinor,
          })
        }
      }
    }
  }
  return records
}

/** Inputs of `demoBarPullChangeSet`. */
export interface DemoBarPullInput {
  readonly scenario: DemoBarScenario
  readonly integrationId: string
  readonly venueId: string
  readonly menuId: NodeId
  /** `sr_` id of each record, by `<external type>:<external id>`. */
  readonly records: ReadonlyMap<string, string>
  readonly observedAt?: string
}

/** The key `DemoBarPullInput.records` is keyed by. */
export const recordKey = (type: DemoBarExternalType, externalId: string) => `${type}:${externalId}`

/**
 * What a read of the simulated POS's catalogue produces: the sections, items, option groups and
 * options with their links, the till-layer values (price and for-sale for this venue) and the
 * placements at the end of each section. A second run collapses onto the nodes that exist.
 */
export function demoBarPullChangeSet(input: DemoBarPullInput): ChangeSet {
  const { integrationId, venueId, menuId, scenario } = input
  const link = (externalType: DemoBarExternalType, externalId: string): SourceLink => ({
    integration: integrationId,
    externalType,
    externalId,
  })
  const venueScope = `venue:${venueId}` as const
  const record = (type: DemoBarExternalType, externalId: string) =>
    input.records.get(recordKey(type, externalId)) ?? ''
  const ops: ChangeSetOp[] = []

  const till = (
    type: DemoBarExternalType,
    externalId: string,
    fieldKey: string,
    value: unknown,
    scope: 'master' | `venue:${string}` = 'master',
  ): ChangeSetOp => ({
    op: 'setField',
    node: { link: link(type, externalId) },
    fieldKey,
    layer: 'till',
    scope,
    value: value as never,
    sourceRecordId: record(type, externalId),
    mappingVersion: DEMO_BAR_MAPPING_VERSION,
  })

  for (const section of scenario.sections) {
    const sectionLink = link('category', section.id)
    const sectionId = newId('nd')
    ops.push(
      {
        op: 'createNode',
        id: sectionId,
        nodeType: 'section',
        parent: { id: menuId },
        status: 'active',
        sortKey: 'end',
      },
      { op: 'linkSource', node: { id: sectionId }, link: sectionLink },
      till('category', section.id, 'title', text(section.title)),
    )
    for (const item of section.items) {
      const article = scenario.articles.get(item.article)
      if (article === undefined) throw new Error(`no article ${item.article}`)
      const itemLink = link('article', item.article)
      const itemId = newId('nd')
      ops.push(
        { op: 'createNode', id: itemId, nodeType: 'item', parent: null, status: 'active' },
        { op: 'linkSource', node: { id: itemId }, link: itemLink },
        till('article', item.article, 'name', text(item.name)),
        till('article', item.article, 'price', eur(article.priceMinor), venueScope),
        // A sold-out article is the POS's own mark: not for sale at this venue (rule 5 only ever
        // makes it more cautious).
        till('article', item.article, 'for_sale', item.soldOut !== true, venueScope),
        till('article', item.article, 'visible', true),
        {
          op: 'setPlacement',
          item: { link: itemLink },
          section: { link: sectionLink },
          sortKey: 'end',
        },
      )
      for (const group of item.optionGroups ?? []) {
        const key = groupKey(item.article, group.id)
        const groupLink = link('option_group', key)
        const groupId = newId('nd')
        ops.push(
          {
            op: 'createNode',
            id: groupId,
            nodeType: 'modifier_group',
            parent: { link: itemLink },
            status: 'active',
            sortKey: 'end',
          },
          { op: 'linkSource', node: { id: groupId }, link: groupLink },
          till('option_group', key, 'name', text(group.name)),
          till('option_group', key, 'min', group.min),
          till('option_group', key, 'max', group.max),
        )
        for (const option of group.options) {
          const optKey = optionKey(item.article, group.id, option.id)
          const optionId = newId('nd')
          ops.push(
            {
              op: 'createNode',
              id: optionId,
              nodeType: 'option',
              parent: { link: groupLink },
              status: 'active',
              sortKey: 'end',
            },
            { op: 'linkSource', node: { id: optionId }, link: link('option', optKey) },
            till('option', optKey, 'name', text(option.name)),
            till('option', optKey, 'price_delta', eur(option.priceDeltaMinor)),
          )
        }
      }
    }
  }

  return {
    id: newId('cs'),
    source: tillSource(integrationId),
    jobId: newId('jb'),
    actor: `integration:${integrationId}`,
    observedAt: input.observedAt ?? new Date().toISOString(),
    ops,
  }
}
