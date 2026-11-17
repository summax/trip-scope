import { describe, expect, test } from 'vitest'
import { runMigrations, migrateV2toV3 } from '../../src/core/migrate'
import { SUPPORTED_SCHEMA_VERSION, type TripNode } from '../../src/core/schema'

function node(schemaVersion: number, data: Record<string, unknown>): TripNode {
  return {
    format: 'tripscope',
    schemaVersion,
    project: { id: 'p1', name: '旅行' },
    updatedAt: 'x',
    appVersion: 'v',
    data,
  } as unknown as TripNode
}

describe('v2→v3 业务数据收口', () => {
  test('migrateV2toV3 直通保真(零数据变换)', () => {
    const src = node(2, { legacy: { demo: { note: '旧' } }, someUnknown: 1 })
    const out = migrateV2toV3(src)
    expect(out.schemaVersion).toBe(2) // 版本由 runMigrations 统一 stamp
    expect((out as unknown as Record<string, unknown>).data).toEqual({
      legacy: { demo: { note: '旧' } },
      someUnknown: 1,
    })
    expect(out.project.id).toBe('p1')
  })

  test('v1 文件一路迁到 v3:legacy 归档 + rev 回填 + 版本 stamp', () => {
    const r = runMigrations(node(1, { demo: { note: 'v1数据' } }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.node.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION)
    expect(r.node.schemaVersion).toBe(3)
    expect(r.node.rev).toBe(0)
    const data = r.node.data as unknown as Record<string, unknown>
    expect(data.demo).toBeUndefined()
    expect((data.legacy as Record<string, unknown>).demo).toEqual({ note: 'v1数据' })
  })

  test('v2 文件迁移后 data.trip 缺省(惰性初始化,迁移不造业务数据)', () => {
    const r = runMigrations(node(2, {}))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.node.schemaVersion).toBe(3)
    expect((r.node.data as unknown as Record<string, unknown>).trip).toBeUndefined()
  })
})
