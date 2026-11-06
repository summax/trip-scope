import { describe, expect, test } from 'vitest'
import {
  SUPPORTED_SCHEMA_VERSION,
  blankNode,
  normalizeRev,
  parseNodeJson,
  serializeNode,
  stampNodeForWrite,
  type TripNode,
} from '../../src/core/schema'

describe('v2 信封', () => {
  test('SUPPORTED_SCHEMA_VERSION = 2', () => {
    expect(SUPPORTED_SCHEMA_VERSION).toBe(2)
  })

  test('blankNode 为 v2 形态(rev 缺省,trip 字段不在契约内)', () => {
    const n = blankNode()
    expect(n.schemaVersion).toBe(SUPPORTED_SCHEMA_VERSION)
    expect(n.rev).toBeUndefined()
    expect('trip' in n.data).toBe(false)
  })
})

describe('rev 原样持有与规范化', () => {
  test('parseNodeJson 对 rev 不校验不回填(原样持有)', () => {
    expect(parseNodeJson('{"schemaVersion":2,"project":{"id":"p1"}}').ok).toBe(true)
    const r = parseNodeJson(
      '{"schemaVersion":2,"project":{"id":"p1"},"rev":"garbage","x":1}',
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect((r.node as unknown as Record<string, unknown>).rev).toBe('garbage')
  })

  test('normalizeRev:合法保留,缺失/负数/小数/garbage 归 0', () => {
    expect(normalizeRev(0)).toBe(0)
    expect(normalizeRev(7)).toBe(7)
    expect(normalizeRev(undefined)).toBe(0)
    expect(normalizeRev(-3)).toBe(0)
    expect(normalizeRev(1.5)).toBe(0)
    expect(normalizeRev('abc')).toBe(0)
  })
})

describe('stampNodeForWrite', () => {
  test('rev 自增、appVersion 盖当前应用版本', () => {
    const n = blankNode()
    stampNodeForWrite(n)
    expect(n.rev).toBe(1)
    expect(n.appVersion).toBe(__APP_VERSION__)
  })
  test('rev 非法值 bump 时归 1;重复 stamp 单调', () => {
    const n = blankNode()
    ;(n as unknown as Record<string, unknown>).rev = 'x'
    stampNodeForWrite(n)
    expect(n.rev).toBe(1)
    stampNodeForWrite(n)
    expect(n.rev).toBe(2)
  })
})
