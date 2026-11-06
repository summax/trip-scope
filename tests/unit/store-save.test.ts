import { beforeEach, describe, expect, test, vi } from 'vitest'
import { flushDraft, save, state, updateData } from '../../src/core/store'
import { saveToHandle, downloadTripCopy } from '../../src/core/persistence/archive'
import { blankNode, type TripNode } from '../../src/core/schema'

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

function tripNode(): TripNode {
  const n = blankNode()
  n.project = { id: 'sv-1', name: '保存痕迹旅行' }
  return n
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  flushDraft()
  ;(globalThis as any).__tsStorage.clear()
  state.screen = 'trip'
  state.readonly = false
  state.node = tripNode()
  state.upgradeFromVersion = null
  state.upgradeConfirmOpen = false
  state.conflictFreshRaw = null
  state.storageError = null
})

import { afterEach } from 'vitest'

afterEach(() => {
  vi.useRealTimers()
})

describe('保存痕迹:rev 只在真落盘时推进', () => {
  test('E1 嵌入保存:快照带痕落盘,成功后采纳 rev=1', async () => {
    state.openMode = 'embedded'
    await save()
    expect(state.node?.rev).toBe(1)
    expect(state.node?.appVersion).toBe(__APP_VERSION__)
    expect(downloadTripCopyMock.mock.calls[0][0].rev).toBe(1)
    expect(state.fileUpdatedAt).toBe(state.node?.updatedAt)
  })

  test('E2 嵌入保存失败(副本生成失败):rev 不采纳', async () => {
    state.openMode = 'embedded'
    downloadTripCopyMock.mockResolvedValueOnce({ ok: false, reason: '磁盘满' })
    await save()
    expect(state.node?.rev).toBeUndefined()
  })

  test('H1 句柄保存:两次成功保存 rev 单调 1→2', async () => {
    state.openMode = 'handle'
    await save()
    expect(saveToHandleMock.mock.calls[0][0].rev).toBe(1)
    expect(state.node?.rev).toBe(1)
    updateData((d) => {
      if (!d.demo) d.demo = {}
      d.demo.note = '第二次编辑'
    })
    await save()
    expect(saveToHandleMock.mock.calls[1][0].rev).toBe(2)
    expect(state.node?.rev).toBe(2)
  })

  test('H2 句柄保存失败(error):rev 不采纳,失败可见', async () => {
    state.openMode = 'handle'
    saveToHandleMock.mockResolvedValueOnce({ outcome: 'error', detail: '磁盘错误' })
    await save()
    expect(state.node?.rev).toBeUndefined()
    expect(state.toast).toContain('保存失败')
  })

  test('H3 外部修改冲突:rev 不采纳,freshRaw 呈现', async () => {
    state.openMode = 'handle'
    saveToHandleMock.mockResolvedValueOnce({
      outcome: 'conflict',
      freshRaw: '<html>fresh</html>',
    })
    await save()
    expect(state.node?.rev).toBeUndefined()
    expect(state.conflictFreshRaw).toBe('<html>fresh</html>')
  })

  test('H4 写回失败降级下载副本:副本已落盘,rev 采纳', async () => {
    state.openMode = 'handle'
    saveToHandleMock.mockResolvedValueOnce({ outcome: 'downgraded', detail: '拒绝' })
    await save()
    expect(downloadTripCopyMock).toHaveBeenCalledTimes(1)
    expect(state.node?.rev).toBe(1)
    expect(state.toast).toContain('未能写回原文件')
  })
})
