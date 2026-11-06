// Where a venue's privacy notice link is set: Settings › Ordering's form for the venue's legal
// details (#288; Settings › Paying draws the same form). Plain, so a server component and a client
// one both use it.

/** The address of the legal details' form on the venue's Settings › Ordering. */
export function privacyHref(venueId: string): string {
  return `/venues/${venueId}?tab=settings&section=ordering#ord-legal`
}
