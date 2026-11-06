import { describe, expect, test } from 'vitest'
import { runMigrations } from '../../src/core/migrate'
import { SUPPORTED_SCHEMA_VERSION } from '../../src/core/schema'

describe('runMigrations', () => {
  test('缺少迁移步骤 → 报错(迁移链缺步防护)', () => {
    const r = runMigrations({ schemaVersion: 0 } as any)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('缺少从 v0')
  })

  test('等于支持版本时恒等返回', () => {
    const n = { schemaVersion: SUPPORTED_SCHEMA_VERSION, data: { k: 1 } }
    const r = runMigrations(n as any)
    expect(r.ok).toBe(true)
  })
})
