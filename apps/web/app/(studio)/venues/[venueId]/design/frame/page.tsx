// /venues/<id>/design/frame: what a frame of the Design page loads (D129, RR-87): a document of its own
// for the renderer, so it lays out at the frame's width. It reads no data: what it draws is held by
// the Design page around it (`preview-frames.ts`), and it is empty without one.
import type { Metadata } from 'next'

import { DesignFrame } from '@/design/design-frame'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default async function DesignFramePage({
  searchParams,
}: PageProps<'/venues/[venueId]/design/frame'>) {
  const { slot } = await searchParams
  return <DesignFrame slot={typeof slot === 'string' ? slot : 'main'} />
}
