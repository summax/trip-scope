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

/* ---------------- P1-01:异步边界世代校验(Deferred,零延时) ---------------- */

interface Deferred<T> {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeHandle(html: string, opts?: { permGate?: Deferred<boolean>; readGate?: Deferred<string>; writeGate?: Deferred<void> }) {
  return {
    name: 'old.html',
    queryPermission: async () => {
      if (opts?.permGate) return await opts.permGate.promise
      return 'granted' as const
    },
    getFile: async () => ({
      text: async () => {
        if (opts?.readGate) return await opts.readGate.promise
        return html
      },
    }),
    createWritable: async () => ({
      write: async () => undefined,
      close: async () => {
        if (opts?.writeGate) await opts.writeGate.promise
      },
    }),
  }
}

function rebindToNew(archive: typeof import('../../src/core/persistence/archive')): void {
  // 模拟用户中途打开另一文件:换绑 + 世代自增,originalRaw/snapshot 全部变新
  archive.adoptHandle(OLD_HTML.replace('old-1', 'new-1'), makeHandle(OLD_HTML.replace('old-1', 'new-1'), { name: undefined }))
}

test('P1-01a 权限确认等待中切换到 B:旧任务中止,不降级不写盘', async () => {
  const archive = await import('../../src/core/persistence/archive')
  archive.clearSessionFile()
  const permGate = deferred<boolean>()
  const handle = makeHandle(OLD_HTML, { permGate })
  archive.adoptHandle(OLD_HTML, handle)
  const p = archive.saveToHandle(makeNode() as never)
  rebindToNew(archive) // 等权限期间换绑
  permGate.resolve(true)
  const r = await p
  expect(r.outcome).toBe('error')
  if (r.outcome === 'error') expect(r.detail).toContain('会话已切换')
})

test('P1-01b 文件读取等待中切换到 B:旧任务中止,conflict 判定不用 B 的 originalRaw', async () => {
  const archive = await import('../../src/core/persistence/archive')
  archive.clearSessionFile()
  const readGate = deferred<string>()
  const handle = makeHandle(OLD_HTML, { readGate })
  archive.adoptHandle(OLD_HTML, handle)
  const p = archive.saveToHandle(makeNode() as never)
  rebindToNew(archive) // 等读取期间换绑:B 的 originalRaw 已变
  readGate.resolve(OLD_HTML) // A 的磁盘原文与 A 的捕获基准一致(但世代已变)
  const r = await p
  // 若实现错误地用 B 的 originalRaw 判 A,这里会误报 conflict 而非世代中止;
  // 若实现漏了读取后校验,会继续走写盘 —— 两者都应被本断言拦下
  expect(r.outcome).toBe('error')
  if (r.outcome === 'error') expect(r.detail).toContain('会话已切换')
})

test('P1-01c 写入前切换到 B:不实际写盘', async () => {
  const archive = await import('../../src/core/persistence/archive')
  archive.clearSessionFile()
  let writeCount = 0
  const handle = {
    name: 'old.html',
    queryPermission: async () => 'granted' as const,
    getFile: async () => ({ text: async () => OLD_HTML }),
    createWritable: async () => ({
      write: async () => {
        writeCount++
      },
      close: async () => undefined,
    }),
  }
  archive.adoptHandle(OLD_HTML, handle)
  // 使 replaceDataNode 与写入之间有一个可控 await:把外部修改检测挂起
  const readGate = deferred<string>()
  const gatedHandle = {
    ...handle,
    getFile: async () => ({ text: async () => await readGate.promise }),
  }
  archive.clearSessionFile()
  archive.adoptHandle(OLD_HTML, gatedHandle)
  const p = archive.saveToHandle(makeNode() as never)
  rebindToNew(archive) // 读取挂起期间换绑
  readGate.resolve(OLD_HTML)
  const r = await p
  expect(r.outcome).toBe('error')
  expect(writeCount).toBe(0) // 写入前已中止:A 的内容不落盘
})

test('P1-01d 保存完成后:B 的 originalRaw 不被旧任务覆盖', async () => {
  const archive = await import('../../src/core/persistence/archive')
  archive.clearSessionFile()
  const writeGate = deferred<void>()
  const handle = makeHandle(OLD_HTML, { writeGate })
  archive.adoptHandle(OLD_HTML, handle)
  const p = archive.saveToHandle(makeNode() as never)
  // close 挂起期间换绑:B 的 originalRaw = 新文件内容
  const newRaw = OLD_HTML.replace('old-1', 'new-1')
  archive.adoptHandle(newRaw, makeHandle(newRaw))
  writeGate.resolve()
  const r = await p
  expect(r.outcome).toBe('error') // 写盘结果废弃
  // 验证 B 的会话基准未被旧任务改写:再次对 B 保存,外部修改检测应正常基于 B 的原文
  const r2 = await archive.saveToHandle(makeNode() as never)
  // B 的句柄磁盘原文 = newRaw = B 的 originalRaw → 无冲突,写盘成功记入 B
  expect(r2.outcome).toBe('saved')
})

test('P1-01e A 的文件不会被写入 B 的快照内容(升级写回场景)', async () => {
  const archive = await import('../../src/core/persistence/archive')
  archive.clearSessionFile()
  const readGate = deferred<string>()
  let writtenHtml = ''
  const handle = {
    name: 'old.html',
    queryPermission: async () => 'granted' as const,
    getFile: async () => ({ text: async () => await readGate.promise }),
    createWritable: async () => ({
      write: async (content: string) => {
        writtenHtml = content
      },
      close: async () => undefined,
    }),
  }
  archive.adoptHandle(OLD_HTML, handle)
  // B 的快照带独特标记(伪造 B 的应用代码)
  const bSnapshot = OLD_HTML.replace('old-1', 'b-snapshot-marker')
  // 直接注入 B 的快照到全局(模拟 B 已捕获快照的世界),A 捕获的是旧快照
  ;(archive as unknown as { __testInjectSnapshot?: (s: string) => void }).__testInjectSnapshot?.(bSnapshot)
  const p = archive.saveToHandle(makeNode() as never, { fullAppUpgrade: true })
  rebindToNew(archive)
  readGate.resolve(OLD_HTML)
  await p
  // 无论结果如何:绝不能把 B 的快照写进 A 的文件句柄
  expect(writtenHtml).not.toContain('b-snapshot-marker')
})
