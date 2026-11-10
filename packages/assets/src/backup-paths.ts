// The keys of database backups in the backup store (./backup-store.ts): one flat prefix, one
// object per dump, named by the minute the dump was taken in UTC. The key carries the time, so
// retention never depends on a store's own modification time (a copied or restored bucket keeps
// it), and an object that is not of this exact shape is never treated as a backup, so retention
// can never remove something else that was put under the prefix by hand.

/** Where the dumps live inside the backup store. */
export const BACKUP_PREFIX = 'db/'

const KEY_PATTERN = /^db\/restro-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.dump$/

/** The key of the dump taken at `takenAt`: `db/restro-20261108T140000Z.dump`. */
export function backupKey(takenAt: Date): string {
  const stamp = takenAt
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replaceAll('-', '')
    .replaceAll(':', '')
  return `${BACKUP_PREFIX}restro-${stamp}.dump`
}

/** When the dump under `key` was taken, or null when the key is not one `backupKey` builds. */
export function parseBackupKey(key: string): Date | null {
  const match = KEY_PATTERN.exec(key)
  if (match === null) return null
  const [, year, month, day, hour, minute, second] = match
  const taken = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)
  // A shape-correct but impossible time (month 13) is not a backup either.
  return Number.isNaN(taken.getTime()) || backupKey(taken) !== key ? null : taken
}
