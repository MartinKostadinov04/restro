// /guides/qr-links: the written guide to the two kinds of address on a table's QR code (brief
// S3-07), "How do I use my own link?" in the Tables & QR tab. It is the file docs/guides/qr-links.md
// of the project, in the admin's language (the file holds Bulgarian first, then English).
import { isId } from '@restro/core'
import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'

import { AdminHeader } from '@/components/admin/admin-header'
import { Markdown, splitLanguages } from '@/guides/markdown'
import { loadGuide } from '@/server/guides'
import { requireTenant } from '@/server/session'

export async function generateMetadata() {
  return { title: (await getTranslations('tables.guide'))('title') }
}

export default async function QrLinksGuidePage({ searchParams }: PageProps<'/guides/qr-links'>) {
  await requireTenant()
  const t = await getTranslations('tables.guide')
  const tNav = await getTranslations('nav')
  const locale = (await getLocale()).slice(0, 2)
  const source = await loadGuide('qr-links')
  const languages = source === null ? {} : splitLanguages(source)
  const text = languages[locale] ?? languages.bg ?? null
  // The tab links here with its venue, so "back" returns to that venue's tab.
  const venue = (await searchParams).venue
  const back =
    typeof venue === 'string' && isId('vn', venue) ? `/venues/${venue}?tab=tables` : '/venues'

  return (
    <>
      <AdminHeader trail={[{ label: tNav('venues'), href: '/venues' }]} current={t('title')} />
      <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        <Link
          href={back}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          data-testid="guide-back"
        >
          <ArrowLeftIcon className="size-4" aria-hidden />
          {t('back')}
        </Link>
        {text === null ? (
          <p className="text-sm text-muted-foreground" data-testid="guide-missing">
            {t('missing')}
          </p>
        ) : (
          <Markdown source={text} />
        )}
      </div>
    </>
  )
}
