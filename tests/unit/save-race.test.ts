import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import {
  flushDraft,
  newTrip,
  openBlankTool,
  save,
  setDraftDebounceForTest,
  state,
  updateData,
} from '../../src/core/store'
import { saveToHandle, downloadTripCopy } from '../../src/core/persistence/archive'
import { blankNode, BLANK_TOOL_ID, type TripNode } from '../../src/core/schema'
import { admitNode } from '../../src/core/admission'
import { serializeNode } from '../../src/core/schema'

vi.mock('../../src/core/persistence/archive', () => ({
  adoptHandle: vi.fn(),
  clearSessionFile: vi.fn(),
  downloadTripCopy: vi.fn(() => ({ ok: true, fileName: 'x.html' })),
  getSessionHandle: vi.fn(() => null),
  openTripViaPicker: vi.fn(),
  saveAsViaPicker: vi.fn(async () => ({ ok: true, fileName: 'x.html' })),
  saveToHandle: vi.fn(async () => ({ outcome: 'saved', html: '' })),
  sessionFileName: vi.fn(() => null),
  snapshotStatus: vi.fn(() => ({ ok: true, issues: [] })),
  pickerSupported: vi.fn(() => true),
}))
vi.mock('../../src/core/persistence/transfer', () => ({
  exportJson: vi.fn(() => ({ ok: true, fileName: 'x.json' })),
  importFromFile: vi.fn(async () => ({ ok: false, reason: 'unused' })),
}))

const saveToHandleMock = vi.mocked(saveToHandle)
const downloadTripCopyMock = vi.mocked(downloadTripCopy)
const storage = (globalThis as any).__tsStorage as {
  clear(): void
  has(k: string): boolean
  getItem(k: string): string | null
}

