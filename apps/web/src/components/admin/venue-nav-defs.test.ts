// The venue sidebar's entries (D154, D156): which a person is shown, where each goes, and which is
// open for an address. The page decides again; these tables are the sidebar's half.
import { describe, expect, it } from 'vitest'

import {
  isVenueEntryOpen,
  VENUE_NAV_GROUPS,
  venueEntryHref,
  venueNavGroupsOf,
} from './venue-nav-defs'
import { settingsSectionsOf } from './workspace-tab-defs'

const keysOf = (reservations: boolean) =>
  venueNavGroupsOf({ reservations }).map((group) => [
    group.key,
    group.entries.map((entry) => entry.key),
  ])

const ALL = VENUE_NAV_GROUPS.flatMap((group) => group.entries)
const byKey = (key: string) => {
  const found = ALL.find((entry) => entry.key === key)
  if (!found) throw new Error(key)
  return found
}

describe('who is shown which entry', () => {
  // Owner, admin, a manager and a door host hold `reservations.tonight`; a waiter and a member
  // without it do not (D141). Everything else is shown to all and read-only where the role lacks
  // the right, as before; hiding the Studio and Settings from staff is D157, not this.
  it.each([
    ['owner, admin, manager, door host', true],
    ['waiter, member without reservations.tonight', false],
  ])('%s', (_who, reservations) => {
    expect(keysOf(reservations)).toEqual([
      ['menu', ['studio', 'tables']],
      ['ordering', ['tonight', 'settings-ordering']],
      [
        'reservations',
        reservations ? ['reservations', 'settings-reservations'] : ['settings-reservations'],
      ],
      ['venue', ['settings-venue']],
    ])
  })

  it('never has more than seven entries for a venue', () => {
    expect(ALL).toHaveLength(7)
  })
})

describe('where each entry goes', () => {
  it.each([
    ['studio', '/venues/vn_1?tab=studio'],
    ['tables', '/venues/vn_1?tab=tables'],
    ['tonight', '/venues/vn_1?tab=tonight'],
    ['reservations', '/venues/vn_1?tab=reservations'],
    ['settings-ordering', '/venues/vn_1?tab=settings&section=hours'],
    ['settings-reservations', '/venues/vn_1?tab=settings&section=reservations'],
    ['settings-venue', '/venues/vn_1?tab=settings&section=general'],
  ])('%s → %s', (key, href) => {
    expect(venueEntryHref('vn_1', byKey(key))).toBe(href)
  })

  it('opens a section every role is offered, on a venue with nothing else', () => {
    for (const entry of ALL.filter((one) => one.module !== undefined)) {
      const section = new URL(venueEntryHref('vn_1', entry), 'https://x').searchParams.get(
        'section',
      )
      expect(settingsSectionsOf(false)).toContain(section)
    }
  })
})

describe('which entry is open', () => {
  const openFor = (tab: string | null, section: string | null) =>
    ALL.filter((entry) => isVenueEntryOpen(entry, tab, section)).map((entry) => entry.key)

  it.each([
    [null, null, ['studio']],
    ['studio', 'nd_9', ['studio']],
    ['tables', null, ['tables']],
    ['tonight', null, ['tonight']],
    ['reservations', null, ['reservations']],
    ['settings', null, ['settings-venue']],
    ['settings', 'general', ['settings-venue']],
    ['settings', 'staff', ['settings-venue']],
    ['settings', 'publish', ['settings-venue']],
    ['settings', 'versioning', ['settings-venue']],
    ['settings', 'hours', ['settings-ordering']],
    ['settings', 'ordering', ['settings-ordering']],
    ['settings', 'paying', ['settings-ordering']],
    ['settings', 'alerts', ['settings-ordering']],
    ['settings', 'reservations', ['settings-reservations']],
    ['settings', 'nonsense', ['settings-venue']],
  ])('tab=%s section=%s → %j', (tab, section, open) => {
    expect(openFor(tab, section)).toEqual(open)
  })
})
