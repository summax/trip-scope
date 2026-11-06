import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  cancelUpgradeWrite,
  confirmUpgradeWrite,
  doExportJson,
  save,
  saveAsCopy,
  state,
} from '../../src/core/store'
import { saveToHandle, saveAsViaPicker, downloadTripCopy } from '../../src/core/persistence/archive'
import { exportJson } from '../../src/core/persistence/transfer'
import { blankNode, type TripNode } from '../../src/core/schema'

vi.mock('../../src/core/persistence/archive', () => ({
  adoptHandle: vi.fn(),
  clearSessionFile: vi.fn(),
  downloadTripCopy: vi.fn(() => ({ ok: true, fileName: 'x.html' })),
  getSessionHandle: vi.fn(() => null),
  openTripViaPicker: vi.fn(),
  saveAsViaPicker: vi.fn(async () => ({ ok: true, fileName: 'x.html' })),
  saveToHandle: vi.fn(async () => ({ outcome: 'saved' })),
  sessionFileName: vi.fn(() => null),
  snapshotStatus: vi.fn(() => ({ ok: true, issues: [] })),
  pickerSupported: vi.fn(() => true),
}))
vi.mock('../../src/core/persistence/transfer', () => ({
  exportJson: vi.fn(() => ({ ok: true, fileName: 'x.json' })),
  importFromFile: vi.fn(async () => ({ ok: false, reason: 'unused' })),
}))

const saveToHandleMock = vi.mocked(saveToHandle)
const saveAsViaPickerMock = vi.mocked(saveAsViaPicker)
const downloadTripCopyMock = vi.mocked(downloadTripCopy)
const exportJsonMock = vi.mocked(exportJson)

function tripNode(): TripNode {
  const n = blankNode()
  n.project = { id: 'up-1', name: '升级旅行' }
  return n
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as any).__tsStorage.clear()
  state.screen = 'trip'
  state.readonly = false
  state.node = tripNode()
  state.openMode = 'handle'
  state.upgradeFromVersion = 1
  state.upgradeConfirmOpen = false
  state.storageError = null
})

describe('升级确认三分支', () => {
  test('A:升级门槛未确认时 save() → 弹层,不产生写盘', async () => {
    await save()
    expect(state.upgradeConfirmOpen).toBe(true)
    expect(saveToHandleMock).not.toHaveBeenCalled()
  })

  test('C:取消 → 关闭弹层不写盘;下次 save() 仍再询问', async () => {
    await save()
    expect(state.upgradeConfirmOpen).toBe(true)
    cancelUpgradeWrite()
    expect(state.upgradeConfirmOpen).toBe(false)
    expect(saveToHandleMock).not.toHaveBeenCalled()
    await save()
    expect(state.upgradeConfirmOpen).toBe(true)
  })

  test('D:另存副本不受升级门槛约束(新文件非原地写回)', async () => {
    await saveAsCopy()
    expect(state.upgradeConfirmOpen).toBe(false)
    expect(saveAsViaPickerMock).toHaveBeenCalledTimes(1)
    expect(saveToHandleMock).not.toHaveBeenCalled()
  })

  test('E:导出 JSON 不受升级门槛约束,也不 bump rev', () => {
    doExportJson()
    expect(exportJsonMock).toHaveBeenCalledTimes(1)
    expect(state.upgradeConfirmOpen).toBe(false)
    expect(state.node?.rev).toBeUndefined()
  })

  test('B(最后跑):确认 → 写盘成功,清升级标记,rev 首次自增', async () => {
    await save()
    expect(state.upgradeConfirmOpen).toBe(true)
    confirmUpgradeWrite()
    await vi.waitFor(() => expect(saveToHandleMock).toHaveBeenCalledTimes(1))
    expect(state.upgradeFromVersion).toBeNull()
    expect(state.node?.rev).toBe(1)
    expect(state.node?.appVersion).toBe(__APP_VERSION__)
  })
})
