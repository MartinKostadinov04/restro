// Where a venue's privacy notice link is set: Settings › Paying, with its legal details (#198).
// Plain, so a server component and a client one both use it.

/** The address of the venue's Settings › Paying. */
export function privacyHref(venueId: string): string {
  return `/venues/${venueId}?tab=settings&section=paying`
}
