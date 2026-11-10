'use client'

// Staff and roles › Roles and › Shared devices (#87, plan §3). A role is a row; its sheet shows the
// name (own roles rename in place) and the permissions as ticks in four groups, each tick saving at
// once with Undo.
//
// The venue's Staff and Manager roles are ticked here in place, like a role it made itself (Martin
// 11-09, #366): what Restro ships is a preselection. Such a role gains one "Reset to what Restro
// ships" once the venue has changed it, and an ability Restro adds later arrives unticked and
// marked as new. The Owner role is the one that cannot change: an owner who could take
// `settings.roles` off their own role would lock the venue out of this screen. The three default
// names stay as Restro ships them, so a venue that wants its own name copies one, which is what
// copying is still for. Nobody gives what they don't hold: such a tick is shown unticked and
// read-only. A shared device is listed and stopped here; it is made on the bar tablet itself, by a
// staff-only account, from Tonight (RR-O35).
import { ChevronRightIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  archiveRoleAction,
  copyRoleAction,
  resetRoleAction,
  revokeSharedDeviceAction,
  updateRoleAction,
} from '@/server/settings/staff-actions'
import type { StaffRoleView, StaffView } from '@/server/settings/staff-view'

import type { useSettingsRun } from './use-settings-run'

type Runner = ReturnType<typeof useSettingsRun>

/**
 * The permissions in the groups the sheet shows (plan §6), in the order a person reads them, each
 * with the line under its name where there is one. Reservations are a group of their own (D141,
 * #324): working the door is a permission, not a job title, so any role may hold some of it.
 */
export const PERMISSION_GROUPS = [
  {
    key: 'sf_g_tonight',
    note: null,
    permissions: [
      'tables.open_close',
      'tables.resume',
      'ordering.pause',
      'ordering.lift',
      'alerts.answer',
      'sold_out',
    ],
  },
  {
    key: 'sf_g_records',
    note: null,
    permissions: ['log.view', 'night.view', 'night.view_full', 'money.follow_up'],
  },
  {
    key: 'sf_g_reservations',
    note: 'sf_reservations_signin',
    permissions: [
      'reservations.tonight',
      'reservations.manage',
      'reservations.pay_rule',
      'reservations.block',
      'reservations.edit_past',
      'reservations.end_night',
      'settings.reservations',
      'settings.guests',
    ],
  },
  {
    key: 'sf_g_settings',
    note: 'sf_own_signin',
    permissions: [
      'settings.guards',
      'settings.codes',
      'settings.payment_tables',
      'settings.alerts',
      'settings.connect_payments',
      'settings.roles',
    ],
  },
] as const

