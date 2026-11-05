import {
  replaceDataNode,
  sanitizeFileName,
  validateSnapshotHtml,
  type TripNode,
} from '../schema'

/**
 * 文件保存链(与 schema.ts 的边界规则配合):
 *
 * - 句柄模式:仅当文件经 showOpenFilePicker 打开时成立,保存 = 重读磁盘原文
 *   (尽力检测外部修改)→ 精确替换数据节点 → 写回;失败/权限拒绝 → 降级下载副本
 * - 双击模式:保存默认 = 下载副本;outerHTML 快照仅用于生成副本,不宣称字节精确,
 *   使用前需通过快照自校验
 *
 * handle 与 originalRaw 存放在普通对象(非 Vue reactive),
 * 避免平台对象被 Proxy 包裹后方法调用异常。
 */

export const APP_MARKER = '/*! tripscope-app */'

const DOCTYPE = '<!DOCTYPE html>\n'

interface Session {
  handle: unknown | null
  originalRaw: string | null
  snapshot: string | null
  snapshotOk: boolean
  snapshotIssues: string[]
}

const session: Session = {
  handle: null,
  originalRaw: null,
  snapshot: null,
  snapshotOk: false,
  snapshotIssues: [],
}

export function captureSnapshot(): void {
  // 模块脚本在文档解析完成后执行:此时 DOM 完整、Vue 未挂载,快照即"解析完成、挂载之前"
  const snap = DOCTYPE + document.documentElement.outerHTML
  session.snapshot = snap
  const v = validateSnapshotHtml(snap, APP_MARKER)
  session.snapshotOk = v.ok
  session.snapshotIssues = v.issues
}

export function snapshotStatus(): { ok: boolean; issues: string[] } {
  return { ok: session.snapshotOk, issues: session.snapshotIssues }
}

export function pickerSupported(): boolean {
  return typeof (window as any).showOpenFilePicker === 'function'
}

export type OpenHandleResult =
  | { ok: true; html: string; handle: unknown }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'error'; detail?: string }

/** 应用内文件选择器打开旅行文件(读取数据 + 保留句柄,不执行所选 HTML) */
export async function openTripViaPicker(): Promise<OpenHandleResult> {
  if (!pickerSupported()) return { ok: false, reason: 'unsupported' }
  try {
    const [handle] = await (window as any).showOpenFilePicker({
      types: [{ description: 'TripScope 旅行文件', accept: { 'text/html': ['.html', '.htm'] } }],
    })
    const file = await handle.getFile()
    const text = await file.text()
    return { ok: true, html: text, handle }
  } catch (e: any) {
    if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' }
    return { ok: false, reason: 'error', detail: e?.message ?? String(e) }
  }
}

export type SaveOutcome =
  | { outcome: 'saved'; html: string }
  | { outcome: 'conflict'; freshRaw: string }
  | { outcome: 'downgraded'; detail?: string }
  | { outcome: 'error'; detail: string }

async function ensureWritePermission(handle: any): Promise<boolean> {
  try {
    if (typeof handle.queryPermission !== 'function') return false
    const st = await handle.queryPermission({ mode: 'readwrite' })
    if (st === 'granted') return true
    if (typeof handle.requestPermission !== 'function') return false
    const r = await handle.requestPermission({ mode: 'readwrite' })
    return r === 'granted'
  } catch {
    return false
  }
}

/** 句柄模式保存:尽力检测外部修改 → 精确替换数据节点 → 写回原文件 */
export async function saveToHandle(node: TripNode): Promise<SaveOutcome> {
  const handle = session.handle as any
  if (!handle) return { outcome: 'error', detail: '无文件句柄' }

  if (!(await ensureWritePermission(handle))) {
    return { outcome: 'downgraded', detail: '未获得文件写权限' }
  }

  let freshRaw: string
  try {
    const f = await handle.getFile()
    freshRaw = await f.text()
  } catch {
    return { outcome: 'downgraded', detail: '无法读取文件当前内容' }
  }

  // 外部修改检测为尽力检测:重读磁盘内容与会话开始时的原文比对
  if (freshRaw !== session.originalRaw) {
    return { outcome: 'conflict', freshRaw }
  }

  const r = replaceDataNode(freshRaw, node)
  if (!r.ok) {
    return {
      outcome: 'downgraded',
      detail:
        r.reason === 'multiple'
          ? '原文件数据节点不唯一,拒绝写入'
          : '原文件缺少数据节点,拒绝写入',
    }
  }

  try {
    const w = await handle.createWritable()
    await w.write(r.html)
    await w.close()
  } catch (e) {
    return {
      outcome: 'downgraded',
      detail: '写入失败:' + (e instanceof Error ? e.message : String(e)),
    }
  }

  session.originalRaw = r.html
  return { outcome: 'saved', html: r.html }
}

export function adoptHandle(html: string, handle: unknown): void {
  session.handle = handle
  session.originalRaw = html
}

export function adoptRaw(html: string): void {
  session.originalRaw = html
  session.handle = null
}

export function clearSessionFile(): void {
  session.handle = null
  session.originalRaw = null
}

/** 冲突重载时复用仍有效的句柄 */
export function getSessionHandle(): unknown | null {
  return session.handle
}

/** 副本内容来源优先级:句柄磁盘原文 → 校验通过的快照;两者皆不可用则失败 */
function buildCopyHtml(node: TripNode): { ok: true; html: string } | { ok: false; reason: string } {
  if (session.originalRaw) {
    const r = replaceDataNode(session.originalRaw, node)
    if (r.ok) return { ok: true, html: r.html }
  }
  if (session.snapshotOk && session.snapshot) {
    const r = replaceDataNode(session.snapshot, node)
    if (r.ok) return { ok: true, html: r.html }
    return { ok: false, reason: '快照替换失败:' + r.reason }
  }
  return { ok: false, reason: session.snapshotIssues.join(';') || '无可用的文件源(快照校验失败)' }
}

export function triggerDownload(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function downloadTripCopy(
  node: TripNode,
): { ok: true; fileName: string } | { ok: false; reason: string } {
  const r = buildCopyHtml(node)
  if (!r.ok) return r
  const fileName = sanitizeFileName(node.project.name) + '.html'
  triggerDownload(r.html, fileName, 'text/html;charset=utf-8')
  return { ok: true, fileName }
}

export type SaveAsResult =
  | { ok: true; fileName: string }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'error'; detail?: string }

/** 另存为副本:showSaveFilePicker 落盘(仍属副本,不写回原文件) */
export async function saveAsViaPicker(node: TripNode): Promise<SaveAsResult> {
  if (!pickerSupported()) return { ok: false, reason: 'unsupported' }
  const r = buildCopyHtml(node)
  if (!r.ok) return { ok: false, reason: 'error', detail: r.reason }
  try {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: sanitizeFileName(node.project.name) + '.html',
      types: [{ description: 'TripScope 旅行文件', accept: { 'text/html': ['.html'] } }],
    })
    const w = await handle.createWritable()
    await w.write(r.html)
    await w.close()
    return { ok: true, fileName: String(handle.name ?? '') }
  } catch (e: any) {
    if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' }
    return { ok: false, reason: 'error', detail: e?.message ?? String(e) }
  }
}
