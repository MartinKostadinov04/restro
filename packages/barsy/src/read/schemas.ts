// Response schemas for the nine read methods (CLAUDE.md rule 7: read-only). Built from the demo
// recordings in fixtures/demo/ (real responses) and the method notes in ../read-methods.ts.
//
// Strict on the fields the mapping uses, loose (`looseObject`) on everything else, so a field we
// do not use can change without breaking a pull but a field we do use cannot arrive in a shape we
// did not expect. The schemas validate and never transform: what they return is what barsy sent
// (after `parseBarsyJson`), so a source record built from it is faithful.
//
// Numbers: `parseBarsyJson` hands over a safe integer as a `number` and anything else (2.40, 1e2,
// a very long integer) as the exact `DecimalString`, so a price is `number | DecimalString`.
// Flags are 0/1 in every recording; a boolean is accepted as well.

import { z } from 'zod'

import { decimalStringSchema } from '../json.ts'

/** A JSON number as `parseBarsyJson` returns it: a safe integer, or the exact text of anything else. */
export const barsyNumberSchema = z.union([z.int(), decimalStringSchema])
export type BarsyNumber = z.output<typeof barsyNumberSchema>

/** barsy's 0/1 flags. */
const flagSchema = z.union([z.literal(0), z.literal(1), z.boolean()])

/**
 * A flag inside the per-venue for-sale exceptions: the catalogue recordings send them as text
 * (`{"1":"1","10":"1"}`, fixtures/demo/articles-bid*-menu72.json), so "0" and "1" are accepted
 * too (brief CF-16; before, one such article failed the whole page).
 */
const venueFlagSchema = z.union([flagSchema, z.literal('0'), z.literal('1')])

/** Text per barsy language key. Empty string and null both mean "no text in that language". */
const mlTextSchema = z.record(z.string(), z.string().nullable())

/** `Barsys_getlist` → venues of the installation (the mapping needs only the ids and the roots). */
export const venueSchema = z.looseObject({
  barsy_id: z.int(),
  name: z.string(),
  /** The venue's till catalogue root (demo bid 10: 1091). */
  cat_id: z.int().nullish(),
  /** The venue's public menu root (demo bid 10: 1171). */
  public_cat_id: z.int().nullish(),
  menu_id: z.int().nullish(),
  delete_flag: flagSchema.nullish(),
})
export type Venue = z.output<typeof venueSchema>
export const venuesSchema = z.array(venueSchema)

/** `Languages_getlist`. The demo returns `sr_RS@latin`; the mapping normalises it to `sr_RS`. */
export const languageSchema = z.looseObject({
  lang_id: z.string().min(1),
  lang_name: z.string(),
})
export type Language = z.output<typeof languageSchema>
export const languagesSchema = z.array(languageSchema)

/** `Currencies_getlist`. */
export const currencySchema = z.looseObject({
  currency_id: z.int(),
  currency_code: z.string().min(1),
  is_current: flagSchema.nullish(),
})
export type Currency = z.output<typeof currencySchema>
export const currenciesSchema = z.array(currencySchema)

/** The category object inside a tree node. The virtual root has `cat_id: null`. */
export const categorySchema = z.looseObject({
  cat_id: z.int().nullable(),
  parent_id: z.int().nullable(),
  /** Internal name: never shown to guests. */
  cat_name: z.string(),
  cat_name_public: z.string().nullish(),
  cat_name_public_ml: mlTextSchema.nullish(),
  description_ml: mlTextSchema.nullish(),
})
export type Category = z.output<typeof categorySchema>

/** A kitchen request ("modificator") as the category tree lists it. */
const treeModificatorSchema = z.looseObject({
  mod_id: z.int(),
  mod_name: z.string(),
})

/** One node of `Categories_getalltree`: a category with its children (the response is one root node). */
export interface CategoryTreeNode {
  category: Category
  categories: CategoryTreeNode[]
  /** Null in lazy mode, which is what the pull asks for. */
  articles?: unknown[] | null | undefined
  modificators?: z.output<typeof treeModificatorSchema>[] | null | undefined
}

