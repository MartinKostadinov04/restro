// mapCatalogue: barsy's category tree, articles, combo option groups and characteristics → a
// change set for apply(), plus the source records, asset requests and link-state intents S2-03
// needs. Pure and deterministic (no database, no network, no clock, no randomness): the same input
// and configuration always give a deep-equal result, whatever the order of the article list.
//
// What it writes, all in the `till` layer (source `till:<integration>`, brief CF-03) with the
// source record and the mapping version:
//   section   title, description                                  (master)
//   item      name, description, visible, allergens               (master)
//             image: cleared when barsy has no picture; set by the photo job, never here
//             price, for_sale                                      (venue:<our vn_ id>)
//             visible at venue scope: cleared when the venue had hidden the item (CF-16)
//   group     name, min, max                                      (master)
//   option    name (master), price_delta                          (venue)
// A field barsy has no value for is cleared in the till layer (so the layers below show through
// and a value removed in barsy does not linger), except where the source is silent (see each).
// An option's name is silent when its option article is not in this run's article list.
//
// Nodes are named by source link everywhere after their creation, so the change set can be split
// into chunks. Node ids are derived (./ids.ts), so a repeated pull creates nothing new.
//
// Several venues on one catalogue (brief CF-16): items are the installation's (one link per
// article); sections are the venue's, linked under the keys `input.qualifiedSections` names
// (./venues.ts). Without it every key is the plain one, exactly as before CF-16.

import {
  type ChangeSet,
  type ChangeSetOp,
  canonicalJson,
  decimalToMinor,
  type FieldWrite,
  type LocalizedText,
  MoneyError,
  type NodeRef,
  type NodeType,
  type Scope,
  type SourceLink,
  sha256Hex,
  tillSource,
} from '@restro/core'

import type { Article, SupplementGroup } from '../read/schemas.ts'
import { findAllergenKey, parseAllergenText } from './allergens.ts'
import { assertInputIds, parseMappingConfig, type ResolvedMappingConfig } from './config.ts'
import { deriveId } from './ids.ts'
import { planSections, type SectionsPlan } from './sections.ts'
import { describeSource } from './source-records.ts'
import { allowedLocales, isEmptyText, localizedText, type TextContext } from './text.ts'
import {
  type AssetRequest,
  BARSY_MAPPING_VERSION,
  type CatalogueCounts,
  type CatalogueInput,
  type CatalogueMapping,
  type LinkStateIntent,
  type LinkType,
  type MappingConfig,
  type MappingWarning,
  type SourceRecordDescriptor,
} from './types.ts'
import { decimalText, flagOf, uniqueBy } from './util.ts'
import { sectionLinkId } from './venues.ts'

const CURRENCY = 'EUR' as const

type FieldValue = FieldWrite['value']

/** Mutable state of one mapping run. */
interface Run {
  readonly input: CatalogueInput
  readonly cfg: ResolvedMappingConfig
  readonly text: TextContext
  readonly bid: string
  readonly venueScope: Scope
  readonly ops: ChangeSetOp[]
  readonly warnings: MappingWarning[]
  readonly sourceRecords: SourceRecordDescriptor[]
  readonly linkStates: LinkStateIntent[]
  readonly assetRequests: AssetRequest[]
}

function linkOf(run: Run, externalType: LinkType, externalId: string): SourceLink {
  return { integration: run.cfg.integrationId, externalType, externalId }
}

function createAndLink(
  run: Run,
  nodeType: Extract<NodeType, 'section' | 'item' | 'modifier_group' | 'option'>,
  link: SourceLink,
  parent: NodeRef | null,
  idParts: readonly string[],
): void {
  const id = deriveId('nd', run.cfg.integrationId, ...idParts)
  run.ops.push({ op: 'createNode', id, nodeType, parent, status: 'active' })
  run.ops.push({ op: 'linkSource', node: { id }, link })
  run.linkStates.push({
    linkType: link.externalType as LinkType,
    externalId: link.externalId,
    state: 'active',
  })
}

function write(
  run: Run,
  link: SourceLink,
  fieldKey: string,
  scope: Scope,
  value: unknown,
  record: SourceRecordDescriptor,
): void {
  run.ops.push({
    op: 'setField',
    node: { link },
    fieldKey,
    layer: 'till',
    scope,
    value: value as FieldValue,
    sourceRecordId: record.id,
    mappingVersion: BARSY_MAPPING_VERSION,
  })
}

function clear(run: Run, link: SourceLink, fieldKey: string, scope: Scope): void {
  run.ops.push({ op: 'clearField', node: { link }, fieldKey, layer: 'till', scope })
}

