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
