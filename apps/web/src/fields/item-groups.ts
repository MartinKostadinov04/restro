/**
 * The groups the item's rows are divided into (the Platform's `category` pills), in the order
 * the item sheet and the /dev/fields preview show them. A group lists field keys in template
 * order; item-groups.test.ts proves that every Item field of the default template is in exactly
 * one group, so a field added to the template cannot silently vanish from the sheet.
 */
export const ITEM_GROUPS = [
  { id: 'content', keys: ['name', 'description', 'image'] },
  { id: 'pricing', keys: ['price', 'portion', 'abv'] },
  { id: 'attributes', keys: ['allergens', 'dietary', 'tags'] },
  { id: 'ordering', keys: ['availability', 'order_mode', 'for_sale', 'visible'] },
  { id: 'internal', keys: ['internal_note'] },
] as const

/** The id of one of the item groups. */
export type ItemGroupId = (typeof ITEM_GROUPS)[number]['id']
