// Who an alert's push goes to (#87; part 2's payment alerts, D120, D122 §7). The switches of the
// Alerts settings choose whose devices ring; an alert raised with a permission (`money.follow_up`:
// a payment to check, items not back, a payment stranded, a capture that failed, the paying pause)
// rings only for switched-on people whose role at the venue holds it (an owner always does), and
// `ownersOnly` steps narrow it further. The switches never silence it for everyone: when nobody
// switched on holds the permission, it rings for every holder who has a device. Pure: no I/O.

/** A person who may get a push: their devices, and what they hold at the venue. */
export interface PushRecipient {
  readonly userId: string
  /** An owner of the organisation or of the venue: holds every permission. */
  readonly owner: boolean
  /** Their switch in the Alerts settings is on. */
  readonly switchedOn: boolean
  /** The permissions their role at the venue holds (an owner holds all, whatever is listed). */
  readonly holds: ReadonlySet<string>
}

/**
 * The people an alert raised with `permission` (null: none) pushes to in a step.
 * - No permission: the switched-on people.
 * - A permission: the switched-on people who hold it; if there are none, every holder.
 * `ownersOnly` limits who qualifies to owners, before the fallback.
 */
export function pushTargets<R extends PushRecipient>(
  recipients: readonly R[],
  permission: string | null,
  ownersOnly: boolean,
): R[] {
  // Who may get it at all: holds the permission (an owner always does) and, for an owners-only
  // step, is an owner. The fallback comes after this, so a step for owners never ends up empty
  // because a switched-on non-owner held the permission.
  const qualifies = (recipient: R) =>
    (recipient.owner || permission === null || recipient.holds.has(permission)) &&
    (!ownersOnly || recipient.owner)
  const switchedOn = recipients.filter((recipient) => recipient.switchedOn && qualifies(recipient))
  return permission !== null && switchedOn.length === 0 ? recipients.filter(qualifies) : switchedOn
}
