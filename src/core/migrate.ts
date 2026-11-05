import { SUPPORTED_SCHEMA_VERSION } from './schema'

type MigrationStep = (node: any) => any

/**
 * schemaVersion → schemaVersion+1 的迁移函数注册表。
 * v1 为初始版本,无历史版本需要迁移;后续版本在此登记迁移函数。
 */
const MIGRATIONS: Record<number, MigrationStep> = {}

export type MigrationResult =
  | { ok: true; node: any }
  | { ok: false; error: string }

export function runMigrations(node: any): MigrationResult {
  let cur = node
  let guard = 0
  while (cur.schemaVersion < SUPPORTED_SCHEMA_VERSION) {
    const step = MIGRATIONS[cur.schemaVersion]
    if (!step) return { ok: false, error: `缺少从 v${cur.schemaVersion} 的迁移函数` }
    try {
      cur = step(cur)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (++guard > 50) return { ok: false, error: '迁移步数异常,已中止' }
  }
  cur.schemaVersion = SUPPORTED_SCHEMA_VERSION
  return { ok: true, node: cur }
}
