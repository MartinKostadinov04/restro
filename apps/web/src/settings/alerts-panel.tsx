'use client'

// Settings › Alerts (#87, plan `2026-10-27-settings-alerts-export-plan.md` §A): whose phones ring
// (a switch per person who has their own account), the venue's Telegram group linked from a button
// (Telegram opens, the owner picks the group, the bot joins and Restro notices by itself), and who
// may press Done in the group (each person links their own Telegram by scanning a QR). The writes are
// `settings.alerts_set` and the worker's Telegram link; each change is a `record` Log entry.
import { EllipsisIcon, ExternalLinkIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import {
  type LinkResult,
  linkGroupAction,
  linkPersonAction,
  setRecipientsAction,
  testTelegramAction,
  unlinkGroupAction,
  unlinkPersonAction,
} from '@/server/settings/alerts-actions'
import type { AlertPersonView, AlertsView } from '@/server/settings/alerts-view'
import { QrPicture } from '@/tables/qr-picture'

import { useSettingsRun } from './use-settings-run'

/** How often a waiting link looks for the bot having joined. */
const WATCH_MS = 3_000

/** Looks at the page again until `until` is true (or `endsAt` passes), while a link is waiting. */
function useWatch(active: boolean, until: boolean, endsAt: number | null, onEnd: () => void) {
  const router = useRouter()
  useEffect(() => {
    if (!active) return
    if (until) {
      onEnd()
      return
    }
    const timer = setInterval(() => {
      if (endsAt !== null && Date.now() >= endsAt) {
        clearInterval(timer)
        onEnd()
        return
      }
      router.refresh()
    }, WATCH_MS)
    return () => clearInterval(timer)
  }, [active, until, endsAt, onEnd, router])
}

export function AlertsPanel({ view }: { view: AlertsView }) {
  const t = useTranslations('ownerSettings')
  const runner = useSettingsRun(view.email)
  const { pending, run } = runner
  const withAccount = view.people.filter((person) => person.userId !== null)

  function setTicked(person: AlertPersonView, on: boolean) {
    if (person.userId === null) return
    const before = [...view.recipientIds]
    const after = on
      ? [...new Set([...before, person.userId])]
      : before.filter((id) => id !== person.userId)
    run(() => setRecipientsAction({ venueId: view.venueId, userIds: after }), {
      done: t('st_saved'),
      undo: () => setRecipientsAction({ venueId: view.venueId, userIds: before }),
    })
  }

  return (
    <div className="grid gap-8" data-testid="alerts-panel" aria-busy={pending}>
      <h2 className="text-xl font-semibold tracking-tight">{t('al_title')}</h2>

      <section className="grid gap-3" aria-labelledby="alerts-phones">
        <div>
          <h3 id="alerts-phones" className="text-lg font-medium">
            {t('al_phones')}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{t('al_phones_line')}</p>
        </div>
        {view.people.length === 0 ? (
          <p className="text-sm" data-testid="alerts-no-staff">
            {view.canUnlinkPerson ? (
              <Link
                href={`/venues/${view.venueId}?tab=settings&section=staff`}
                className="underline underline-offset-2"
              >
                {t('al_no_staff')}
              </Link>
            ) : (
              t('al_no_staff')
            )}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card" data-testid="alerts-people">
            {withAccount.map((person) => (
              <li key={person.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <div className="min-w-0 flex-1 basis-48">
                  <p className="break-words font-medium">{person.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {person.devices > 0
                      ? t('al_devices', { n: person.devices })
                      : t('al_no_device')}
                  </p>
                </div>
                <Switch
                  checked={person.ticked}
                  disabled={pending}
                  aria-label={person.name}
                  onCheckedChange={(on) => setTicked(person, on)}
                />
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-muted-foreground" data-testid="alerts-money-line">
          {t('al_money_line')}
        </p>
      </section>

      <TelegramGroup view={view} runner={runner} />
      {view.telegram.state === 'linked' ? (
        <DoneFromTelegram view={view} people={withAccount} runner={runner} />
      ) : null}
      {runner.dialog}
    </div>
  )
}

type Runner = ReturnType<typeof useSettingsRun>

function TelegramGroup({ view, runner }: { view: AlertsView; runner: Runner }) {
  const t = useTranslations('ownerSettings')
  const { pending, run } = runner
  const [waiting, setWaiting] = useState<{ url: string; endsAt: number } | null>(null)
  const [ranOut, setRanOut] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const linked = view.telegram.state === 'linked'

  useWatch(waiting !== null, linked, waiting?.endsAt ?? null, () => {
    if (!linked) setRanOut(true)
    setWaiting(null)
  })

  function startLink() {
    setRanOut(false)
    run(() => linkGroupAction({ venueId: view.venueId }) as Promise<LinkResult>, {
      onOk: (answer) => {
        if (!answer.ok) return
        setWaiting({ url: answer.url, endsAt: new Date(answer.expiresAt).getTime() })
        window.open(answer.url, '_blank', 'noopener,noreferrer')
      },
      words: (error) => (error === 'telegram_off' ? t('err.telegram_off') : undefined),
    })
  }

  function test() {
    run(() => testTelegramAction({ venueId: view.venueId }), {
      done: t('al_tg_test_sent'),
      words: (error) =>
        error === 'telegram_failed' || error === 'no_group' ? t('al_tg_fail') : undefined,
    })
  }

  const group = view.telegram.state === 'none' ? '' : view.telegram.group || 'Telegram'
  return (
    <section className="grid gap-3" aria-labelledby="alerts-tg">
      <div>
        <h3 id="alerts-tg" className="text-lg font-medium">
          {t('al_tg')}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('al_tg_line')}</p>
      </div>
      {view.telegram.state === 'left' ? (
        <p className="text-sm text-destructive" role="status" data-testid="alerts-tg-left">
          {t('al_tg_left', { group })}
        </p>
      ) : null}
      {ranOut ? (
        <p className="text-sm text-destructive" role="status" data-testid="alerts-tg-expired">
          {t('al_tg_expired')}
        </p>
      ) : null}
      {linked ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 basis-48 font-medium" data-testid="alerts-tg-linked">
            {t('al_tg_linked', { group })}
          </p>
          <Button variant="outline" size="sm" disabled={pending} onClick={test}>
            {t('al_tg_test')}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={t('al_tg')}>
                <EllipsisIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setUnlinking(true)}>
                {t('al_tg_unlink')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : waiting !== null ? (
        <div className="flex flex-wrap items-center gap-3" data-testid="alerts-tg-waiting">
          <p className="min-w-0 flex-1 basis-48 text-sm">{t('al_tg_wait')}</p>
          <Button variant="outline" size="sm" asChild>
            <a href={waiting.url} target="_blank" rel="noopener noreferrer">
              <ExternalLinkIcon aria-hidden />
              {t('al_tg_open')}
            </a>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setWaiting(null)}>
            {t('al_cancel')}
          </Button>
        </div>
      ) : (
        <div>
          <Button variant="outline" disabled={pending} onClick={startLink}>
            {t('al_tg_link')}
          </Button>
        </div>
      )}

      <Dialog open={unlinking} onOpenChange={setUnlinking}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('al_tg_unlink')}</DialogTitle>
            <DialogDescription>{t('al_tg_unlink_body', { group })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlinking(false)}>
              {t('al_cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                setUnlinking(false)
                run(() => unlinkGroupAction({ venueId: view.venueId }), { done: t('st_saved') })
              }}
            >
              {t('al_tg_unlink')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function DoneFromTelegram({
  view,
  people,
  runner,
}: {
  view: AlertsView
  people: readonly AlertPersonView[]
  runner: Runner
}) {
  const t = useTranslations('ownerSettings')
  const { pending, run } = runner
  const [linking, setLinking] = useState<AlertPersonView | null>(null)
  const person = linking === null ? null : (people.find((p) => p.id === linking.id) ?? null)
  const [link, setLink] = useState<{ url: string; svg: string; endsAt: number } | null>(null)

  useWatch(
    person !== null && link !== null,
    person?.telegramLinked === true,
    link?.endsAt ?? null,
    () => {
      setLinking(null)
      setLink(null)
      if (person?.telegramLinked !== true) toast.error(t('al_tg_expired'))
    },
  )

  function closeLink() {
    setLinking(null)
    setLink(null)
  }

  function start(target: AlertPersonView) {
    setLinking(target)
    setLink(null)
    run(
      () =>
        linkPersonAction({
          venueId: view.venueId,
          staffMemberId: target.id,
        }) as Promise<LinkResult>,
      {
        onOk: (answer) => {
          if (answer.ok && answer.svg !== null) {
            setLink({
              url: answer.url,
              svg: answer.svg,
              endsAt: new Date(answer.expiresAt).getTime(),
            })
          }
        },
        onFail: () => setLinking(null),
        words: (error) => (error === 'telegram_off' ? t('err.telegram_off') : undefined),
      },
    )
  }

  return (
    <section className="grid gap-3" aria-labelledby="alerts-done">
      <div>
        <h3 id="alerts-done" className="text-lg font-medium">
          {t('al_done')}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('al_done_line')}</p>
      </div>
      <ul className="divide-y rounded-lg border bg-card" data-testid="alerts-done-people">
        {people.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3">
            <p className="min-w-0 flex-1 basis-40 break-words font-medium">{p.name}</p>
            {p.telegramLinked ? (
              <>
                <Badge variant="secondary">{t('al_linked')}</Badge>
                {view.canUnlinkPerson ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={p.name}>
                        <EllipsisIcon aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() =>
                          run(
                            () =>
                              unlinkPersonAction({ venueId: view.venueId, staffMemberId: p.id }),
                            { done: t('st_saved') },
                          )
                        }
                      >
                        {t('al_unlink_person')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </>
            ) : (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => start(p)}>
                {t('al_link')}
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={linking !== null} onOpenChange={(open) => !open && closeLink()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{linking?.name ?? ''}</DialogTitle>
            <DialogDescription>
              {t('al_link_body', { name: linking?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          {link === null ? null : (
            <div className="grid justify-items-center gap-3">
              <QrPicture
                svg={link.svg}
                alt={t('al_link_qr', { name: linking?.name ?? '' })}
                className="size-56 rounded-md"
                testId="alerts-person-qr"
              />
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-sm underline underline-offset-2"
              >
                {link.url}
              </a>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={closeLink}>
              {t('al_cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
