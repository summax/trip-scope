import { beforeEach, describe, expect, test } from 'vitest'
import { admitNode } from '../../src/core/admission'
import { blankNode, serializeNode, type TripNode } from '../../src/core/schema'
import { resolveDraftOnOpen, saveDraft } from '../../src/core/persistence/storage'

const storage = (globalThis as any).__tsStorage as {
  clear(): void
  has(k: string): boolean
}

function v1Node(name: string, demoNote: string): TripNode {
  return {
    format: 'tripscope',
    schemaVersion: 1,
    project: { id: 'p-mig', name },
    updatedAt: '2026-01-01T00:00:00.000Z',
    appVersion: '0.1.0',
    data: { demo: { note: demoNote } } as TripNode['data'],
  }
}

beforeEach(() => {
  storage.clear()
})

describe('resolveDraftOnOpen:迁移后签名比对', () => {
  test('v1 草稿 + 迁移后文件 → 草稿迁到 v2 后签名相等,静默清除(不假横幅)', () => {
    const draft = v1Node('同名', '同一份演示内容')
    saveDraft(draft, null)
    const fileNode = admitNode(serializeNode(draft))
    expect(fileNode.ok).toBe(true)
    if (!fileNode.ok) return
    const r = resolveDraftOnOpen('p-mig', fileNode.node)
    expect(r.entry).toBeNull()
    expect(storage.has('tripscope:draft:p-mig')).toBe(false)
  })
  test('v1 草稿与迁移后文件真分歧 → 仍弹横幅(真阳性保留)', () => {
    const draft = v1Node('同名', '草稿独有内容')
    saveDraft(draft, null)
    const file = v1Node('同名', '文件独有内容')
    const admitted = admitNode(serializeNode(file))
    expect(admitted.ok).toBe(true)
    if (!admitted.ok) return
    const r = resolveDraftOnOpen('p-mig', admitted.node)
    expect(r.entry?.node.data.demo?.note).toBe('草稿独有内容')
  })

  test('损坏草稿 → 视同不存在:不弹横幅也不删', () => {
    const s = (globalThis as any).__tsStorage
    s.setItem(
      'tripscope:draft:p-corrupt',
      JSON.stringify({ node: { schemaVersion: 'x', project: { id: 'p-corrupt' } }, savedAt: 't', baseUpdatedAt: null }),
    )
    const fileNode = blankNode()
    const r = resolveDraftOnOpen('p-corrupt', fileNode)
    expect(r.entry).toBeNull()
    expect(s.has('tripscope:draft:p-corrupt')).toBe(true)
  })

  test('高版本草稿 → 诚实横幅(entry 保留,恢复走只读)', () => {
    const n = blankNode()
    n.schemaVersion = 99
    n.project = { id: 'p-future', name: '未来草稿' }
    saveDraft(n, null)
    const r = resolveDraftOnOpen('p-future', blankNode())
    expect(r.entry?.node.schemaVersion).toBe(99)
  })
})
