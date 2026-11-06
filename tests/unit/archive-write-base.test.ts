import { describe, expect, test } from 'vitest'
import { resolveWriteBase } from '../../src/core/persistence/archive'
import { findDataNode, parseNodeJson, replaceDataNode, serializeNode, blankNode } from '../../src/core/schema'

const SNAPSHOT = `<!DOCTYPE html><html><head><style>a{}</style></head><body>` +
  `<script id="app-data" type="application/json">{}</script>` +
  `<script>/*! tripscope-app */ NEW-APP-CODE</script></body></html>`

const OLD_HTML = `<!DOCTYPE html><html><head><style>a{}</style></head><body>` +
  `<script id="app-data" type="application/json">{}</script>` +
  `<script>OLD-APP-CODE</script></body></html>`

function migratedNode(): ReturnType<typeof blankNode> {
  const n = blankNode()
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

describe('升级写回产物语义:不允许「新数据 + 旧应用代码」', () => {
  test('升级替换后的完整文件不含旧应用代码,含当前应用标记', () => {
    const wb = resolveWriteBase(OLD_HTML, true, SNAPSHOT, true, [])
    expect(wb.ok).toBe(true)
    if (!wb.ok) return
    const r = replaceDataNode(wb.base, migratedNode())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.html).not.toContain('OLD-APP-CODE')
    expect(r.html).toContain('NEW-APP-CODE')
    const found = findDataNode(r.html)
    expect(found.ok).toBe(true)
  })

  test('普通写回保留原文其余部分(仅换数据节点,by design)', () => {
    const wb = resolveWriteBase(OLD_HTML, false, SNAPSHOT, true, [])
    expect(wb.ok).toBe(true)
    if (!wb.ok) return
    const r = replaceDataNode(wb.base, migratedNode())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.html).toContain('OLD-APP-CODE')
  })
})