/** Writes a localized text, or clears the field when barsy holds no text. Returns whether text was written. */
function writeText(
  run: Run,
  link: SourceLink,
  fieldKey: string,
  value: LocalizedText,
  record: SourceRecordDescriptor,
): boolean {
  if (isEmptyText(value)) {
    clear(run, link, fieldKey, 'master')
    return false
  }
  write(run, link, fieldKey, 'master', value, record)
  return true
}

function warn(
  run: Run,
  code: MappingWarning['code'],
  externalType: MappingWarning['externalType'],
  externalId: string | null,
  detail?: string,
): void {
  run.warnings.push(
    detail === undefined
      ? { code, externalType, externalId }
      : { code, externalType, externalId, detail },
  )
}

/** Converts a barsy decimal (an integer or exact decimal text) to integer minor units; null if it is not a price. */
function minorOf(value: number | string): number | null {
  try {
    return decimalToMinor(decimalText(value))
  } catch (error) {
    if (error instanceof MoneyError) return null
    throw error
  }
}

function money(minor: number): { amount_minor: number; currency: typeof CURRENCY } {
  return { amount_minor: minor, currency: CURRENCY }
}

// --- sections -----------------------------------------------------------------------------

/** The section link of a category in this venue (plain, or qualified by the venue; CF-16). */
function sectionLinkOf(run: Run, catId: number): SourceLink {
  const qualified = run.input.qualifiedSections?.has(catId) === true
  return linkOf(run, 'category', sectionLinkId(catId, qualified ? run.input.venueId : null))
}

function mapSections(run: Run, plan: SectionsPlan): void {
  for (const section of plan.sections) {
    const category = section.node.category
    const externalId = String(section.catId)
    const link = sectionLinkOf(run, section.catId)
    // The record is barsy's category, shared by every venue that shows it.
    const record = describeSource(run.cfg.integrationId, 'category', externalId, 'master', category)
    run.sourceRecords.push(record)

    const parentLink = section.parentCatId === null ? null : sectionLinkOf(run, section.parentCatId)
    const parent: NodeRef = parentLink === null ? { id: run.input.menuId } : { link: parentLink }
    // The parent is part of the id: a category moved in barsy gets a new derived id, which apply()
    // collapses onto the node it is already linked to (instead of refusing the same id under a
    // new parent). Plain keys derive exactly the ids they did before CF-16.
    const parentKey =
      parentLink === null ? `menu:${run.input.menuId}` : `category:${parentLink.externalId}`
    createAndLink(run, 'section', link, parent, ['category', link.externalId, parentKey])

    const title = localizedText(category.cat_name_public_ml, category.cat_name_public, run.text)
    if (!writeText(run, link, 'title', title, record)) {
      warn(run, 'section_title_missing', 'category', externalId)
    }
    writeText(
      run,
      link,
      'description',
      localizedText(category.description_ml, null, run.text),
      record,
    )
  }
}

// --- items --------------------------------------------------------------------------------

interface ItemPlan {
  readonly article: Article
  readonly externalId: string
  readonly link: SourceLink
  readonly record: SourceRecordDescriptor
  /** Barsy ids of the sections the item is placed in, in tree order. */
  readonly sectionCatIds: readonly number[]
}

/** True if at least one of the values was part of the response (an extra property not asked for is absent). */
function provided(...values: unknown[]): boolean {
  return values.some((value) => value !== undefined)
}

/** What an article says about its picture. */
export type ArticlePicture =
  /** The response did not carry `picture` at all (not asked for): it says nothing. */
  | { readonly kind: 'absent' }
  /** `picture` is null or blank: the article has none. */
  | { readonly kind: 'none' }
  /** There is a picture, but its address is not a usable https URL. */
  | { readonly kind: 'invalid'; readonly pictureName: string }
  | { readonly kind: 'picture'; readonly pictureName: string; readonly url: string }

/**
 * Reads the picture of an article (or of a stored article record): the file name is `picture`, the
 * address is `picture_url`, or `picture` itself when that is a full URL. The mapper and the photo
 * job both call this, so the job can tell whether the address it was queued with is still the
 * article's current one.
 */
export function readArticlePicture(article: {
  readonly picture?: string | null | undefined
  readonly picture_url?: string | null | undefined
}): ArticlePicture {
  if (!provided(article.picture)) return { kind: 'absent' }
  const pictureName = article.picture?.trim() ?? ''
  if (pictureName === '') return { kind: 'none' }
  const candidate =
    (article.picture_url?.trim() ?? '') !== '' ? (article.picture_url ?? '').trim() : pictureName
  let url: URL | null = null
  try {
    url = new URL(candidate)
  } catch {
    url = null
  }
  if (url === null || url.protocol !== 'https:') return { kind: 'invalid', pictureName }
  return { kind: 'picture', pictureName, url: url.href }
}