function blankTrip(name: string): TripNode {
  const n = blankNode()
  n.project = { id: BLANK_TOOL_ID, name }
  return n
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  flushDraft()
  storage.clear()
  state.screen = 'trip'
  state.readonly = false
  state.node = null
  state.fileUpdatedAt = null
  state.openMode = 'embedded'
  state.upgradeFromVersion = null
  state.upgradeConfirmOpen = false
  state.conflictFreshRaw = null
  state.storageError = null
  state.draftBanner = null
  setDraftDebounceForTest(300)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('P1 空白首次保存:失败不丢草稿', () => {
  test('S1 成功:新 ID 固化,旧空白草稿清理,下载的是真实 UUID', async () => {
    state.node = blankTrip('首次保存')
    updateData((d) => {
      if (!d.demo) d.demo = {}
      d.demo.note = '固化前编辑'
    })
    await save()
    expect(state.node?.project.id).not.toBe(BLANK_TOOL_ID)
    expect(state.node?.project.id.length).toBe(36)
    expect(downloadTripCopyMock.mock.calls[0][0].project.id).not.toBe(BLANK_TOOL_ID)
    expect(storage.has('tripscope:draft:' + BLANK_TOOL_ID)).toBe(false)
    expect(state.node?.rev).toBe(1)
  })

  test('S2 失败:原草稿保留、ID 不固化、rev 不采纳', async () => {
    state.node = blankTrip('失败场景')
    updateData((d) => {
      if (!d.demo) d.demo = {}
      d.demo.note = '失败前编辑'
    })
    vi.advanceTimersByTime(400) // 草稿先落盘
    expect(storage.has('tripscope:draft:' + BLANK_TOOL_ID)).toBe(true)
    downloadTripCopyMock.mockReturnValueOnce({ ok: false, reason: '磁盘满' })
    await save()
    expect(state.node?.project.id).toBe(BLANK_TOOL_ID)
    expect(storage.has('tripscope:draft:' + BLANK_TOOL_ID)).toBe(true)
    expect(storage.getItem('tripscope:draft:' + BLANK_TOOL_ID)).toContain('失败前编辑')
    expect(state.node?.rev).toBeUndefined()
    expect(state.toast).toContain('副本生成失败')
  })

  test('S3 失败后重新打开:原旅行数据可恢复', async () => {
    state.node = blankTrip('可恢复')
    updateData((d) => {
      if (!d.demo) d.demo = {}
      d.demo.note = '孤儿保护内容'
    })
    vi.advanceTimersByTime(400)
    downloadTripCopyMock.mockReturnValueOnce({ ok: false, reason: '磁盘满' })
    await save()
    // 模拟页面关闭后重开空白工具
    openBlankTool()
    expect(state.node?.data.demo?.note).toBe('孤儿保护内容')
  })

  test('S4 成功保存后旧 pendingDraft 不复活', async () => {
    state.node = blankTrip('竞态防护')
    updateData((d) => {
      if (!d.demo) d.demo = {}
      d.demo.note = '成功路径编辑'
    })
    await save()
    vi.advanceTimersByTime(500)
    expect(storage.has('tripscope:draft:' + BLANK_TOOL_ID)).toBe(false)
  })

  test('S5 newTrip 防复活守卫仍成立(旧键清理后不复活)', () => {
    state.node = blankTrip('旧空白')
    updateData((d) => {
      if (!d.demo) d.demo = {}
      d.demo.note = '旧空白编辑'
    })
    newTrip()
    vi.advanceTimersByTime(500)
    expect(storage.has('tripscope:draft:' + BLANK_TOOL_ID)).toBe(false)
  })
})

describe('P2 异步保存:时间戳与上下文守卫', () => {
  test('H1 保存期间新编辑:fileUpdatedAt=快照版本,新编辑草稿基准为旧磁盘版本', async () => {
    state.openMode = 'handle'
    state.node = blankNode()
    state.node.project = { id: 'race-1', name: '竞态旅行' }
    state.fileUpdatedAt = null
    let release!: () => void
    const gate = new Promise<void>((res) => {
      release = res
    })
    saveToHandleMock.mockImplementationOnce(async () => {
      await gate
      return { outcome: 'saved', html: '' }
    })
    const p = save()
    // 保存期间继续编辑:先推进时钟,updatedAt 推进到快照之后
    vi.advanceTimersByTime(50)
    updateData((d) => {
      if (!d.demo) d.demo = {}
      d.demo.note = '保存期间的新编辑'
    })
    const editAfterSnapshot = state.node!.updatedAt
    release()
    await p
    expect(state.node?.rev).toBe(1)
    expect(state.fileUpdatedAt).not.toBe(editAfterSnapshot)
    // 新编辑的草稿仍在排期,落盘后基准 = 保存前磁盘版本(null,即从未落盘)
    expect(pendingDraftBase()).toBeNull()
  })

  test('H2 保存期间切换旅行:旧保存回调不污染新旅行', async () => {
    state.openMode = 'handle'
    state.node = blankNode()
    state.node.project = { id: 'race-old', name: '旧旅行' }
    state.fileUpdatedAt = null
    let release!: () => void
    const gate = new Promise<void>((res) => {
      release = res
    })
    saveToHandleMock.mockImplementationOnce(async () => {
      await gate
      return { outcome: 'saved', html: '' }
    })
    const p = save()
    // 切换到新旅行(state.node 换成另一份节点)
    const other = blankNode()
    other.project = { id: 'race-new', name: '新旅行' }
    other.updatedAt = '2030-01-01T00:00:00.000Z'
    state.node = other
    release()
    await p
    // 旧旅行节点的 rev 未被采纳(state.node 已不是旧节点,无法采纳)
    expect(other.rev).toBeUndefined()
    expect(state.node?.project.id).toBe('race-new')
    expect(state.toast).toBe('已保存到文件')
  })

  test('H3 保存互斥:上笔未落定时重复 save() 直接跳过', async () => {
    state.openMode = 'handle'
    state.node = blankNode()
    state.node.project = { id: 'race-mutex', name: '互斥旅行' }
    let release!: () => void
    const gate = new Promise<void>((res) => {
      release = res
    })
    saveToHandleMock.mockImplementationOnce(async () => {
      await gate
      return { outcome: 'saved', html: '' }
    })
    const p1 = save()
    const p2 = save()
    release()
    await Promise.all([p1, p2])
    expect(saveToHandleMock).toHaveBeenCalledTimes(1)
  })
})

/** 读取挂起排期快照的 base(经存储侧验证:flush 后草稿的 baseUpdatedAt) */
function pendingDraftBase(): string | null {
  flushDraft()
  const raw = storage.getItem('tripscope:draft:race-1')
  if (!raw) return null
  const e = JSON.parse(raw) as { baseUpdatedAt: string | null }
  return e.baseUpdatedAt
}
