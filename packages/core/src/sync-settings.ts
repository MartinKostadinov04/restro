// The sync settings (brief S3-04, decision D59): when barsy is read and whether a sync goes live by
// itself. Since CF-09b (D73) they live in two places:
//
//   the integration's `config.schedule`, one schedule for the whole installation:
//     incremental_enabled, incremental_minutes, full_pull_enabled, full_pull_time,
//     time_zone (CF-16: the zone of the daily full read; default Europe/Sofia)
//   the venue's `settings.publish`, the publishing rules of each venue:
//     after_sync (auto | manual), new_items (show | hold)
//
// A venue that has no value of its own reads the integration's `config.publish` of before CF-09b
// (and, below that, the old flat key and the defaults), so nothing changes for a venue until
// someone saves its rules; the integration's copy is never written any more.
//
// The web app writes them (Settings -> Integrations, the venue's Publishing tab) and the worker
// reads them, both through this module, so a value can never mean two things. Reading is
// forgiving, writing is strict: a missing or unknown value falls back to the default FOR THAT
// SETTING (an old or hand-edited config never stops a sync), while the form's input
// (`SyncSettingsInputSchema`, `VenuePublishRulesSchema`) refuses anything outside the lists. The
// defaults are what ran before the settings existed: a change check every 5 minutes, a full pull
// daily at 12:00, and every sync publishes.
//
// Pure: no I/O, no clock.

import { z } from 'zod'

/** The intervals of the change check, in minutes. */
export const INCREMENTAL_MINUTES = [1, 5, 10, 15, 30] as const
export type IncrementalMinutes = (typeof INCREMENTAL_MINUTES)[number]

/** After a sync: publish by itself (`auto`) or wait for a person to press Publish (`manual`). */
export const AFTER_SYNC_MODES = ['auto', 'manual'] as const
export type AfterSyncMode = (typeof AFTER_SYNC_MODES)[number]

/** New items from barsy: shown at once (`show`) or hidden until a manager shows them (`hold`). */
export const NEW_ITEMS_MODES = ['show', 'hold'] as const
export type NewItemsMode = (typeof NEW_ITEMS_MODES)[number]

/** `HH:mm`, 24-hour, venue local time. */
export const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

/** What runs when nothing is set. */
export const SYNC_DEFAULTS = {
  schedule: {
    incremental_enabled: true,
    incremental_minutes: 5,
    full_pull_enabled: true,
    full_pull_time: '12:00',
  },
  publish: { after_sync: 'auto', new_items: 'show' },
} as const satisfies {
  schedule: ScheduleSettings
  publish: PublishSettings
}

export interface ScheduleSettings {
  readonly incremental_enabled: boolean
  readonly incremental_minutes: IncrementalMinutes
  readonly full_pull_enabled: boolean
  /** `HH:mm` in the venue's time zone. */
  readonly full_pull_time: string
}

/** The publishing rules of a venue (or, from before CF-09b, of an integration). */
export interface PublishSettings {
  readonly after_sync: AfterSyncMode
  readonly new_items: NewItemsMode
}

export interface SyncSettings {
  readonly schedule: ScheduleSettings
  readonly publish: PublishSettings
}

const IncrementalMinutesSchema = z.union([
  z.literal(1),
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(30),
])
const ClockTimeSchema = z.string().regex(CLOCK_TIME_PATTERN)
const AfterSyncSchema = z.enum(AFTER_SYNC_MODES)
const NewItemsSchema = z.enum(NEW_ITEMS_MODES)

/**
 * What the automatic-sync form sends: the schedule, each setting from its list. Unknown keys are
 * refused. The publishing rules are not part of it any more (CF-09b): they are per venue, see
 * `VenuePublishRulesSchema`.
 */
export const SyncSettingsInputSchema = z.strictObject({
  schedule: z.strictObject({
    incremental_enabled: z.boolean(),
    incremental_minutes: IncrementalMinutesSchema,
    full_pull_enabled: z.boolean(),
    full_pull_time: ClockTimeSchema,
  }),
})
export type SyncSettingsInput = z.output<typeof SyncSettingsInputSchema>

/** What the venue's Rules card sends: both rules, each from its list. Unknown keys are refused. */
export const VenuePublishRulesSchema = z.strictObject({
  after_sync: AfterSyncSchema,
  new_items: NewItemsSchema,
})
export type VenuePublishRules = z.output<typeof VenuePublishRulesSchema>

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** `value` when it passes `schema`, else `fallback`. */
function orDefault<S extends z.ZodType>(schema: S, value: unknown, fallback: z.output<S>) {
  const parsed = schema.safeParse(value)
  return parsed.success ? (parsed.data as z.output<S>) : fallback
}