/**
 * A picture barsy holds is asked for (the fetch job downloads it); a picture barsy no longer holds
 * clears the item's barsy image, so a removed picture does not stay in the menu. A manual photo
 * still wins by the field's combinator, which this does not touch. A response without `picture`
 * says nothing.
 */
function pictureRequest(run: Run, link: SourceLink, article: Article, externalId: string): void {
  const picture = readArticlePicture(article)
  switch (picture.kind) {
    case 'absent':
      return
    case 'none':
      clear(run, link, 'image', 'master')
      return
    case 'invalid':
      warn(run, 'picture_url_invalid', 'article', externalId)
      return
    case 'picture':
      run.assetRequests.push({
        articleExternalId: externalId,
        pictureName: picture.pictureName,
        url: picture.url,
      })
  }
}

function mapItemFields(run: Run, item: ItemPlan, allergenKey: string | null): void {
  const { article, externalId, link, record } = item

  if (provided(article.article_name_public_ml, article.article_name_public)) {
    const name = localizedText(
      article.article_name_public_ml,
      article.article_name_public,
      run.text,
    )
    if (!writeText(run, link, 'name', name, record))
      warn(run, 'item_name_missing', 'article', externalId)
  }
  if (provided(article.description_ml, article.description_public)) {
    const description = localizedText(article.description_ml, article.description_public, run.text)
    writeText(run, link, 'description', description, record)
  }

  const priceValue =
    run.cfg.priceSource === 'actual_price' ? article.actual_price : article.current_price
  const minor = priceValue === null || priceValue === undefined ? null : minorOf(priceValue)
  if (minor === null) {
    clear(run, link, 'price', run.venueScope)
    warn(
      run,
      priceValue === null || priceValue === undefined ? 'price_missing' : 'price_invalid',
      'article',
      externalId,
    )
  } else {
    write(run, link, 'price', run.venueScope, money(minor), record)
  }

  // The per-venue exception wins over the base flag (`is_for_sale_barsys` needs `limits_by_barsys`).
  const forSale = flagOf(article.is_for_sale_barsys?.[run.bid]) ?? flagOf(article.is_for_sale)
  if (forSale === null) clear(run, link, 'for_sale', run.venueScope)
  else write(run, link, 'for_sale', run.venueScope, forSale, record)

  const visible = flagOf(article.is_public)
  if (visible === null) clear(run, link, 'visible', 'master')
  else write(run, link, 'visible', 'master', visible, record)
  // The venue had hidden the item (it was outside the venue's root, CF-16): its root holds it again.
  if (run.input.venueHiddenArticles?.has(externalId) === true) {
    clear(run, link, 'visible', run.venueScope)
  }

  mapAllergens(run, item, allergenKey)
}

function mapAllergens(run: Run, item: ItemPlan, allergenKey: string | null): void {
  const { article, externalId, link, record } = item
  // No characteristic for allergens, or the property was not asked for: say nothing.
  if (allergenKey === null || article.article_details === undefined) return
  const raw = article.article_details?.[allergenKey]
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    clear(run, link, 'allergens', 'master')
    return
  }
  if (typeof raw !== 'string') {
    warn(run, 'allergen_detail_unreadable', 'article', externalId)
    return
  }
  const parsed = parseAllergenText(raw)
  for (const word of parsed.unknown) warn(run, 'allergen_unknown_word', 'article', externalId, word)
  // Text that names nothing we can read stays as it was: neither a claim nor a removal.
  if (parsed.allergens.length > 0) write(run, link, 'allergens', 'master', parsed.allergens, record)
}

// --- combos -------------------------------------------------------------------------------

