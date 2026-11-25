// What a role holds, and the one function that decides it (Martin 11-09, ticket #366). The default
// roles are a preselection a venue may change, so a role's permissions come from its own row once
// the venue has edited it and from the code's table until then. Three places ask that question —
// the permission check (`grants.ts`), the role editor's read side (`staff-read.ts`) and the
// worker's alert delivery — and a role that granted somewhere what the editor does not show would
// be a security bug, not a display bug. So this file does two things: it pins what `roleGrants`
// answers, and it holds those three (and the write path) to reading it rather than deciding again.
// Only tightens (D67).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ROLE_KINDS,
  DEFAULT_ROLE_PERMISSIONS,
  EDITABLE_DEFAULT_ROLE_KINDS,
  isEditableDefaultKind,
  newPermissionsOf,
  PERMISSIONS,
  type Permission,
  roleGrants,
  roleIsEdited,
} from './permissions'

const serviceDir = fileURLToPath(new URL('.', import.meta.url))
const workerDeliver = fileURLToPath(
  new URL('../../../../apps/worker/src/alerts/deliver.ts', import.meta.url),
)

/** A row as the database holds it: `knownPermissions` null while the venue has never edited it. */
const row = (fields: {
  defaultKind?: string | null
  permissions?: unknown
  knownPermissions?: unknown
}) => ({
  defaultKind: fields.defaultKind ?? null,
  permissions: fields.permissions ?? [],
  knownPermissions: fields.knownPermissions ?? null,
})

describe('what a role holds (#366)', () => {
  it('reads a default role the venue has never edited from the code, not from its row', () => {
    for (const kind of DEFAULT_ROLE_KINDS) {
      // `ensureDefaultRoles` writes the shipped list into the row, and an old row's copy may be
      // stale, so the row's own column must not decide here.
      const stale = row({ defaultKind: kind, permissions: ['log.view'] })
      expect(roleGrants(stale)).toEqual([...DEFAULT_ROLE_PERMISSIONS[kind]])
      expect(roleIsEdited(stale)).toBe(false)
      expect(newPermissionsOf(stale)).toEqual([])
    }
  })

  it('reads an edited default role from its own row, and puts nothing back', () => {
    const edited = row({
      defaultKind: 'staff',
      permissions: ['tables.open_close'],
      knownPermissions: [...PERMISSIONS],
    })
    expect(roleGrants(edited)).toEqual(['tables.open_close'])
    expect(roleIsEdited(edited)).toBe(true)
    // Not one of the other shipped staff abilities comes back on its own.
    for (const permission of DEFAULT_ROLE_PERMISSIONS.staff) {
      if (permission !== 'tables.open_close') {
        expect(roleGrants(edited)).not.toContain(permission)
      }
    }
  })

  it('holds the owner role to every permission, whatever its row says', () => {
    // A row edited by hand in the database must not lock a venue out of its own role editor.
    expect(roleGrants(row({ defaultKind: 'owner', permissions: [] }))).toEqual([...PERMISSIONS])
    expect(
      roleGrants(
        row({
          defaultKind: 'owner',
          permissions: ['night.view'],
          knownPermissions: ['night.view'],
        }),
      ),
    ).toContain('settings.roles')
    expect(isEditableDefaultKind('owner')).toBe(false)
    for (const kind of EDITABLE_DEFAULT_ROLE_KINDS) expect(isEditableDefaultKind(kind)).toBe(true)
  })

  it('reads a role the venue made itself from its row, as it always did', () => {
    expect(roleGrants(row({ permissions: ['log.view', 'night.view'] }))).toEqual([
      'log.view',
      'night.view',
    ])
    expect(roleGrants(row({ permissions: ['not.a.permission'] }))).toEqual([])
    expect(roleGrants(row({ permissions: 'nonsense' }))).toEqual([])
  })

  // The property the next person to add a permission needs to know about. Whatever that key is,
  // an edited role does not gain it: the venue's own ticks stand, and the editor marks it new.
  it('gives a permission Restro adds later to an unedited default role and to nobody else', () => {
    const added: Permission = PERMISSIONS.at(-1) ?? 'settings.guests'
    // What the code knew before that key existed, as an edited role's marker holds it.
    const knownBefore = PERMISSIONS.filter((permission) => permission !== added)
    for (const kind of EDITABLE_DEFAULT_ROLE_KINDS) {
      const shipped = DEFAULT_ROLE_PERMISSIONS[kind]
      const unedited = row({ defaultKind: kind })
      expect(roleGrants(unedited).includes(added)).toBe(shipped.includes(added))

      const edited = row({
        defaultKind: kind,
        permissions: [...knownBefore],
        knownPermissions: [...knownBefore],
      })
      expect(roleGrants(edited)).not.toContain(added)
      expect(newPermissionsOf(edited)).toEqual([added])
    }
    // The owner's role is the exception: it holds every permission, so a new key reaches it.
    expect(roleGrants(row({ defaultKind: 'owner' }))).toContain(added)
    expect(newPermissionsOf(row({ defaultKind: 'owner', knownPermissions: [] }))).toEqual([])
  })

  it('offers every permission on an edited role, ticked or marked new, and never invents one', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...PERMISSIONS)),
        fc.uniqueArray(fc.constantFrom(...PERMISSIONS)),
        (ticked, known) => {
          const role = row({
            defaultKind: 'staff',
            permissions: ticked,
            knownPermissions: known,
          })
          const holds = roleGrants(role)
          const fresh = newPermissionsOf(role)
          // Nothing granted that was not ticked, and nothing marked new that was known.
          expect(holds.every((permission) => ticked.includes(permission))).toBe(true)
          expect(fresh.every((permission) => !known.includes(permission))).toBe(true)
          // Every key is accounted for: known (so it was offered) or marked new.
          for (const permission of PERMISSIONS) {
            expect(known.includes(permission) || fresh.includes(permission)).toBe(true)
          }
        },
      ),
    )
  })
})

describe('one authority, read by everything (#366)', () => {
  /** The three that answer "what may this role do?", each from a row it read. */
  const readers = [join(serviceDir, 'grants.ts'), join(serviceDir, 'staff-read.ts'), workerDeliver]
  /** The write path, which checks the same answer before it hands rights out. */
  const writer = join(serviceDir, 'staff.ts')

  it('finds the readers (the guard is looking at real files)', () => {
    for (const file of [...readers, writer]) {
      expect(readFileSync(file, 'utf8').length).toBeGreaterThan(100)
    }
  })

  it('leaves the decision to `roleGrants`: no reader indexes the table by a role’s kind', () => {
    const found = readers.flatMap((file) => {
      const text = readFileSync(file, 'utf8')
      // `DEFAULT_ROLE_PERMISSIONS[<kind>]` is the substitution #366 removed: a reader that indexes
      // the table by a row's kind decides for itself, and its answer can drift from the role
      // editor's. `DEFAULT_ROLE_PERMISSIONS.staff` — the bar tablet's ceiling, which is not a
      // question about a row — names one list on purpose and is not that.
      const substitutes = /DEFAULT_ROLE_PERMISSIONS\[/.test(text)
      const reads = /\broleGrants\b/.test(text)
      return substitutes || !reads ? [file] : []
    })
    expect(found).toEqual([])
  })

  it('has the write path read it too, so nobody is given what the editor doesn’t show', () => {
    expect(/\broleGrants\b/.test(readFileSync(writer, 'utf8'))).toBe(true)
  })
})
