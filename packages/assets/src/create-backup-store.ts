import type { BackupStoreConfig } from './backup-config'
import { type BackupStore, LocalBackupStore } from './backup-store'

/** Builds the backup store a configuration describes. */
export async function createBackupStore(config: BackupStoreConfig): Promise<BackupStore> {
  if (config.kind === 'local') return new LocalBackupStore({ rootDir: config.dir })
  const { R2BackupStore } = await import('./r2-backup-store')
  return R2BackupStore.fromSettings(config)
}