function mapCombo(
  run: Run,
  item: ItemPlan,
  groups: readonly SupplementGroup[],
  publicNames: ReadonlyMap<number, { name: LocalizedText; record: SourceRecordDescriptor }>,
): { groups: number; options: number } {
  const articleId = item.externalId
  const comboRecord = describeSource(
    run.cfg.integrationId,
    'article_supplements',
    articleId,
    run.venueScope,
    groups,
  )
  run.sourceRecords.push(comboRecord)
  let groupCount = 0
  let optionCount = 0

  for (const group of uniqueBy(groups, (g) => g.supplement_group_id)) {
    const groupExternalId = `${articleId}:${group.supplement_group_id}`
    const groupLink = linkOf(run, 'supplement_group', groupExternalId)
    createAndLink(run, 'modifier_group', groupLink, { link: item.link }, [
      'supplement_group',
      articleId,
      String(group.supplement_group_id),
    ])
    groupCount += 1

    const groupName = group.supplement_group_name.trim()
    const name: LocalizedText = groupName === '' ? {} : { [run.cfg.defaultLocale]: groupName }
    writeText(run, groupLink, 'name', name, comboRecord)
    write(run, groupLink, 'min', 'master', flagOf(group.required) === true ? 1 : 0, comboRecord)
    const max = group.max_selected
    if (typeof max === 'number' && max >= 1) {
      write(run, groupLink, 'max', 'master', max, comboRecord)
    } else {
      clear(run, groupLink, 'max', 'master')
      warn(run, 'modifier_group_max_unknown', 'supplement_group', groupExternalId)
    }

    for (const option of uniqueBy(group.articles, (o) => o.article_id)) {
      const optionExternalId = `${groupExternalId}:${option.article_id}`
      const optionLink = linkOf(run, 'supplement', optionExternalId)
      createAndLink(run, 'option', optionLink, { link: groupLink }, [
        'supplement',
        articleId,
        String(group.supplement_group_id),
        String(option.article_id),
      ])
      optionCount += 1

      // The option's own name in the response is internal. The public name is the option article's.
      // A name is written only from the option article of this run's article list. An option
      // article that is not in the list (an incremental run holds only the changed articles, and a
      // supplement may sit outside the catalogue root) says nothing about the name: it is neither
      // written nor cleared, so a price change on a combo never wipes its option names (B1-F6).
      // The warning stays: this run could not name the option.
      const known = publicNames.get(option.article_id)
      if (known === undefined) {
        warn(run, 'option_name_missing', 'supplement', optionExternalId)
      } else if (isEmptyText(known.name)) {
        // The article is here and has no public name: barsy's value is gone, so ours goes too.
        clear(run, optionLink, 'name', 'master')
        warn(run, 'option_name_missing', 'supplement', optionExternalId)
      } else {
        write(run, optionLink, 'name', 'master', known.name, known.record)
      }

      const delta = option.supplement_price
      const minor = delta === null || delta === undefined ? 0 : minorOf(delta)
      if (minor === null) {
        clear(run, optionLink, 'price_delta', run.venueScope)
        warn(run, 'option_price_invalid', 'supplement', optionExternalId)
      } else {
        write(run, optionLink, 'price_delta', run.venueScope, money(minor), comboRecord)
      }
    }
  }
  return { groups: groupCount, options: optionCount }
}

// --- the run ------------------------------------------------------------------------------

