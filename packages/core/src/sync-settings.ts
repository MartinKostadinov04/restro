// The sync settings of an integration (brief S3-04, decision D59): when barsy is read and whether
// a sync goes live by itself. They live in the integration's `config`, in two objects:
//
//   config.schedule  incremental_enabled, incremental_minutes, full_pull_enabled, full_pull_time
//   config.publish   after_sync (auto | manual), new_items (show | hold)
//
// The web app writes them (Integration tab) and the worker reads them, both through this module,
// so a value can never mean two things. Reading is forgiving, writing is strict: a missing or
// unknown value in the stored config falls back to the default FOR THAT SETTING (an old or
// hand-edited config never stops a sync), while the form's input (`SyncSettingsInputSchema`)
// refuses anything outside the lists. The defaults are what ran before the settings existed:
// a change check every 5 minutes, a full pull daily at 12:00, and every sync publishes.
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

/** What the settings form sends: every setting, each from its list. Unknown keys are refused. */
export const SyncSettingsInputSchema = z.strictObject({
  schedule: z.strictObject({
    incremental_enabled: z.boolean(),
    incremental_minutes: IncrementalMinutesSchema,
    full_pull_enabled: z.boolean(),
    full_pull_time: ClockTimeSchema,
  }),
  publish: z.strictObject({
    after_sync: AfterSyncSchema,
    new_items: NewItemsSchema,
  }),
})
export type SyncSettingsInput = z.output<typeof SyncSettingsInputSchema>

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

/** Whether a sync that changed something publishes on its own. */
export function publishesAfterSync(config: unknown): boolean {
  return parseSyncSettings(config).publish.after_sync === 'auto'
}

/** Whether new items from barsy are hidden until a manager shows them. */
export function holdsNewItems(config: unknown): boolean {
  return parseSyncSettings(config).publish.new_items === 'hold'
}
