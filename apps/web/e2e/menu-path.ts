// The public address of a seeded venue, as the specs need it (CF-14, D68): `/m/<slug>-<code>`.
// The code is random and made when the venue is created, so a spec cannot hard-code it. It reads
// the venue's slug and code from the database with the owner connection the other specs already
// use (the e2e database is on this machine), and writes the path out in the documented form:
// the spec checks the address as a person would see it, not through the code that builds it.
import pg from 'pg'

export interface VenueAddress {
  readonly slug: string
  readonly publicId: string
  /** `/m/<slug>-<code>`. */
  readonly path: string
}

/** The address of the venue with this slug (the oldest one if several share it) or with this id. */
export async function addressOfVenue(
  by: { readonly slug: string } | { readonly venueId: string },
): Promise<VenueAddress> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL_OWNER, max: 1 })
  try {
    const { rows } =
      'slug' in by
        ? await pool.query<{ slug: string; public_id: string }>(
            'select slug, public_id from restro.venues where slug = $1 order by created_at, id limit 1',
            [by.slug],
          )
        : await pool.query<{ slug: string; public_id: string }>(
            'select slug, public_id from restro.venues where id = $1',
            [by.venueId],
          )
    const row = rows[0]
    if (!row) throw new Error(`there is no venue ${JSON.stringify(by)} in the e2e database`)
    return {
      slug: row.slug,
      publicId: row.public_id,
      path: `/m/${row.slug}-${row.public_id}`,
    }
  } finally {
    await pool.end()
  }
}
