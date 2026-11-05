import { contentEquals, nowIso, type DraftEntry, type TripData, type TripNode } from '../schema'

/**
 * 草稿层:localStorage,键 = `tripscope:draft:<project.id>`。
 * 所有访问包 try/catch:隐私模式/配额满/存储被禁用时降级为"无草稿",
 * 写失败必须向上报告,由 UI 提示用户改用文件保存或 JSON 导出。
 */

const PREFIX = 'tripscope:draft:'
const TEST_KEY = 'tripscope:probe'

function storage(): Storage | null {
  try {
    const s = window.localStorage
    s.setItem(TEST_KEY, '1')
    s.removeItem(TEST_KEY)
    return s
  } catch {
    return null
  }
}

export type SaveDraftResult = { ok: true } | { ok: false; error: string }

export function saveDraft(node: TripNode, baseUpdatedAt: string | null): SaveDraftResult {
  const s = storage()
  if (!s) return { ok: false, error: '浏览器存储不可用' }
  try {
    const entry: DraftEntry = { node, savedAt: nowIso(), baseUpdatedAt }
    s.setItem(PREFIX + node.project.id, JSON.stringify(entry))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function loadDraft(id: string): DraftEntry | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(PREFIX + id)
    if (!raw) return null
    const e = JSON.parse(raw) as DraftEntry
    if (!e || !e.node || !e.node.project) return null
    return e
  } catch {
    return null
  }
}

export function deleteDraft(id: string): void {
  try {
    storage()?.removeItem(PREFIX + id)
  } catch {
    /* 存储不可用时忽略 */
  }
}

/**
 * 打开旅行文件时的草稿裁决:
 * - 草稿数据内容与文件一致 → 视为冗余,静默清除(不误报)
 * - 内容不一致 → 返回草稿交由用户决策(恢复/丢弃),绝不静默覆盖
 * 判定以"数据内容"为准,savedAt/baseUpdatedAt 仅作展示。
 */
export function resolveDraftOnOpen(
  id: string,
  fileData: TripData,
): { entry: DraftEntry | null } {
  const d = loadDraft(id)
  if (!d) return { entry: null }
  if (contentEquals(d.node.data, fileData)) {
    deleteDraft(id)
    return { entry: null }
  }
  // basedOnCurrent 由调用方结合 fileUpdatedAt 计算
  return { entry: d }
}

/** 安全模式(损坏数据)下列出所有候选草稿,不依赖 project.id */
export function listDrafts(): Array<{
  id: string
  name: string
  savedAt: string
  schemaVersion: number
}> {
  const s = storage()
  if (!s) return []
  const out: Array<{ id: string; name: string; savedAt: string; schemaVersion: number }> = []
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      try {
        const e = JSON.parse(s.getItem(k) || '') as DraftEntry | null
        if (e && e.node && e.node.project) {
          out.push({
            id: e.node.project.id,
            name: e.node.project.name,
            savedAt: typeof e.savedAt === 'string' ? e.savedAt : '',
            schemaVersion: typeof e.node.schemaVersion === 'number' ? e.node.schemaVersion : 0,
          })
        }
      } catch {
        /* 单条损坏草稿跳过,不影响其余 */
      }
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
}

/* ---------------- 主题持久化(非旅行数据) ---------------- */

export function loadTheme(): 'light' | 'dark' | null {
  try {
    const v = storage()?.getItem('tripscope:theme')
    return v === 'dark' || v === 'light' ? v : null
  } catch {
    return null
  }
}

export function saveTheme(t: 'light' | 'dark'): void {
  try {
    storage()?.setItem('tripscope:theme', t)
  } catch {
    /* ignore */
  }
}
