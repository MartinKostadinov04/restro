'use client'

// The two answers to an Unconfirmed sent order, "Found on the bill" and "Not on the bill" (screen
// 1's S8; sent-orders plan §3: "same component, same strings"), used on a "Needs you" row, in a
// sent order's sheet and on the end-of-night page. Both sit at equal weight, both outline: neither
// is a default (screen 1 §4, Q9). A shared device asks the person's own PIN, which is also the
// confirmation of what it will record; a role that may not answer sees no button at all.
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { WRAPS_WIDE } from '@/lib/wrapping'
import { answerSentOrderAction } from '@/server/tonight/actions'
import type { TonightView } from '@/server/tonight/view'

import { useTonightRun } from './run'

/** What the answers need to know of the screen. */
export type AnswerFrame = Pick<TonightView, 'venueId' | 'device'> & {
  readonly can: Pick<TonightView['can'], 'answer'>
}

export function SentOrderAnswers({
  frame,
  sentOrderId,
  table,
  onDone,
}: {
  frame: AnswerFrame
  sentOrderId: string
  /** The table as the screen words it ("Table 7"), for the consequence the PIN sheet names. */
  table: string
  /** Called after an answer was saved: the list reads again. */
  onDone?: () => void
}) {
  const t = useTranslations('tonight')
  const { run, busy } = useTonightRun()
  if (!frame.can.answer && !frame.device) return null

  const choose = (value: 'found' | 'not_found') =>
    run({
      id: `answer:${sentOrderId}`,
      ...(frame.device
        ? {
            pin: {
              level: 'own' as const,
              title: t(value === 'found' ? 's_ok' : 's_no'),
              body: t(value === 'found' ? 's_ok_b' : 's_no_b', { table }),
            },
          }
        : {}),
      act: async (pin) => {
        const result = await answerSentOrderAction({
          venueId: frame.venueId,
          sentOrderId,
          answer: value,
          pin,
        })
        if (result.ok) onDone?.()
        return result
      },
      done: t(value === 'found' ? 's_ok_toast' : 's_no_toast'),
    })

  const button = WRAPS_WIDE
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={button}
        disabled={busy}
        onClick={() => choose('found')}
      >
        {t('s_ok')}
      </Button>
      <Button
        type="button"
        variant="outline"
        className={button}
        disabled={busy}
        onClick={() => choose('not_found')}
      >
        {t('s_no')}
      </Button>
    </>
  )
}
