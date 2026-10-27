'use client'

// Staff and roles › Roles and › Shared devices (#87, plan §3). A role is a row; its sheet shows the
// name (own roles rename in place) and the permissions as ticks in three groups, each tick saving at
// once with Undo. The three default roles are read-only and are copied to make a venue's own
// (D122 §7). Nobody gives what they don't hold: such a tick is shown unticked and read-only.
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
  markSharedDeviceAction,
  revokeSharedDeviceAction,
  updateRoleAction,
} from '@/server/settings/staff-actions'
import type { StaffRoleView, StaffView } from '@/server/settings/staff-view'

import type { useSettingsRun } from './use-settings-run'

type Runner = ReturnType<typeof useSettingsRun>

/** The permissions in the three groups the sheet shows (plan §6), in the order a person reads them. */
export const PERMISSION_GROUPS = [
  {
    key: 'sf_g_tonight',
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
    permissions: ['log.view', 'night.view', 'night.view_full', 'money.follow_up'],
  },
  {
    key: 'sf_g_settings',
    permissions: [
      'settings.guards',
      'settings.codes',
      'settings.payment_tables',
      'settings.alerts',
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
    <section className="grid gap-3" aria-labelledby="staff-roles">
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
          className="grid gap-4"
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
          <div className="grid gap-2">
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
  useEffect(() => setName(role?.name ?? ''), [role])
  const held = new Set(view.held)

  function setPermissions(target: StaffRoleView, next: readonly string[]) {
    if (target.defaultKind !== null) return
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
              {role.readOnly ? (
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
            </SheetHeader>
            <div className="grid gap-5 px-4">
              {PERMISSION_GROUPS.map((group) => (
                <fieldset key={group.key} className="grid gap-2">
                  <legend className="text-sm font-medium">{t(group.key)}</legend>
                  {group.key === 'sf_g_settings' ? (
                    <p className="text-xs text-muted-foreground">{t('sf_own_signin')}</p>
                  ) : null}
                  {group.permissions.map((permission) => {
                    const ticked = role.permissions.includes(permission)
                    const cannotGive = !ticked && !view.operator && !held.has(permission)
                    const locked = role.readOnly || cannotGive
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
                        </Label>
                      </div>
                    )
                  })}
                </fieldset>
              ))}
            </div>
            {role.readOnly || role.people > 0 ? null : (
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
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

export function StaffDevices({ view, runner }: { view: StaffView; runner: Runner }) {
  const t = useTranslations('ownerSettings')
  const format = useFormatter()
  const { pending, run } = runner
  const [making, setMaking] = useState(false)
  const [name, setName] = useState('')
  const [stopping, setStopping] = useState<StaffView['devices'][number] | null>(null)

  return (
    <section className="grid gap-3" aria-labelledby="staff-devices">
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
      {view.thisBrowserShared || view.operator ? null : (
        <div className="grid gap-1">
          <div>
            <Button variant="outline" onClick={() => setMaking(true)}>
              {t('sf_dev_make')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('sf_dev_line')}</p>
        </div>
      )}

      <Dialog open={making} onOpenChange={setMaking}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (name.trim() === '') return
              setMaking(false)
              run(() => markSharedDeviceAction({ venueId: view.venueId, name: name.trim() }), {
                done: t('st_saved'),
                words: (error) => (error === 'already_shared' ? t('sf_e_shared') : undefined),
                onOk: () => setName(''),
              })
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('sf_dev_make')}</DialogTitle>
              <DialogDescription>{t('sf_dev_line')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="device-name">{t('sf_dev_name')}</Label>
              <Input
                id="device-name"
                value={name}
                maxLength={40}
                autoFocus
                placeholder={t('sf_dev_example')}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMaking(false)}>
                {t('st_cancel')}
              </Button>
              <Button type="submit" disabled={pending || name.trim() === ''}>
                {t('sf_dev_go')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
