/**
 * 句柄持久化:IndexedDB 单槽位,存「最近一次句柄绑定的文件」,供刷新后重连。
 * 尽力而为:IDB 不可用或句柄带方法(测试替身)时 structuredClone 抛错 → 静默跳过,
 * 不影响任何主链路——持久化失败只意味着刷新后没有重连栏。
 */
const DB_NAME = 'tripscope'
const STORE = 'handles'
const KEY = 'last'

export interface PersistedHandle {
  handle: unknown
  fileName: string
}

export function isIdbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIdbAvailable()) {
      reject(new Error('IndexedDB 不可用'))
      return
    }
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'))
  })
}

async function idbRun<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = fn(tx.objectStore(STORE))
    tx.oncomplete = () => {
      db.close()
      resolve(req.result as T)
    }
    tx.onerror = () => {
      db.close()
      reject(req.error ?? new Error('IndexedDB 操作失败'))
    }
  })
}

export async function saveLastHandle(p: PersistedHandle): Promise<void> {
  try {
    await idbRun('readwrite', (s) => s.put(p, KEY))
  } catch {
    /* 尽力而为:句柄不可克隆或 IDB 不可用 → 静默跳过 */
  }
}

export async function loadLastHandle(): Promise<PersistedHandle | null> {
  try {
    const v = await idbRun('readonly', (s) => s.get(KEY))
    return (v as PersistedHandle) ?? null
  } catch {
    return null
  }
}

export async function clearLastHandle(): Promise<void> {
  try {
    await idbRun('readwrite', (s) => s.delete(KEY))
  } catch {
    /* ignore */
  }
}