export const categoryTreeNodeSchema: z.ZodType<CategoryTreeNode> = z.lazy(() =>
  z.looseObject({
    category: categorySchema,
    categories: z.array(categoryTreeNodeSchema),
    articles: z.array(z.unknown()).nullish(),
    modificators: z.array(treeModificatorSchema).nullish(),
  }),
)

/** A barsy category id as an article lists them: demo responses use strings (`["370"]`). */
const categoryIdSchema = z.union([z.int(), z.string().regex(/^\d+$/)])

/** `Articles_getlist` → one article. `article_name` is internal and never shown to guests. */
export const articleSchema = z.looseObject({
  article_id: z.int(),
  article_name: z.string(),
  article_name_public: z.string().nullish(),
  article_name_public_ml: mlTextSchema.nullish(),
  description_public: z.string().nullish(),
  description_ml: mlTextSchema.nullish(),
  /** Base price (decimal). Which of the two feeds `price` is the open decision P52. */
  actual_price: barsyNumberSchema.nullish(),
  /** Price after price rules. */
  current_price: barsyNumberSchema.nullish(),
  is_public: flagSchema.nullish(),
  is_for_sale: flagSchema.nullish(),
  /** Per-venue for-sale exceptions, keyed by barsy venue id (only with `limits_by_barsys`). */
  is_for_sale_barsys: z.record(z.string(), venueFlagSchema.nullable()).nullish(),
  is_service: flagSchema.nullish(),
  delete_flag: flagSchema.nullish(),
  /** File name inside barsy, or (some demo articles) a full image URL. */
  picture: z.string().nullish(),
  picture_url: z.string().nullish(),
  categories: z.array(categoryIdSchema).nullish(),
  /** Characteristics by key (`k102`); empty in every demo recording, so the value shape is unconfirmed. */
  article_details: z.record(z.string(), z.unknown()).nullish(),
  has_supplements: flagSchema.nullish(),
  /** The catalogue the article belongs to (brief CF-16, T71): venues can share a catalogue. */
  menu_id: z.int().nullish(),
})
export type Article = z.output<typeof articleSchema>
export const articlesSchema = z.array(articleSchema)

/** `Articlesupplements_get` → one option of a group. The name is internal. */
export const supplementOptionSchema = z.looseObject({
  article_id: z.int(),
  article_name: z.string(),
  /** Price delta (decimal), often 0. */
  supplement_price: barsyNumberSchema.nullish(),
})
export type SupplementOption = z.output<typeof supplementOptionSchema>

/** `Articlesupplements_get` → one option group of a combo article. */
export const supplementGroupSchema = z.looseObject({
  supplement_group_id: z.int(),
  supplement_group_name: z.string(),
  required: flagSchema.nullish(),
  max_selected: z.int().nullish(),
  articles: z.array(supplementOptionSchema),
})
export type SupplementGroup = z.output<typeof supplementGroupSchema>
export const supplementsSchema = z.array(supplementGroupSchema)

/** `Modificators_getlist` → a kitchen request ("без лук"). */
export const modificatorSchema = z.looseObject({
  mod_id: z.int(),
  mod_name: z.string(),
  description: z.string().nullish(),
})
export type Modificator = z.output<typeof modificatorSchema>
export const modificatorsSchema = z.array(modificatorSchema)

/** `Articledetails_gettree` → characteristic groups with their keys (`k102` = "Алергени" in the demo). */
export const articleDetailsGroupSchema = z.looseObject({
  group_id: z.int(),
  group_name: z.string(),
  details: z.record(
    z.string(),
    z.looseObject({
      detail_name: z.string(),
      type: z.string().nullish(),
    }),
  ),
})
export type ArticleDetailsGroup = z.output<typeof articleDetailsGroupSchema>
export const articleDetailsTreeSchema = z.array(articleDetailsGroupSchema)

/** `Places_getlist` → a table/place. `place_num` is documented as int but the demo returns text. */
export const placeSchema = z.looseObject({
  place_id: z.int(),
  place_num: z.union([z.string(), z.int()]).nullish(),
  salon_name: z.string().nullish(),
  is_public: flagSchema.nullish(),
})
export type Place = z.output<typeof placeSchema>
export const placesSchema = z.array(placeSchema)
