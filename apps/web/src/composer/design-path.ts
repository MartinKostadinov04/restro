// Where the Design page is (D129), and the Studio it goes back to: the open menu travels both ways.

/** The Design page of a venue, showing `menu` (else the live one). */
export function designPagePath(venueId: string, menu: string | null): string {
  const query = menu === null ? '' : `?${new URLSearchParams({ menu }).toString()}`
  return `/venues/${venueId}/design${query}`
}

/** The Studio of a venue, on `menu` (else the live one). */
export function studioPath(venueId: string, menu: string | null): string {
  const params = new URLSearchParams({ tab: 'studio' })
  if (menu !== null) params.set('menu', menu)
  return `/venues/${venueId}?${params.toString()}`
}
