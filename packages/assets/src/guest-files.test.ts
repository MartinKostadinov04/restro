import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { newId, TableTokenFileSchema, VenueIndexSchema } from '@restro/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  deleteTableTokenFile,
  parseGuestFile,
  readTableTokenFile,
  readVenueIndex,
  venueIndexBytes,
  writeTableTokenFile,
} from './guest-files'
import { publishPutOptions, venueIndexPath } from './publish-paths'
import { LocalPublishStore } from './publish-store'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

const CODE = 'k3x9p2m7qa1z'

describe('guest files (venue index and table tokens)', () => {
  let root: string
  let store: LocalPublishStore

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'restro-guest-files-'))
    store = new LocalPublishStore({ rootDir: root })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('round-trips a venue index under its public code', async () => {
    const index = { venue_id: newId('vn'), menu_id: newId('nd'), slug: 'demo-club' }
    await store.put(
      venueIndexPath(CODE),
      venueIndexBytes(index),
      publishPutOptions(venueIndexPath(CODE)),
    )
    expect(venueIndexPath(CODE)).toBe(`v/${CODE}.json`)
    expect(await readVenueIndex(store, CODE)).toEqual(index)
    expect(await readVenueIndex(store, '000000000000')).toBeNull()
  })

  it('does not read the older v/<slug>.json file', async () => {
    // Left in the store from before CF-14; no path of ours, so it cannot even be written.
    await expect(
      store.put('v/demo-club.json', bytes({ venue_id: 'vn_x', menu_id: 'nd_x' }), {
        contentType: 'application/json',
        cacheControl: 'public, max-age=30',
      }),
    ).rejects.toThrow()
    expect(await readVenueIndex(store, 'demo-club')).toBeNull()
  })

  it('writes a table token file and reads it back', async () => {
    const file = { venue_public_id: CODE, venue_slug: 'demo-club', table_label: '12' }
    await writeTableTokenFile(store, 'tb_0123456789ABCDEFGHIJKL', file)
    expect(await readTableTokenFile(store, 'tb_0123456789ABCDEFGHIJKL')).toEqual(file)
    expect(await readTableTokenFile(store, 'tb_ZZZZZZZZZZZZZZZZZZZZZZ')).toBeNull()
  })

  it('removes the file of a retired token, and removing it again is not an error', async () => {
    const token = 'Ab3dEfGh1jKlMnOpQrStUv'
    await writeTableTokenFile(store, token, {
      venue_public_id: CODE,
      venue_slug: 'demo-club',
      table_label: '12',
    })
    expect(await readTableTokenFile(store, token)).not.toBeNull()
    await deleteTableTokenFile(store, token)
    expect(await readTableTokenFile(store, token)).toBeNull()
    await deleteTableTokenFile(store, token)
    await deleteTableTokenFile(store, 'Zz9yXwVuTsRqPoNmLkJiHg')
  })

  it('treats a malformed file as no file', async () => {
    expect(parseGuestFile(TableTokenFileSchema, null)).toBeNull()
    expect(parseGuestFile(TableTokenFileSchema, new TextEncoder().encode('{not json'))).toBeNull()
    expect(parseGuestFile(TableTokenFileSchema, bytes({ venue_slug: 'Demo Club' }))).toBeNull()
    expect(
      parseGuestFile(
        TableTokenFileSchema,
        bytes({
          venue_public_id: CODE,
          venue_slug: 'demo-club',
          table_label: '12',
          barsy_id: 55,
        }),
      ),
    ).toBeNull()
    // A token file of the older shape (no public code) is no file.
    expect(
      parseGuestFile(TableTokenFileSchema, bytes({ venue_slug: 'demo-club', table_label: '12' })),
    ).toBeNull()
    // A venue index of the older shape (no slug) is no file either.
    expect(
      parseGuestFile(VenueIndexSchema, bytes({ venue_id: newId('vn'), menu_id: newId('nd') })),
    ).toBeNull()
    expect(
      parseGuestFile(VenueIndexSchema, bytes({ venue_id: 'vn_x', menu_id: 'nd_x', slug: 'x' })),
    ).toBeNull()
  })

  it('refuses to write a token file with a bad label, slug or code', async () => {
    await expect(
      writeTableTokenFile(store, 'tb_0123456789ABCDEFGHIJKL', {
        venue_public_id: CODE,
        venue_slug: 'demo-club',
        table_label: '   ',
      }),
    ).rejects.toThrow()
    await expect(
      writeTableTokenFile(store, 'tb_0123456789ABCDEFGHIJKL', {
        venue_public_id: CODE,
        venue_slug: 'Demo Club',
        table_label: '1',
      }),
    ).rejects.toThrow()
    await expect(
      writeTableTokenFile(store, 'tb_0123456789ABCDEFGHIJKL', {
        venue_public_id: 'vn_internalid',
        venue_slug: 'demo-club',
        table_label: '1',
      }),
    ).rejects.toThrow()
  })
})
