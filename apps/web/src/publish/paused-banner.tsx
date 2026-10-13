'use client'

// After a return to an older version, automatic publishing is paused (the next sync would publish
// the draft and undo the return). The banner says so and what ends it: a publish, or "Resume
// automatic publishing", which lifts the pause without publishing anything (D96).
import { PauseCircleIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { resumeAutoPublishAction } from '@/server/publish/actions'
import type { PublishActionError } from '@/server/publish/service'

export function PausedBanner({ venueId, canPublish }: { venueId: string; canPublish: boolean }) {
  const t = useTranslations('publish.paused')
  const errors = useTranslations('publish.errors')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<PublishActionError | null>(null)

  function resume() {
    setError(null)
    startTransition(async () => {
      const result = await resumeAutoPublishAction(venueId)
      // On success the page is refreshed and the banner leaves.
      if (!result.ok) setError(result.error)
    })
  }

  return (
    <section
      aria-labelledby="paused-title"
      className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4 sm:flex-row sm:items-start"
      data-testid="paused-banner"
    >
      <PauseCircleIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-warning" />
      <div className="grid flex-1 gap-1">
        <h3 id="paused-title" className="font-medium">
          {t('title')}
        </h3>
        <p className="text-sm text-muted-foreground">{t('text')}</p>
        {error !== null ? (
          <p role="alert" className="text-sm text-destructive">
            {errors(error)}
          </p>
        ) : null}
      </div>
      {canPublish ? (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={resume}
          data-testid="paused-resume"
        >
          {pending ? t('resuming') : t('resume')}
        </Button>
      ) : null}
    </section>
  )
}
