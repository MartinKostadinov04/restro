// /m/<organisation>/<venue> (D84) and the address of before, /m/<slug>-<code> (D68): the guest's
// menu. One catch-all route, because Next.js wants one name for a dynamic segment at a given
// depth and the two addresses differ in what their first part means. A static shell around one
// client component: it never touches the database (rule 4) and calls no server action; the
// browser reads the published files under /cdn (or the CDN) and the shell turns them into the
// page, starting from the organisation's index for the new address and from the venue's own file
// for the old one. The page corrects the address bar to the current names. Anything deeper than
// two parts names no venue. The sign-in gate in proxy.ts leaves this path alone.
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createTranslator } from 'next-intl'

import { GuestMenu } from '@/guest/guest-menu'
import bg from '../../../messages/bg.json'

// Bulgarian first: the guest's language is known only in the browser, and the shell is static (no
// request locale to read). The page names the tab in its own language at once, and after the
// menu's own title once it is loaded.
const t = createTranslator({ locale: 'bg', messages: bg, namespace: 'meta' })

export const metadata: Metadata = {
  title: { absolute: t('guestMenu') },
  robots: { index: false, follow: false },
}

export default async function GuestMenuPage({ params }: PageProps<'/m/[...address]'>) {
  const { address } = await params
  const [first, second, ...rest] = address
  if (first === undefined || rest.length > 0) notFound()
  if (second === undefined) return <GuestMenu venue={first} />
  return <GuestMenu address={{ organization: first, venue: second }} />
}