/**
 * The sync settings of an integration's `config`, with the default for every missing or unknown
 * value. Never throws. `config.publish_after_sync = false`, the flat key S3-01b read before these
 * settings existed, still means `manual` when `publish.after_sync` itself is not set.
 *
 * The `publish` part is the integration's OLD publishing rule (before CF-09b made it per venue):
 * nothing writes it any more, and it is only what a venue without rules of its own inherits. Ask
 * `venuePublishRules` what applies to a venue.
 */
export function parseSyncSettings(config: unknown): SyncSettings {
  const root = record(config)
  const schedule = record(root.schedule)
  const publish = record(root.publish)
  const defaults = SYNC_DEFAULTS
  const legacyAfterSync: AfterSyncMode =
    root.publish_after_sync === false ? 'manual' : defaults.publish.after_sync
  return {
    schedule: {
      incremental_enabled: orDefault(
        z.boolean(),
        schedule.incremental_enabled,
        defaults.schedule.incremental_enabled,
      ),
      incremental_minutes: orDefault(
        IncrementalMinutesSchema,
        schedule.incremental_minutes,
        defaults.schedule.incremental_minutes,
      ),
      full_pull_enabled: orDefault(
        z.boolean(),
        schedule.full_pull_enabled,
        defaults.schedule.full_pull_enabled,
      ),
      full_pull_time: orDefault(
        ClockTimeSchema,
        schedule.full_pull_time,
        defaults.schedule.full_pull_time,
      ),
    },
    publish: {
      after_sync: orDefault(AfterSyncSchema, publish.after_sync, legacyAfterSync),
      new_items: orDefault(NewItemsSchema, publish.new_items, defaults.publish.new_items),
    },
  }
}

/** The zone the daily full read is timed in when the integration names none (D73). */
export const SYNC_TIME_ZONE_DEFAULT = 'Europe/Sofia'

/** True for a time zone this runtime knows (an IANA name such as `Europe/Sofia`). */
function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

/**
 * The time zone of an integration's schedule (brief CF-16, D73: one schedule per integration):
 * `config.schedule.time_zone` when it names a zone this runtime knows, else Europe/Sofia. The daily
 * full read is timed in it, whatever the time zones of the integration's venues. Never throws.
 */
export function syncTimeZone(config: unknown): string {
  const zone = record(record(config).schedule).time_zone
  return isTimeZone(zone) ? zone : SYNC_TIME_ZONE_DEFAULT
}

/**
 * The publishing rules the venue has set itself (`venues.settings.publish`): each is null when the
 * venue has no valid value of its own. Never throws.
 */
export function venueOwnPublishRules(venueSettings: unknown): {
  readonly after_sync: AfterSyncMode | null
  readonly new_items: NewItemsMode | null
} {
  const own = record(record(venueSettings).publish)
  const afterSync = AfterSyncSchema.safeParse(own.after_sync)
  const newItems = NewItemsSchema.safeParse(own.new_items)
  return {
    after_sync: afterSync.success ? afterSync.data : null,
    new_items: newItems.success ? newItems.data : null,
  }
}

/**
 * The publishing rules that apply to a venue (D73, CF-04): its own value for each rule, else the
 * integration's current one (`config.publish`, then the S3-01b flat key, then the default). So a
 * venue that never saved its rules behaves exactly as before CF-09b. Never throws.
 */
export function venuePublishRules(
  venueSettings: unknown,
  integrationConfig: unknown,
): PublishSettings {
  const own = venueOwnPublishRules(venueSettings)
  const inherited = parseSyncSettings(integrationConfig).publish
  return {
    after_sync: own.after_sync ?? inherited.after_sync,
    new_items: own.new_items ?? inherited.new_items,
  }
}

/** Whether a sync that changed something publishes this venue's menu on its own. */
export function venuePublishesAfterSync(
  venueSettings: unknown,
  integrationConfig: unknown,
): boolean {
  return venuePublishRules(venueSettings, integrationConfig).after_sync === 'auto'
}

/** Whether new items from the till are hidden in this venue until a manager shows them. */
export function venueHoldsNewItems(venueSettings: unknown, integrationConfig: unknown): boolean {
  return venuePublishRules(venueSettings, integrationConfig).new_items === 'hold'
}

/**
 * Whether automatic publishing is paused (brief S3-05): `config.publish.auto_paused` is `true`
 * after someone returned the menu to an older version, and until a person publishes again. It is
 * not a setting of the form (the sync settings form never writes it, and keeps it when it saves);
 * the Publish tab sets it and a manual publish clears it. Anything but `true` means not paused.
 */
export function autoPublishPaused(config: unknown): boolean {
  return record(record(config).publish).auto_paused === true
}
