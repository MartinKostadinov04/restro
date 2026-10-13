// Places (tables) and modificators (kitchen requests): descriptors only. Both are stored by
// S2-03; neither becomes a node in v1 (a place is a table for ordering later, a modificator is
// shown only if the builder enables requests).

import type { IntegrationId, VenueId } from '@restro/core'

import type { Modificator, Place } from '../read/schemas.ts'
import { describeSource } from './source-records.ts'
import type { PlaceDescriptor, SourceRecordDescriptor } from './types.ts'
import { flagOf, uniqueBy } from './util.ts'

export interface PlacesContext {
  readonly integrationId: IntegrationId
  /** Our venue: a place is read per barsy venue, so its record is venue-scoped. */
  readonly venueId: VenueId
}

function text(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * `Places_getlist` → place descriptors, ordered by place id. `place_num` is documented as an int
 * but the demo returns text ("VIP", "Бар"): it is kept as text. A place is public only when barsy
 * says so (a missing flag means not public).
 */
export function mapPlaces(places: readonly Place[], context: PlacesContext): PlaceDescriptor[] {
  const scope = `venue:${context.venueId}` as const
  const ordered = uniqueBy(
    [...places].sort((a, b) => a.place_id - b.place_id),
    (place) => place.place_id,
  )
  return ordered.map((place) => ({
    placeId: String(place.place_id),
    placeNum:
      place.place_num === null || place.place_num === undefined ? null : String(place.place_num),
    salonId:
      place.salon_id === null || place.salon_id === undefined ? null : String(place.salon_id),
    salonWeight:
      place.salon_weight === null || place.salon_weight === undefined
        ? null
        : Number.isSafeInteger(Number(place.salon_weight))
          ? Number(place.salon_weight)
          : null,
    salonName: text(place.salon_name),
    isPublic: flagOf(place.is_public) === true,
    sourceRecord: describeSource(
      context.integrationId,
      'place',
      String(place.place_id),
      scope,
      place,
    ),
  }))
}

/**
 * `Modificators_getlist` → source-record descriptors, ordered by modificator id. No nodes in v1:
 * they are kitchen requests ("без лук") and stay in tier 1 until a builder enables them.
 */
export function mapModificators(
  modificators: readonly Modificator[],
  context: { readonly integrationId: IntegrationId },
): SourceRecordDescriptor[] {
  const ordered = uniqueBy(
    [...modificators].sort((a, b) => a.mod_id - b.mod_id),
    (mod) => mod.mod_id,
  )
  return ordered.map((mod) =>
    describeSource(context.integrationId, 'modificator', String(mod.mod_id), 'master', mod),
  )
}
