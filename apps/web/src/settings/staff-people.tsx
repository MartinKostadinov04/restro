'use client'

// Staff and roles › People (#87, plan §3): a list of the venue's people with a role Select, the PIN
// behind an eye (shown 30 seconds, then hidden again), and "…" for the rest. A PIN is drawn by
// Restro and appears only in the add and new-PIN results and through `pin.reveal` (logged); this
// file keeps it in memory for those 30 seconds and nowhere else.
import { EllipsisIcon, EyeIcon, EyeOffIcon, PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { WRAPS_FORM } from '@/lib/wrapping'
import {
  addPersonAction,
  assignRoleAction,
  linkAccountAction,
  newPinAction,
  removeForGoodAction,
  removeFromVenueAction,
  renamePersonAction,
  revealPinAction,
} from '@/server/settings/staff-actions'
import type { StaffPersonView, StaffView } from '@/server/settings/staff-view'

import type { useSettingsRun } from './use-settings-run'

type Runner = ReturnType<typeof useSettingsRun>

/** How long a PIN stays on the screen. */
export const PIN_SHOWN_MS = 30_000
/** A search field appears above the list once it is longer than this (plan §5). */
const SEARCH_FROM = 12

/** Keeps PINs on the screen for 30 seconds each, then forgets them. */
function useShownPins() {
  const [shown, setShown] = useState<ReadonlyMap<string, string>>(new Map())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const hide = useCallback((id: string) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setShown((current) => {
      const next = new Map(current)
      next.delete(id)
      return next
    })
  }, [])
  const show = useCallback(
    (id: string, pin: string) => {
      clearTimeout(timers.current.get(id))
      timers.current.set(
        id,
        setTimeout(() => hide(id), PIN_SHOWN_MS),
      )
      setShown((current) => new Map(current).set(id, pin))
    },
    [hide],
  )
  useEffect(() => {
    const pending = timers.current
    return () => {
      for (const timer of pending.values()) clearTimeout(timer)
    }
  }, [])
  return { shown, show, hide }
}

type Ask =
  | { readonly kind: 'rename'; readonly person: StaffPersonView }
  | { readonly kind: 'link'; readonly person: StaffPersonView }
  | { readonly kind: 'forGood'; readonly person: StaffPersonView }

