import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  deleteFromPanel,
  flushDraft,
  setDraftDebounceForTest,
  state,
  updateData,
} from '../../src/core/store'
import { blankNode, type TripNode } from '../../src/core/schema'
import { resolveDraftOnOpen, saveDraft } from '../../src/core/persistence/storage'

const storage = (globalThis as any).__tsStorage as {
  clear(): void
  has(k: string): boolean
  getItem(k: string): string | null
  failWrites: boolean
}

function trip(id: string, name = '测试旅行'): TripNode {
  const n = blankNode()
  n.project = { id, name }
  return n
}

beforeEach(() => {
  vi.useFakeTimers()
  flushDraft()
  storage.clear()
  state.screen = 'trip'
  state.readonly = false
  state.storageError = null
  state.draftBanner = null
  setDraftDebounceForTest(300)
})

afterEach(() => {
  vi.useRealTimers()
  storage.failWrites = false
})

describe('R1 回归:deleteFromPanel 清除待冲刷排期快照', () => {
  test('编辑后立即删除,debounce 到点后草稿不被复活', () => {
    state.node = trip('id-r1', 'R1旅行')
    updateData((d) => {
      if (!d.demo) d.demo = {}
      d.demo.note = '待复活内容'
    })
    deleteFromPanel('id-r1')
    vi.advanceTimersByTime(500)
    expect(storage.has('tripscope:draft:id-r1')).toBe(false)
    expect(state.storageError).toBeNull()
  })
})

describe('排期快照语义:上下文切换后写入原旅行的键', () => {
  test('排期后切换 state.node,落盘仍是原旅行的键与内容', () => {
    state.node = trip('id-a', '旅行A')
    updateData((d) => {
      if (!d.demo) d.demo = {}
      d.demo.note = 'A的编辑'
    })
    state.node = trip('id-b', '旅行B')
    vi.advanceTimersByTime(500)
    expect(storage.has('tripscope:draft:id-a')).toBe(true)
    expect(storage.getItem('tripscope:draft:id-a')).toContain('A的编辑')
    expect(storage.has('tripscope:draft:id-b')).toBe(false)
  })
})

describe('debounce 可注入', () => {
  test('窗口内不落盘,越窗后落盘', () => {
    setDraftDebounceForTest(2000)
    state.node = trip('id-t', 'T旅行')
    updateData((d) => {
      if (!d.demo) d.demo = {}
      d.demo.note = '窗口测试'
    })
    vi.advanceTimersByTime(1500)
    expect(storage.has('tripscope:draft:id-t')).toBe(false)
    vi.advanceTimersByTime(600)
    expect(storage.has('tripscope:draft:id-t')).toBe(true)
    expect(storage.getItem('tripscope:draft:id-t')).toContain('窗口测试')
  })
})

describe('草稿写入失败必须可见', () => {
  test('存储写失败 → storageError', () => {
    storage.failWrites = true
    state.node = trip('id-f', 'F旅行')
    updateData((d) => {
      if (!d.demo) d.demo = {}
      d.demo.note = '配额满场景'
    })
    vi.advanceTimersByTime(400)
    expect(state.storageError).toContain('草稿保存失败')
  })
})

describe('resolveDraftOnOpen 裁决', () => {
  test('签名一致 → 静默清除冗余草稿', () => {
    const n = trip('id-sig', '签名旅行')
    expect(saveDraft(n, null).ok).toBe(true)
    const r = resolveDraftOnOpen('id-sig', n)
    expect(r.entry).toBeNull()
    expect(storage.has('tripscope:draft:id-sig')).toBe(false)
  })

  test('内容不同 → 返回横幅草稿,不静默覆盖', () => {
    const fileNode = trip('id-sig2', '文件版')
    const draftNode = trip('id-sig2', '草稿版')
    saveDraft(draftNode, '2026-01-01T00:00:00.000Z')
    const r = resolveDraftOnOpen('id-sig2', fileNode)
    expect(r.entry?.node.project.name).toBe('草稿版')
  })
})
