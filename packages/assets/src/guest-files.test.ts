import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { newId } from '@restro/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  parseGuestFile,
  readTableTokenFile,
  readVenueIndex,
  TableTokenFileSchema,
  VenueIndexSchema,
  venueIndexBytes,
  writeTableTokenFile,
} from './guest-files'
import { publishPutOptions, venueIndexPath } from './publish-paths'
import { LocalPublishStore } from './publish-store'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

describe('guest files (slug index and table tokens)', () => {
  let root: string
  let store: LocalPublishStore

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'restro-guest-files-'))
    store = new LocalPublishStore({ rootDir: root })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('round-trips a slug index', async () => {
    const index = { venue_id: newId('vn'), menu_id: newId('nd') }
    await store.put(
      venueIndexPath('demo-club'),
      venueIndexBytes(index),
      publishPutOptions(venueIndexPath('demo-club')),
    )
    expect(await readVenueIndex(store, 'demo-club')).toEqual(index)
    expect(await readVenueIndex(store, 'other-club')).toBeNull()
  })

  it('writes a table token file and reads it back', async () => {
    await writeTableTokenFile(store, 'tb_0123456789ABCDEFGHIJKL', {
      venue_slug: 'demo-club',
      table_label: '12',
    })
    expect(await readTableTokenFile(store, 'tb_0123456789ABCDEFGHIJKL')).toEqual({
      venue_slug: 'demo-club',
      table_label: '12',
    })
    expect(await readTableTokenFile(store, 'tb_ZZZZZZZZZZZZZZZZZZZZZZ')).toBeNull()
  })

  it('treats a malformed file as no file', async () => {
    expect(parseGuestFile(TableTokenFileSchema, null)).toBeNull()
    expect(parseGuestFile(TableTokenFileSchema, new TextEncoder().encode('{not json'))).toBeNull()
    expect(parseGuestFile(TableTokenFileSchema, bytes({ venue_slug: 'Demo Club' }))).toBeNull()
    expect(
      parseGuestFile(
        TableTokenFileSchema,
        bytes({ venue_slug: 'demo-club', table_label: '12', barsy_id: 55 }),
      ),
    ).toBeNull()
    expect(parseGuestFile(VenueIndexSchema, bytes({ venue_id: 'vn_x', menu_id: 'nd_x' }))).toBeNull()
  })

  it('refuses to write a token file with a bad label or slug', async () => {
    await expect(
      writeTableTokenFile(store, 'tb_0123456789ABCDEFGHIJKL', {
        venue_slug: 'demo-club',
        table_label: '   ',
      }),
    ).rejects.toThrow()
    await expect(
      writeTableTokenFile(store, 'tb_0123456789ABCDEFGHIJKL', {
        venue_slug: 'Demo Club',
        table_label: '1',
      }),
    ).rejects.toThrow()
  })
})
