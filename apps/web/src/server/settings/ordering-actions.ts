'use server'

// The Hours and Ordering sections' server action (#87): one thin wrapper over `settings.ordering_set`.
// The change names only the keys it changes; the service write path merges them into the saved
// settings, checks the hours against the venue's service day, needs `settings.guards` and a sign-in
// of the last 15 minutes, and writes one `settings.changed` `record` Log entry.
import { idSchema } from '@restro/core'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { INVALID, inSettingsScope, runSettingsCommand, type SettingsResult } from './scope'

const Save = z.strictObject({
  venueId: idSchema('vn'),
  /** The keys to change; the service path checks each (strict, with its ranges). */
  changes: z.record(z.string(), z.unknown()),
})

/** Saves some of the venue's hours and ordering rules. */
export async function saveOrderingAction(input: unknown): Promise<SettingsResult> {
  const parsed = Save.safeParse(input)
  if (!parsed.success) return INVALID
  return inSettingsScope(parsed.data.venueId, async (scope) => {
    const result = await runSettingsCommand(scope, {
      type: 'settings.ordering_set',
      changes: parsed.data.changes,
    })
    if (result.ok) revalidatePath(`/venues/${scope.venueId}`)
    return result
  })
}
