import { describe, expect, test } from 'vitest'
import { admitNode } from '../../src/core/admission'
import { migrateV1toV2, runMigrations } from '../../src/core/migrate'
import { SUPPORTED_SCHEMA_VERSION, type TripNode } from '../../src/core/schema'

function v1Node(data: Record<string, unknown>, extra: Record<string, unknown> = {}): TripNode {
  return {
    format: 'tripscope',
    schemaVersion: 1,
    project: { id: 'p1', name: 'T' },
    updatedAt: '2026-01-01T00:00:00.000Z',
    appVersion: '0.1.0',
    data: data as TripNode['data'],
    ...extra,
  }
}

describe('runMigrations:守卫', () => {
  test('缺少迁移步骤 → 报错(迁移链缺步防护)', () => {
    const r = runMigrations({ schemaVersion: 0 } as unknown as TripNode)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('缺少从 v0')
  })

  test('等于支持版本时恒等返回', () => {
    const n = v1Node({})
    n.schemaVersion = SUPPORTED_SCHEMA_VERSION
    const r = runMigrations(n)
    expect(r.ok).toBe(true)
  })

  test('链连续性:从 v1 到 SUPPORTED-1 每一步都存在', () => {
    for (let v = 1; v < SUPPORTED_SCHEMA_VERSION; v++) {
      const r = runMigrations({ ...v1Node({}), schemaVersion: v } as TripNode)
      expect(r.ok).toBe(true)
    }
  })
})

describe('migrateV1toV2', () => {
  test('全景:rev 回填 0、demo 归档 legacy.demo、未知字段保真、信封不动', () => {
    const n = v1Node(
      { demo: { note: 'X' }, custom: 'keep' },
      { extraTop: { ok: 1 }, rev: 7 },
    )
    const r = migrateV1toV2(n)
    expect(r.schemaVersion).toBe(1)
    expect(r.rev).toBe(7)
    expect((r.data as Record<string, unknown>).demo).toBeUndefined()
    const legacy = (r.data as Record<string, unknown>).legacy as { demo?: unknown }
    expect(legacy.demo).toEqual({ note: 'X' })
    expect((r.data as Record<string, unknown>).custom).toBe('keep')
    expect((r as unknown as Record<string, unknown>).extraTop).toEqual({ ok: 1 })
    expect(r.project).toEqual({ id: 'p1', name: 'T' })
    expect(r.updatedAt).toBe('2026-01-01T00:00:00.000Z')
    // 纯函数:输入对象未被修改
    expect((n.data as Record<string, unknown>).demo).toEqual({ note: 'X' })
  })
  test('rev 非法值归 0;数组 data 容错', () => {
    const bad = migrateV1toV2(v1Node({}, { rev: 'abc' }))
    expect(bad.rev).toBe(0)
    const neg = migrateV1toV2(v1Node({}, { rev: -3 }))
    expect(neg.rev).toBe(0)
    const arr = migrateV1toV2(v1Node([] as unknown as Record<string, unknown>))
    expect(arr.schemaVersion).toBe(1)
  })

  test('幂等:对迁移产物再跑一遍不变(除 stamp 外无副作用)', () => {
    const first = migrateV1toV2(v1Node({ demo: { note: 'X' } }))
    const second = migrateV1toV2(first)
    const { schemaVersion: _sv, ...rest } = second as Record<string, unknown>
    expect(second.rev).toBe(first.rev)
    expect(JSON.stringify(second.data)).toBe(JSON.stringify(first.data))
    void rest
  })

  test('已有 legacy 合并且不覆盖既有字段', () => {
    const r = migrateV1toV2(v1Node({ demo: { note: 'D' }, legacy: { mine: 1 } }))
    const legacy = (r.data as Record<string, unknown>).legacy as Record<string, unknown>
    expect(legacy.mine).toBe(1)
    expect((legacy.demo as { note?: string }).note).toBe('D')
  })
})

describe('runMigrations 端到端 v1→v2', () => {
  test('v1 节点迁移到当前版本,migratedFrom 语义成立', () => {
    const r = runMigrations(v1Node({ demo: { note: '旧演示' } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.node.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION)
    const d = r.node.data as Record<string, unknown>
    expect(d.demo).toBeUndefined()
    expect((d.legacy as { demo?: { note?: string } }).demo?.note).toBe('旧演示')
  })
})

describe('legacy 异常拒绝(迁移永不覆盖/丢弃既有内容)', () => {
  test('legacy.demo 同键冲突 → 迁移失败,原值保留', () => {
    const r = runMigrations(
      v1Node({ demo: { note: '新' }, legacy: { demo: { note: '旧' }, custom: 1 } }),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('legacy.demo')
    expect(r.error).toContain('冲突')
  })

  test('legacy 为数组 → 迁移失败', () => {
    const r = runMigrations(v1Node({ demo: { note: 'X' }, legacy: ['原值'] }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('数组')
  })

  test('legacy 为字符串 → 迁移失败', () => {
    const r = runMigrations(v1Node({ demo: { note: 'X' }, legacy: '原值' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('string')
  })

  test('legacy 为 null 视同不存在,正常归档', () => {
    const r = migrateV1toV2(v1Node({ demo: { note: 'X' }, legacy: null }))
    const d = r.data as Record<string, unknown>
    expect(d.demo).toBeUndefined()
    expect((d.legacy as { demo?: { note?: string } }).demo?.note).toBe('X')
  })

  test('admission 层:异常 legacy → 只读 + 原因可见', () => {
    const n = v1Node({ demo: { note: 'X' }, legacy: ['原值'] })
    const adm = admitNode(JSON.stringify(n))
    expect(adm.ok).toBe(true)
    if (!adm.ok) return
    expect(adm.mode).toBe('readonly')
    expect(adm.reason).toContain('迁移失败')
    expect(adm.reason).toContain('数组')
  })
})
