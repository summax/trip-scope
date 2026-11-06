import { describe, expect, test } from 'vitest'
import { resolveWriteBase } from '../../src/core/persistence/archive'
import { findDataNode, parseNodeJson, replaceDataNode, serializeNode, blankNode } from '../../src/core/schema'

const SNAPSHOT = `<!DOCTYPE html><html><head><style>a{}</style></head><body>` +
  `<script id="app-data" type="application/json">{}</script>` +
  `<script>/*! tripscope-app */ NEW-APP-CODE</script></body></html>`

const OLD_HTML = `<!DOCTYPE html><html><head><style>a{}</style></head><body>` +
  `<script id="app-data" type="application/json">{}</script>` +
  `<script>OLD-APP-CODE</script></body></html>`

/** 模拟迁移产物:旧版本数据经迁移链后的形状(带哨兵标记,供提取回读断言) */
function migratedNode() {
  const n = blankNode()
  n.schemaVersion = 2
  n.appVersion = 'legacy-writer-9.9.9'
  n.project = { id: 'migrated-1', name: '已迁移旅行' }
  n.data = { demo: { note: 'MIGRATED-DATA-SENTINEL' } }
  return n
}

describe('resolveWriteBase:底稿裁决', () => {
  test('普通数据写回以磁盘原文为底(data-only)', () => {
    const r = resolveWriteBase(OLD_HTML, false, SNAPSHOT, true, [])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.base).toBe(OLD_HTML)
      expect(r.kind).toBe('data-only')
    }
  })

  test('应用升级写回必须以快照为底(full-app)', () => {
    const r = resolveWriteBase(OLD_HTML, true, SNAPSHOT, true, [])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.base).toBe(SNAPSHOT)
      expect(r.kind).toBe('full-app')
    }
  })

  test('升级写回但快照不可用时明确拒绝(不降级伪装)', () => {
    const r = resolveWriteBase(OLD_HTML, true, null, false, ['缺少内联样式'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('缺少内联样式')
  })
})

describe('升级写回产物语义:新应用代码 + 迁移数据完整保留', () => {
  test('升级替换后不含旧应用代码、含当前应用标记,且迁移数据原样落盘(提取回读)', () => {
    const wb = resolveWriteBase(OLD_HTML, true, SNAPSHOT, true, [])
    expect(wb.ok).toBe(true)
    if (!wb.ok) return
    const r = replaceDataNode(wb.base, migratedNode())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.html).not.toContain('OLD-APP-CODE')
    expect(r.html).toContain('NEW-APP-CODE')
    // 迁移后的旅行数据必须原样落在新文件的数据节点里(哨兵回读)
    const found = findDataNode(r.html)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    const parsed = parseNodeJson(found.json)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.node.schemaVersion).toBe(2)
    expect(parsed.node.appVersion).toBe('legacy-writer-9.9.9')
    expect(parsed.node.project.id).toBe('migrated-1')
    expect(parsed.node.data.demo?.note).toBe('MIGRATED-DATA-SENTINEL')
  })

  test('普通写回保留原文其余部分(仅换数据节点,by design)', () => {
    const wb = resolveWriteBase(OLD_HTML, false, SNAPSHOT, true, [])
    expect(wb.ok).toBe(true)
    if (!wb.ok) return
    const r = replaceDataNode(wb.base, migratedNode())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.html).toContain('OLD-APP-CODE')
    // 普通写回同样保数据:哨兵回读
    const found = findDataNode(r.html)
    expect(found.ok).toBe(true)
    if (!found.ok) return
    const parsed = parseNodeJson(found.json)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.node.data.demo?.note).toBe('MIGRATED-DATA-SENTINEL')
  })
})
