import { describe, expect, test } from 'vitest'
import { admitNode } from '../../src/core/admission'
import { canonicalJson, serializeNode } from '../../src/core/schema'

const base = () => ({
  format: 'tripscope',
  schemaVersion: 1,
  project: { id: 'p1', name: 'T', owner: '爸爸' },
  updatedAt: '2026-01-01T00:00:00.000Z',
  appVersion: '0.1.0',
  data: {},
  extraTop: { ok: 1 },
})

describe('admitNode:版本裁决', () => {
  test('损坏 JSON → corrupted', () => {
    expect(admitNode('{invalid').ok).toBe(false)
  })

  test('非 tripscope 格式 → foreign', () => {
    const raw = base()
    raw.format = 'otherapp'
    expect(admitNode(JSON.stringify(raw)).ok).toBe(false)
  })

  test('v1 正常准入,未知字段原样保留', () => {
    const r = admitNode(JSON.stringify(base()))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.mode).toBe('normal')
    expect((r.node.project as Record<string, unknown>).owner).toBe('爸爸')
    expect((r.node as Record<string, unknown>).extraTop).toEqual({ ok: 1 })
  })

  test('v99 → 只读;未知字段原样保留;导出往返不丢字段', () => {
    const raw = base()
    raw.schemaVersion = 99
    raw.budgetV99 = { totalCents: 42 }
    const r = admitNode(JSON.stringify(raw))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.mode).toBe('readonly')
    expect(r.reason).toContain('只读')
    expect((r.node as Record<string, unknown>).budgetV99).toEqual({ totalCents: 42 })
    const r2 = admitNode(serializeNode(r.node))
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(canonicalJson(r2.node)).toBe(canonicalJson(raw))
  })
})
