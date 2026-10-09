import { isId } from '@restro/core'
import { type NodeRow, nodes, withTenant } from '@restro/db'
import { and, asc, eq, ne } from 'drizzle-orm'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { LocaleToggle } from '@/components/locale-toggle'
import { Button } from '@/components/ui/button'
import { getAssetStore } from '@/server/assets'
import { getPool } from '@/server/db'
import { loadItemSheet } from '@/server/item-sheet/service'
import { requireTenant } from '@/server/session'
import { listVenues } from '@/server/venues'

import { ItemSheetHost } from './item-sheet-host'

export async function generateMetadata() {
  const t = await getTranslations('devItemSheet')
  return { title: t('title') }
}

/** The most items the harness lists: it is a test bench, not the composer. */
const MAX_ITEMS = 40

/**
 * Development-only harness for the item sheet: lists the items of the first venue and opens the
 * sheet for the one in `?item=`. Needs a signed-in person (saves are real and go through
 * apply()). In production the route does not exist; the composer (S2-06a) opens the sheet there.
 */
export default async function DevItemSheetPage({ searchParams }: PageProps<'/dev/item-sheet'>) {
  if (process.env.NODE_ENV !== 'development') notFound()
  const t = await getTranslations('devItemSheet')
  const { organization } = await requireTenant()
  const venue = (await listVenues(organization.id))[0]
  const requested = (await searchParams).item
  const selected = typeof requested === 'string' && isId('nd', requested) ? requested : null

  let rows: NodeRow[] = []
  const titles = new Map<string, string>()
  if (venue) {
    rows = await withTenant(getPool(), organization.id, (tx) =>
      tx
        .select()
        .from(nodes)
        .where(and(eq(nodes.nodeType, 'item'), ne(nodes.status, 'archived')))
        .orderBy(asc(nodes.createdAt), asc(nodes.id))
        .limit(MAX_ITEMS),
    )
    const store = await getAssetStore()
    for (const row of rows) {
      const sheet = await loadItemSheet(
        { pool: getPool(), tenantId: organization.id, venueId: venue.id, itemId: row.id },
        { store },
      )
      titles.set(row.id, sheet?.title ?? '')
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('description')}</p>
        </div>
        <LocaleToggle />
      </div>
      {!venue ? (
        <p className="text-sm text-muted-foreground">{t('noMenu')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('noItems')}</p>
      ) : (
        <ul className="grid gap-2" data-testid="dev-item-list">
          {rows.map((row) => {
            const name = titles.get(row.id) || t('unnamed')
            return (
              <li key={row.id}>
                <Button asChild variant="outline" className="w-full justify-start">
                  <Link
                    href={`/dev/item-sheet?item=${row.id}`}
                    data-testid="dev-item-link"
                    aria-label={t('open', { name })}
                  >
                    {name}
                  </Link>
                </Button>
              </li>
            )
          })}
        </ul>
      )}
      {venue && selected ? <ItemSheetHost itemId={selected} venueId={venue.id} /> : null}
    </main>
  )
}