export function StaffPeople({ view, runner }: { view: StaffView; runner: Runner }) {
  const t = useTranslations('ownerSettings')
  const { pending, run } = runner
  const pins = useShownPins()
  const [adding, setAdding] = useState(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [fresh, setFresh] = useState<{ name: string; pin: string | null } | null>(null)
  const [search, setSearch] = useState('')

  const roleName = (ref: string) => view.roles.find((role) => role.ref === ref)?.name ?? ''
  const visible =
    view.people.length > SEARCH_FROM && search.trim() !== ''
      ? view.people.filter((person) =>
          person.name.toLowerCase().includes(search.trim().toLowerCase()),
        )
      : view.people

  function showPin(person: StaffPersonView) {
    run(() => revealPinAction({ venueId: view.venueId, staffMemberId: person.id }), {
      onOk: (answer) => {
        if (answer.ok && answer.pin !== null) pins.show(person.id, answer.pin)
      },
    })
  }

  function newPin(person: StaffPersonView) {
    run(() => newPinAction({ venueId: view.venueId, staffMemberId: person.id }), {
      onOk: (answer) => {
        pins.hide(person.id)
        if (answer.ok) setFresh({ name: person.name, pin: answer.pin })
      },
    })
  }

  function changeRole(person: StaffPersonView, ref: string) {
    const previous = person.roleRef
    run(() => assignRoleAction({ venueId: view.venueId, staffMemberId: person.id, roleId: ref }), {
      done: t('st_saved'),
      undo: () =>
        assignRoleAction({ venueId: view.venueId, staffMemberId: person.id, roleId: previous }),
      words: (error) => deniedWords(error, person.name),
    })
  }

  function removeHere(person: StaffPersonView) {
    const previous = person.roleRef
    run(() => removeFromVenueAction({ venueId: view.venueId, staffMemberId: person.id }), {
      done: t('st_saved'),
      undo: () =>
        assignRoleAction({ venueId: view.venueId, staffMemberId: person.id, roleId: previous }),
      words: (error) => deniedWords(error, person.name),
    })
  }

  function deniedWords(error: string, name: string): string | undefined {
    return error === 'permission_denied' ? t('sf_e_denied', { name }) : undefined
  }

  return (
    <section className="grid grid-cols-1 gap-3" aria-labelledby="staff-people">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="staff-people" className="text-lg font-medium">
          {t('sf_people')}
        </h3>
        {view.people.length > 0 ? (
          <Button
            variant="outline"
            size="sm"
            className={WRAPS_FORM}
            onClick={() => setAdding(true)}
          >
            <PlusIcon aria-hidden />
            {t('sf_add')}
          </Button>
        ) : null}
      </div>

      {view.people.length === 0 ? (
        <Empty data-testid="staff-empty">
          <EmptyHeader>
            <EmptyDescription>{t('sf_empty', { venue: view.venueName })}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setAdding(true)}>{t('sf_add')}</Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          {view.people.length > SEARCH_FROM ? (
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('sf_search')}
              aria-label={t('sf_search')}
            />
          ) : null}
          <ul className="divide-y rounded-lg border bg-card" data-testid="staff-people">
            {visible.map((person) => {
              const pin = pins.shown.get(person.id)
              return (
                <li key={person.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="break-words font-medium">{person.name}</p>
                    {person.manageable ? (
                      person.accountId === null ? null : (
                        <p className="text-xs text-muted-foreground">{t('sf_own_phone')}</p>
                      )
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {t('sf_cant_manage', { role: person.neededRole ?? roleName('owner') })}
                      </p>
                    )}
                  </div>
                  {person.manageable ? (
                    <>
                      <Select
                        value={person.roleRef}
                        onValueChange={(ref) => changeRole(person, ref)}
                        disabled={pending}
                      >
                        <SelectTrigger
                          className="w-44 max-w-full"
                          aria-label={`${t('sf_role')}: ${person.name}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {view.roles.map((role) => (
                            <SelectItem key={role.ref} value={role.ref}>
                              {role.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span
                        className="min-w-[4ch] font-mono tabular-nums"
                        data-testid={`pin-${person.id}`}
                      >
                        {pin ?? (person.hasPin ? '••••' : '')}
                      </span>
                      {person.hasPin ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={pending}
                          aria-label={`${pin === undefined ? t('sf_show_pin') : t('sf_hide_pin')}: ${person.name}`}
                          onClick={() =>
                            pin === undefined ? showPin(person) : pins.hide(person.id)
                          }
                        >
                          {pin === undefined ? <EyeIcon aria-hidden /> : <EyeOffIcon aria-hidden />}
                        </Button>
                      ) : null}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={person.name}>
                            <EllipsisIcon aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setAsk({ kind: 'rename', person })}>
                            {t('sf_rename')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => newPin(person)}>
                            {t('sf_newpin')}
                          </DropdownMenuItem>
                          {person.accountId === null ? (
                            <DropdownMenuItem onSelect={() => setAsk({ kind: 'link', person })}>
                              {t('sf_link')}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() =>
                                run(
                                  () =>
                                    linkAccountAction({
                                      venueId: view.venueId,
                                      staffMemberId: person.id,
                                      userId: null,
                                    }),
                                  { done: t('st_saved') },
                                )
                              }
                            >
                              {t('sf_unlink')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => removeHere(person)}>
                            {t('sf_remove_here', { venue: view.venueName })}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => setAsk({ kind: 'forGood', person })}
                          >
                            {t('sf_remove_all')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {roleName(person.roleRef)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      <AddPersonDialog
        view={view}
        runner={runner}
        open={adding}
        onOpenChange={setAdding}
        onAdded={(name, pin) => setFresh({ name, pin })}
      />
      <PinResultDialog fresh={fresh} onClose={() => setFresh(null)} />
      <RenameDialog
        person={ask?.kind === 'rename' ? ask.person : null}
        view={view}
        runner={runner}
        onClose={() => setAsk(null)}
      />
      <LinkDialog
        person={ask?.kind === 'link' ? ask.person : null}
        view={view}
        runner={runner}
        onClose={() => setAsk(null)}
      />
      <Dialog open={ask?.kind === 'forGood'} onOpenChange={(open) => !open && setAsk(null)}>
        <DialogContent>
          {ask?.kind === 'forGood' ? (
            <>
              <DialogHeader>
                <DialogTitle>{t('sf_remove_all')}</DialogTitle>
                <DialogDescription>
                  {t('sf_remove_all_body', { name: ask.person.name })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAsk(null)}>
                  {t('sf_keep')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={pending}
                  onClick={() => {
                    const person = ask.person
                    setAsk(null)
                    run(
                      () =>
                        removeForGoodAction({ venueId: view.venueId, staffMemberId: person.id }),
                      {
                        done: t('st_saved'),
                        words: (error) => deniedWords(error, person.name),
                      },
                    )
                  }}
                >
                  {t('sf_remove_all_go', { name: ask.person.name })}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function AddPersonDialog({
  view,
  runner,
  open,
  onOpenChange,
  onAdded,
}: {
  view: StaffView
  runner: Runner
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: (name: string, pin: string | null) => void
}) {
  const t = useTranslations('ownerSettings')
  const { pending, run } = runner
  const [name, setName] = useState('')
  const [role, setRole] = useState('staff')
  useEffect(() => {
    if (open) {
      setName('')
      setRole('staff')
    }
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            const displayName = name.trim()
            if (displayName === '') return
            onOpenChange(false)
            run(() => addPersonAction({ venueId: view.venueId, displayName, roleId: role }), {
              onOk: (answer) => {
                if (answer.ok) onAdded(displayName, answer.pin)
              },
            })
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('sf_add')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2">
            <Label htmlFor="staff-name">{t('sf_name')}</Label>
            <Input
              id="staff-name"
              value={name}
              maxLength={60}
              autoFocus
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-2">
            <Label htmlFor="staff-role">{t('sf_role')}</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="staff-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {view.roles.map((candidate) => (
                  <SelectItem key={candidate.ref} value={candidate.ref}>
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('st_cancel')}
            </Button>
            <Button type="submit" disabled={pending || name.trim() === ''}>
              {t('sf_add_go')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "{name}'s PIN is 4821. They use it on the bar tablet." until Done; it is not kept. */
function PinResultDialog({
  fresh,
  onClose,
}: {
  fresh: { name: string; pin: string | null } | null
  onClose: () => void
}) {
  const t = useTranslations('ownerSettings')
  return (
    <Dialog open={fresh !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {fresh === null ? null : (
          <>
            <DialogHeader>
              <DialogTitle>{fresh.name}</DialogTitle>
              <DialogDescription data-testid="pin-result">
                {fresh.pin === null
                  ? t('sf_pin_hidden')
                  : t('sf_pin_new', { name: fresh.name, pin: fresh.pin })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={onClose}>{t('sf_done')}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RenameDialog({
  person,
  view,
  runner,
  onClose,
}: {
  person: StaffPersonView | null
  view: StaffView
  runner: Runner
  onClose: () => void
}) {
  const t = useTranslations('ownerSettings')
  const { pending, run } = runner
  const [name, setName] = useState('')
  useEffect(() => setName(person?.name ?? ''), [person])
  return (
    <Dialog open={person !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (person === null || name.trim() === '') return
            onClose()
            run(
              () =>
                renamePersonAction({
                  venueId: view.venueId,
                  staffMemberId: person.id,
                  displayName: name.trim(),
                }),
              { done: t('st_saved') },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('sf_rename')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2">
            <Label htmlFor="staff-rename">{t('sf_name')}</Label>
            <Input
              id="staff-rename"
              value={name}
              maxLength={60}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('st_cancel')}
            </Button>
            <Button type="submit" disabled={pending || name.trim() === ''}>
              {t('st_save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Links a person to an account of the organisation, so a manager can use their own phone. */
function LinkDialog({
  person,
  view,
  runner,
  onClose,
}: {
  person: StaffPersonView | null
  view: StaffView
  runner: Runner
  onClose: () => void
}) {
  const t = useTranslations('ownerSettings')
  const { pending, run } = runner
  const [userId, setUserId] = useState('')
  const close = () => {
    setUserId('')
    onClose()
  }
  return (
    <Dialog open={person !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (person === null || userId === '') return
            close()
            run(
              () =>
                linkAccountAction({
                  venueId: view.venueId,
                  staffMemberId: person.id,
                  userId,
                }),
              {
                done: t('st_saved'),
                words: (error) =>
                  error === 'account_taken'
                    ? t('sf_e_account', {
                        other:
                          view.accounts.find((account) => account.userId === userId)?.linkedTo ??
                          '',
                      })
                    : undefined,
              },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('sf_link')}</DialogTitle>
          </DialogHeader>
          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger className="w-full" aria-label={t('sf_link')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {view.accounts.map((account) => (
                <SelectItem key={account.userId} value={account.userId}>
                  {account.name} · {account.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t('st_cancel')}
            </Button>
            <Button type="submit" disabled={pending || userId === ''}>
              {t('st_save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
