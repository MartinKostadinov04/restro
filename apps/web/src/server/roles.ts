// What a role in the organisation (`auth_member.role`) allows. Pure, so pages, server actions and
// tests share one answer. Better Auth stores a role as text and may join several with commas
// (`admin,member`); anything that is not exactly `owner` or `admin` grants nothing.

/** The roles that may connect barsy, change its credentials or settings, and start a sync. */
const INTEGRATION_MANAGERS: ReadonlySet<string> = new Set(['owner', 'admin'])

/** True for an owner or admin of the organisation. */
export function canManageIntegration(role: string | null | undefined): boolean {
  if (typeof role !== 'string') return false
  return role
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .some((part) => INTEGRATION_MANAGERS.has(part))
}

/**
 * True for an owner of the organisation: the only role that may delete a venue or restore a
 * deleted one (D76). An admin renames and manages, but deleting is the owner's decision.
 */
export function canDeleteVenue(role: string | null | undefined): boolean {
  if (typeof role !== 'string') return false
  return role
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .some((part) => part === 'owner')
}

/**
 * True for an owner of the organisation: the only role that may change the organisation's name
 * and its address name (Settings › General, D91). Both reach every guest address, so it is the
 * owner's decision, like deleting a venue; admins and members see the values.
 */
export function canManageOrganization(role: string | null | undefined): boolean {
  return canDeleteVenue(role)
}

/**
 * True for the roles that may publish a menu, or roll it back to an earlier version (brief
 * S3-01b): an owner or admin, like the integration.
 */
export function canPublishMenu(role: string | null | undefined): boolean {
  return canManageIntegration(role)
}

/**
 * True for the roles that may mark items sold out tonight, or take the mark off (brief S3-08,
 * D46): an owner or admin. Waiters do not use our admin.
 */
export function canMarkSoldOut(role: string | null | undefined): boolean {
  return canManageIntegration(role)
}
