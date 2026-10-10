// /m/<venue>: the guest's menu (brief S3-03). A static shell around one client component. It never
// touches the database (rule 4) and calls no server action: the browser reads the published files
// under /cdn (or the CDN) and the shell turns them into the page. The sign-in gate in proxy.ts
// leaves this path alone.
import type { Metadata } from 'next'

import { GuestMenu } from '@/guest/guest-menu'

export const metadata: Metadata = {
  // The menu's own title replaces this once it is loaded.
  title: { absolute: 'Menu' },
  robots: { index: false, follow: false },
}

export default async function GuestMenuPage({ params }: PageProps<'/m/[venue]'>) {
  const { venue } = await params
  return <GuestMenu slug={venue} />
}