/** Maps one venue's catalogue. Throws `BarsyMappingError` for a bad configuration or a missing catalogue root. */
export function mapCatalogue(input: CatalogueInput, config: MappingConfig): CatalogueMapping {
  const cfg = parseMappingConfig(config)
  assertInputIds(input)
  const run: Run = {
    input,
    cfg,
    text: {
      defaultLocale: cfg.defaultLocale,
      allowed: allowedLocales(input.languages, cfg.defaultLocale),
    },
    bid: String(input.bid),
    venueScope: `venue:${input.venueId}`,
    ops: [],
    warnings: [],
    sourceRecords: [],
    linkStates: [],
    assetRequests: [],
  }

  const plan = planSections(input.tree, cfg.catalogueRootCatId, run.warnings)
  mapSections(run, plan)

  // The article list in a fixed order (by id): its order is not data, so it must not matter.
  const articles = uniqueBy(
    [...input.articles].sort((a, b) => a.article_id - b.article_id),
    (article) => article.article_id,
  )
  if (articles.length < input.articles.length) {
    for (const id of duplicateIds(input.articles))
      warn(run, 'article_duplicate', 'article', String(id))
  }
  const records = new Map<number, SourceRecordDescriptor>()
  for (const article of articles) {
    const record = describeSource(
      cfg.integrationId,
      'article',
      String(article.article_id),
      run.venueScope,
      article,
    )
    records.set(article.article_id, record)
    run.sourceRecords.push(record)
  }

  const allergenKey = findAllergenKey(input.detailsTree, cfg.allergenDetailKey)
  if (allergenKey.key === null) warn(run, 'allergen_key_not_found', 'catalogue', null)
  if (allergenKey.ambiguous)
    warn(run, 'allergen_key_ambiguous', 'catalogue', null, allergenKey.candidates.join(','))

  let deletedArticles = 0
  let skippedServices = 0
  let outsideCatalogue = 0
  const items: ItemPlan[] = []
  for (const article of articles) {
    const externalId = String(article.article_id)
    const record = records.get(article.article_id)
    if (record === undefined) continue
    if (flagOf(article.delete_flag) === true) {
      run.linkStates.push({ linkType: 'article', externalId, state: 'deleted' })
      deletedArticles += 1
      continue
    }
    if (flagOf(article.is_service) === true && !cfg.includeServices) {
      skippedServices += 1
      continue
    }
    const categories = (article.categories ?? []).map(Number)
    const targets = new Set<number>()
    for (const catId of categories) {
      const section = plan.sectionOf.get(catId)
      if (section !== undefined) targets.add(section)
    }
    const sectionCatIds = [...targets].sort(
      (a, b) => (plan.indexOf.get(a) ?? 0) - (plan.indexOf.get(b) ?? 0),
    )
    if (sectionCatIds.length === 0) {
      if (categories.includes(cfg.catalogueRootCatId)) {
        warn(run, 'article_unplaced', 'article', externalId, 'sits directly in the catalogue root')
      } else {
        // Outside this venue's root: another venue's part of a shared catalogue, or no category of
        // the tree. Counted, not warned about: a whole-catalogue read holds many (CF-16).
        outsideCatalogue += 1
        continue
      }
    }
    items.push({
      article,
      externalId,
      link: linkOf(run, 'article', externalId),
      record,
      sectionCatIds,
    })
  }

  for (const item of items) {
    createAndLink(run, 'item', item.link, null, ['article', item.externalId])
    mapItemFields(run, item, allergenKey.key)
    pictureRequest(run, item.link, item.article, item.externalId)
  }

  // Placements: sections in tree order, items by id within a section ("barsy's own order": the
  // category's weight, then the article id). 'end' + onlyIfUnplaced: a new item lands at the end
  // of its section and a re-sync never reorders what the manager arranged (D20).
  const itemsOfSection = new Map<number, ItemPlan[]>()
  for (const item of items) {
    for (const catId of item.sectionCatIds) {
      const list = itemsOfSection.get(catId) ?? []
      list.push(item)
      itemsOfSection.set(catId, list)
    }
  }
  let placements = 0
  for (const section of plan.sections) {
    for (const item of itemsOfSection.get(section.catId) ?? []) {
      run.ops.push({
        op: 'setPlacement',
        item: { link: item.link },
        section: { link: sectionLinkOf(run, section.catId) },
        sortKey: 'end',
        onlyIfUnplaced: true,
      })
      placements += 1
    }
  }

  // Combos. An option's public name is its own article's.
  const publicNames = new Map<number, { name: LocalizedText; record: SourceRecordDescriptor }>()
  for (const article of articles) {
    const record = records.get(article.article_id)
    if (record === undefined) continue
    publicNames.set(article.article_id, {
      name: localizedText(article.article_name_public_ml, article.article_name_public, run.text),
      record,
    })
  }
  let modifierGroups = 0
  let options = 0
  const mappedIds = new Set(items.map((item) => item.externalId))
  for (const item of items) {
    const groups = input.supplementsByArticle[item.externalId]
    if (groups === undefined || groups.length === 0) continue
    const counted = mapCombo(run, item, groups, publicNames)
    modifierGroups += counted.groups
    options += counted.options
  }
  for (const key of Object.keys(input.supplementsByArticle).sort()) {
    if (!mappedIds.has(key)) warn(run, 'supplements_for_unmapped_article', 'article', key)
  }

  const counts: CatalogueCounts = {
    sections: plan.sections.length,
    items: items.length,
    modifierGroups,
    options,
    placements,
    deletedArticles,
    skippedServices,
    outsideCatalogue,
  }
  return {
    changeSet: buildChangeSet(run),
    sourceRecords: run.sourceRecords,
    assetRequests: run.assetRequests,
    linkStates: run.linkStates,
    warnings: run.warnings,
    counts,
  }
}

function duplicateIds(articles: readonly Article[]): number[] {
  const seen = new Set<number>()
  const duplicates = new Set<number>()
  for (const article of articles) {
    if (seen.has(article.article_id)) duplicates.add(article.article_id)
    seen.add(article.article_id)
  }
  return [...duplicates].sort((a, b) => a - b)
}

function buildChangeSet(run: Run): ChangeSet | null {
  if (run.ops.length === 0) return null
  const { cfg, input, ops } = run
  return {
    id: deriveId('cs', cfg.jobId, input.venueId, sha256Hex(canonicalJson(ops))),
    source: tillSource(cfg.integrationId),
    jobId: cfg.jobId,
    actor: cfg.actor,
    observedAt: cfg.observedAt,
    ops,
  }
}
