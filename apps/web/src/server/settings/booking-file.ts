// The booking file's job (#577): a settings change that changes what the venue's booking page shows
// (the online booking switch, a closed date, the service hours) queues `publish-booking` in its own
// transaction (`queueJobs`, the outbox pattern of #592), so the file is rewritten whenever the
// change is saved, and never for a change that was not. The worker writes the file only when its
// bytes differ, so a job for a change that moved nothing on the page costs one read.
import { JOB_NAMES, type TenantId, type VenueId } from '@restro/core'
import type { ServiceOptions } from '@restro/core/service'

import { enqueueJobIn } from '../jobs'

/** The service options that queue the venue's booking file with an accepted change. */
export function queueBookingFile(scope: {
  readonly tenantId: string
  readonly venueId: string
}): ServiceOptions {
  return {
    queueJobs: async (_result, queue) => {
      await enqueueJobIn(queue, JOB_NAMES.publishBooking, {
        // The settings scope checked both ids against the signed-in person's organisation.
        tenantId: scope.tenantId as TenantId,
        venueId: scope.venueId as VenueId,
      })
    },
  }
}