export function StaffRoles({ view, runner }: { view: StaffView; runner: Runner }) {
  const t = useTranslations('ownerSettings')
  const [open, setOpen] = useState<string | null>(null)
  const [copying, setCopying] = useState<StaffRoleView | null>(null)
  const role = view.roles.find((candidate) => candidate.ref === open) ?? null

  return (
    <section className="grid grid-cols-1 gap-3" aria-labelledby="staff-roles">
      <h3 id="staff-roles" className="text-lg font-medium">
        {t('sf_roles')}
      </h3>
      <ul className="divide-y rounded-lg border bg-card" data-testid="staff-roles">
        {view.roles.map((candidate) => (
          <li key={candidate.ref} className="flex items-center gap-2 p-1 pr-3">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 rounded-md p-2 text-left hover:bg-accent"
              onClick={() => setOpen(candidate.ref)}
            >
              <span className="min-w-0 flex-1">
                <span className="block break-words font-medium">{candidate.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {t('sf_role_people', { n: candidate.people })}
                  {candidate.defaultKind === null ? '' : ` · ${t('sf_default')}`}
                </span>
              </span>
              <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
            </button>
            <Button
              variant="outline"
              size="sm"
              aria-label={`${t('sf_copy')}: ${candidate.name}`}
              onClick={() => setCopying(candidate)}
            >
              {t('sf_copy')}
            </Button>
          </li>
        ))}
      </ul>
      <CopyDialog role={copying} view={view} runner={runner} onClose={() => setCopying(null)} />
      <RoleSheet role={role} view={view} runner={runner} onClose={() => setOpen(null)} />
    </section>
  )
}

function CopyDialog({
  role,
  view,
  runner,
  onClose,
}: {
  role: StaffRoleView | null
  view: StaffView
  runner: Runner
  onClose: () => void
}) {
  const t = useTranslations('ownerSettings')
  const { pending, run } = runner
  const [name, setName] = useState('')
  useEffect(() => setName(role === null ? '' : t('sf_copy_name', { role: role.name })), [role, t])
  return (
    <Dialog open={role !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form
          className="grid grid-cols-1 gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (role === null || name.trim() === '') return
            onClose()
            run(
              () =>
                copyRoleAction({
                  venueId: view.venueId,
                  fromRoleId: role.ref,
                  name: name.trim(),
                }),
              {
                done: t('st_saved'),
                words: (error) =>
                  error === 'role_name_taken' ? t('sf_e_taken', { name: name.trim() }) : undefined,
              },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('sf_copy')}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-2">
            <Label htmlFor="role-copy-name">{t('sf_name')}</Label>
            <Input
              id="role-copy-name"
              value={name}
              maxLength={40}
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

function RoleSheet({
  role,
  view,
  runner,
  onClose,
}: {
  role: StaffRoleView | null
  view: StaffView
  runner: Runner
  onClose: () => void
}) {
  const t = useTranslations('ownerSettings')
  const { pending, run } = runner
  const [name, setName] = useState('')
  const [resetting, setResetting] = useState(false)
  useEffect(() => {
    setName(role?.name ?? '')
    setResetting(false)
  }, [role])
  const held = new Set(view.held)

  function setPermissions(target: StaffRoleView, next: readonly string[]) {
    // Only the Owner role refuses a tick; a default role below it is the venue's to change (#366).
    if (target.readOnly) return
    const previous = [...target.permissions]
    run(() => updateRoleAction({ venueId: view.venueId, roleId: target.ref, permissions: next }), {
      done: t('st_saved'),
      undo: () =>
        updateRoleAction({ venueId: view.venueId, roleId: target.ref, permissions: previous }),
      words: (error) => (error === 'permission_not_held' ? t('sf_cant_give') : undefined),
    })
  }

  function rename(target: StaffRoleView) {
    const next = name.trim()
    if (next === '' || next === target.name) {
      setName(target.name)
      return
    }
    const previous = target.name
    run(() => updateRoleAction({ venueId: view.venueId, roleId: target.ref, name: next }), {
      done: t('st_saved'),
      undo: () => updateRoleAction({ venueId: view.venueId, roleId: target.ref, name: previous }),
      words: (error) => (error === 'role_name_taken' ? t('sf_e_taken', { name: next }) : undefined),
      onFail: () => setName(target.name),
    })
  }

  return (
    <Sheet open={role !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        {role === null ? null : (
          <>
            <SheetHeader>
              {/* A default role keeps the name Restro ships; a venue's own renames in place. */}
              {role.defaultKind !== null ? (
                <SheetTitle>{role.name}</SheetTitle>
              ) : (
                <>
                  <SheetTitle className="sr-only">{role.name}</SheetTitle>
                  <Label htmlFor="role-name">{t('sf_name')}</Label>
                  <Input
                    id="role-name"
                    value={name}
                    maxLength={40}
                    onChange={(event) => setName(event.target.value)}
                    onBlur={() => rename(role)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.currentTarget.blur()
                      if (event.key === 'Escape') setName(role.name)
                    }}
                  />
                </>
              )}
              <SheetDescription>
                {t('sf_role_people', { n: role.people })}
                {role.defaultKind === null ? '' : ` · ${t('sf_default')}`}
              </SheetDescription>
              {role.readOnly ? (
                <p className="px-4 text-sm text-muted-foreground" data-testid="role-owner-fixed">
                  {t('sf_owner_fixed')}
                </p>
              ) : null}
            </SheetHeader>
            <div className="grid grid-cols-1 gap-5 px-4">
              {PERMISSION_GROUPS.map((group) => (
                <fieldset key={group.key} className="grid grid-cols-1 gap-2">
                  <legend className="text-sm font-medium">{t(group.key)}</legend>
                  {group.note === null ? null : (
                    <p className="text-xs text-muted-foreground">{t(group.note)}</p>
                  )}
                  {group.permissions.map((permission) => {
                    const ticked = role.permissions.includes(permission)
                    const cannotGive = !ticked && !view.operator && !held.has(permission)
                    const locked = role.readOnly || cannotGive
                    // An ability Restro added after the venue ticked this role (#366): unticked,
                    // in its own group like any other, and said to be new so it is not missed.
                    const added = !cannotGive && role.newPermissions.includes(permission)
                    const id = `perm-${permission}`
                    return (
                      <div key={permission} className="flex items-start gap-2">
                        <Checkbox
                          id={id}
                          checked={ticked}
                          disabled={locked || pending}
                          onCheckedChange={(next) =>
                            setPermissions(
                              role,
                              next === true
                                ? [...role.permissions, permission]
                                : role.permissions.filter((p) => p !== permission),
                            )
                          }
                        />
                        <Label htmlFor={id} className="flex-col items-start gap-0 font-normal">
                          <span>{t(`perm.${permission}`)}</span>
                          {cannotGive ? (
                            <span className="text-xs text-muted-foreground">
                              {t('sf_cant_give')}
                            </span>
                          ) : null}
                          {added ? (
                            <span
                              className="text-xs text-muted-foreground"
                              data-testid={`perm-new-${permission}`}
                            >
                              {t('sf_perm_new')}
                            </span>
                          ) : null}
                        </Label>
                      </div>
                    )
                  })}
                </fieldset>
              ))}
            </div>
            {/* A default role is never archived: every venue always has its three (#366). */}
            {role.defaultKind === null && role.people === 0 ? (
              <SheetFooter>
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    onClose()
                    run(() => archiveRoleAction({ venueId: view.venueId, roleId: role.ref }), {
                      done: t('st_saved'),
                      words: (error) => (error === 'role_in_use' ? t('sf_e_in_use') : undefined),
                    })
                  }}
                >
                  {t('sf_archive_role')}
                </Button>
              </SheetFooter>
            ) : null}
            {role.edited ? (
              <SheetFooter>
                <Button variant="outline" disabled={pending} onClick={() => setResetting(true)}>
                  {t('sf_reset')}
                </Button>
              </SheetFooter>
            ) : null}
            <ResetDialog
              role={resetting ? role : null}
              view={view}
              runner={runner}
              onClose={() => setResetting(false)}
            />
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/**
 * "Reset to what Restro ships", with the confirm naming what the role will hold afterwards (#366):
 * without it a venue that ticks wrongly has no way back and we get the support call.
 */
function ResetDialog({
  role,
  view,
  runner,
  onClose,
}: {
  role: StaffRoleView | null
  view: StaffView
  runner: Runner
  onClose: () => void
}) {
  const t = useTranslations('ownerSettings')
  const { pending, run } = runner
  const shipped = new Set<string>(role?.shipped ?? [])
  const abilities = PERMISSION_GROUPS.flatMap((group) =>
    group.permissions
      .filter((permission) => shipped.has(permission))
      .map((permission) => t(`perm.${permission}`)),
  )
  return (
    <Dialog open={role !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {role === null ? null : (
          <>
            <DialogHeader>
              <DialogTitle>{t('sf_reset_q', { role: role.name })}</DialogTitle>
              <DialogDescription data-testid="role-reset-body">
                {t('sf_reset_body', {
                  role: role.name,
                  list: abilities.join(', '),
                })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {t('sf_reset_keep')}
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  onClose()
                  run(() => resetRoleAction({ venueId: view.venueId, roleId: role.ref }), {
                    done: t('st_saved'),
                  })
                }}
              >
                {t('sf_reset_go')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function StaffDevices({ view, runner }: { view: StaffView; runner: Runner }) {
  const t = useTranslations('ownerSettings')
  const format = useFormatter()
  const { pending, run } = runner
  const [stopping, setStopping] = useState<StaffView['devices'][number] | null>(null)

  return (
    <section className="grid grid-cols-1 gap-3" aria-labelledby="staff-devices">
      <h3 id="staff-devices" className="text-lg font-medium">
        {t('sf_devices')}
      </h3>
      {view.devices.length === 0 ? null : (
        <ul className="divide-y rounded-lg border bg-card" data-testid="staff-devices">
          {view.devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center gap-3 p-3">
              <div className="min-w-0 flex-1 basis-40">
                <p className="break-words font-medium">{device.name}</p>
                <p className="text-xs text-muted-foreground">
                  {t('sf_dev_since', {
                    date: format.dateTime(new Date(device.since), { dateStyle: 'medium' }),
                  })}
                </p>
              </div>
              {device.isThisSession ? null : (
                <Button variant="outline" size="sm" onClick={() => setStopping(device)}>
                  {t('sf_dev_stop')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {/* The bar tablet is made on the tablet itself, by a staff-only account (RR-O35). */}
      <p className="text-sm text-muted-foreground" data-testid="staff-devices-how">
        {t('sf_dev_how')}
      </p>

      <Dialog open={stopping !== null} onOpenChange={(open) => !open && setStopping(null)}>
        <DialogContent>
          {stopping === null ? null : (
            <>
              <DialogHeader>
                <DialogTitle>{t('sf_dev_stop')}</DialogTitle>
                <DialogDescription>
                  {t('sf_dev_stop_body', { device: stopping.name })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setStopping(null)}>
                  {t('sf_keep')}
                </Button>
                <Button
                  disabled={pending}
                  onClick={() => {
                    const device = stopping
                    setStopping(null)
                    run(
                      () =>
                        revokeSharedDeviceAction({ venueId: view.venueId, deviceId: device.id }),
                      { done: t('st_saved') },
                    )
                  }}
                >
                  {t('sf_dev_stop')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
