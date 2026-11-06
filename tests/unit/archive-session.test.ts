import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * archive 会话世代守卫:不 mock archive 本体,直接测真实模块。
 * 场景:写盘动作实际完成后,会话才换绑(用户打开另一文件)——
 * 此时写盘结果不得记入新会话(世代核对在 close 之后)。
 */
vi.mock('../../src/core/persistence/handleStore', () => ({
  saveLastHandle: vi.fn(async () => undefined),
  loadLastHandle: vi.fn(async () => null),
  clearLastHandle: vi.fn(async () => undefined),
}))

const OLD_HTML =
  '<!DOCTYPE html><html><head></head><body><script id="app-data" type="application/json">{"schemaVersion":2,"project":{"id":"old-1","name":"旧文件"},"updatedAt":"2026-01-01T00:00:00.000Z"}</script></body></html>'

function makeNode() {
  return {
    format: 'tripscope',
    schemaVersion: 2,
    project: { id: 'old-1', name: '旧文件' },
    updatedAt: '2026-01-02T00:00:00.000Z',
    appVersion: 't',
    data: {},
  }
}

beforeEach(() => {
  vi.resetModules()
})

test('写盘完成后会话已换绑 → 结果废弃(error),originalRaw 不被旧任务覆盖', async () => {
  const archive = await import('../../src/core/persistence/archive')
  archive.clearSessionFile()
  let writeCount = 0
  let onClosed: (() => void) | null = null
  const handle = {
    name: 'old.html',
    queryPermission: async () => 'granted',
    getFile: async () => ({ text: async () => OLD_HTML }),
    createWritable: async () => ({
      write: async () => {
        writeCount++
      },
      close: async () => {
        // 写盘落定的瞬间,用户打开了另一个文件(换绑,世代++)
        archive.adoptHandle(OLD_HTML.replace('old-1', 'new-1'), {
          ...handle,
          name: 'new.html',
        })
        onClosed?.()
      },
    }),
  }
  void onClosed
  archive.adoptHandle(OLD_HTML, handle)
  const genBefore = archive.currentSessionGeneration()

  const r = await archive.saveToHandle(makeNode() as never)
  // 写盘确实发生了,但世代已变:结果必须废弃,不得记为新会话的基准
  expect(writeCount).toBe(1)
  expect(r.outcome).toBe('error')
  if (r.outcome === 'error') expect(r.detail).toContain('会话已切换')
  expect(archive.currentSessionGeneration()).toBeGreaterThan(genBefore)
})

test('世代未变 → 正常 saved 并更新 originalRaw', async () => {
  const archive = await import('../../src/core/persistence/archive')
  archive.clearSessionFile()
  const handle = {
    name: 'old.html',
    queryPermission: async () => 'granted',
    getFile: async () => ({ text: async () => OLD_HTML }),
    createWritable: async () => ({
      write: async () => undefined,
      close: async () => undefined,
    }),
  }
  archive.adoptHandle(OLD_HTML, handle)
  const r = await archive.saveToHandle(makeNode() as never)
  expect(r.outcome).toBe('saved')
})
