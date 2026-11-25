// /book/<organisation>/<venue> (#577): the venue's booking page. A static shell around one client
// component, like the menu page: it never touches the database (rule 4) and calls no server
// action; the browser reads the published files under /cdn (or the CDN), and asks the booking API
// only whether a night can be booked and to send the request. Anything but two parts names no
// venue. The sign-in gate in proxy.ts leaves this path alone.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createTranslator } from 'next-intl'

import { BookingPage } from '@/guest/booking-page'
import bg from '../../../messages/bg.json'
import en from '../../../messages/en.json'

/** The tab's first title, in the language the address asks for (`?lang=en`), Bulgarian otherwise. */
export async function generateMetadata({
  searchParams,
}: Pick<PageProps<'/book/[...address]'>, 'searchParams'>): Promise<Metadata> {
  const { lang } = await searchParams
  const english = lang === 'en'
  const t = createTranslator({
    locale: english ? 'en' : 'bg',
    messages: english ? en : bg,
    namespace: 'meta',
  })
  return {
    title: { absolute: t('bookingPage') },
    robots: { index: false, follow: false },
  }
}

export default async function BookingAddressPage({ params }: PageProps<'/book/[...address]'>) {
  const { address } = await params
  const [organization, venue, ...rest] = address
  if (organization === undefined || venue === undefined || rest.length > 0) notFound()
  return <BookingPage address={{ organization, venue }} />
}
