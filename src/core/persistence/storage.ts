import { nodeContentSignature, nowIso, serializeNode, type DraftEntry, type TripNode } from '../schema'
import { admitNode } from '../admission'

/**
 * 草稿层:localStorage,键 = `tripscope:draft:<project.id>`。
 * 所有访问包 try/catch:隐私模式/配额满/存储被禁用时降级为"无草稿",
 * 写失败必须向上报告,由 UI 提示用户改用文件保存或 JSON 导出。
 */

const PREFIX = 'tripscope:draft:'
const TEST_KEY = 'tripscope:probe'

let probeCache: Storage | null | undefined

function storage(): Storage | null {
  if (probeCache !== undefined) return probeCache
  try {
    const s = window.localStorage
    s.setItem(TEST_KEY, '1')
    s.removeItem(TEST_KEY)
    probeCache = s
    return s
  } catch {
    probeCache = null
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
 * - 对草稿也跑准入(迁移),两侧都在当前版本上再比内容签名 —— 否则旧版本草稿
 *   对迁移后文件必弹假横幅,丢弃即真删内容
 * - 签名一致(项目名+数据,时间戳不参与)→ 冗余,静默清除
 * - 不一致(包括仅改名)→ 交由用户决策(恢复/丢弃),绝不静默覆盖
 * - 草稿过不了准入(损坏/外来格式)→ 视同不存在:不弹横幅、不删,草稿箱仍可见
 * 调用契约:fileNode 已经过 admitNode(处于当前支持版本)。
 */
export function resolveDraftOnOpen(
  id: string,
  fileNode: TripNode,
): { entry: DraftEntry | null } {
  const d = loadDraft(id)
  if (!d) return { entry: null }
  const adm = admitNode(serializeNode(d.node))
  if (!adm.ok) return { entry: null }
  if (nodeContentSignature(adm.node) === nodeContentSignature(fileNode)) {
    deleteDraft(id)
    return { entry: null }
  }
  // basedOnCurrent 由调用方结合 fileUpdatedAt 计算
  return { entry: d }
}

/** 读取全部草稿条目(按保存时间倒序) */
function readAllEntries(): DraftEntry[] {
  const s = storage()
  if (!s) return []
  const out: DraftEntry[] = []
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      try {
        const raw = s.getItem(k)
        if (!raw) continue
        const e = JSON.parse(raw) as DraftEntry
        if (e && e.node && e.node.project) out.push(e)
      } catch {
        /* 单条损坏草稿跳过,不影响其余 */
      }
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
}

export interface DraftListItem {
  id: string
  name: string
  savedAt: string
  schemaVersion: number
  baseUpdatedAt: string | null
}

/** 安全模式(损坏数据)下列出所有候选草稿,不依赖 project.id */
export function listDrafts(): DraftListItem[] {
  return readAllEntries().map((e) => ({
    id: e.node.project.id,
    name: e.node.project.name,
    savedAt: typeof e.savedAt === 'string' ? e.savedAt : '',
    schemaVersion: typeof e.node.schemaVersion === 'number' ? e.node.schemaVersion : 0,
    baseUpdatedAt: e.baseUpdatedAt ?? null,
  }))
}

/**
 * 从未落盘的旅行草稿(创建于空白工具、未保存过文件,baseUpdatedAt === null)。
 * 空白工具重新打开时恢复最近一份,防止刷新/关闭导致未保存内容成为孤儿键。
 */
export function listUnsavedDrafts(): DraftEntry[] {
  return readAllEntries().filter((e) => e.baseUpdatedAt === null)
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
