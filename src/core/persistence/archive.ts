import {
  replaceDataNode,
  sanitizeFileName,
  validateSnapshotHtml,
  type TripNode,
} from '../schema'
import { saveLastHandle } from './handleStore'

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

/**
 * 文件会话世代号:adoptHandle / clearSessionFile 每次变更绑定关系时自增。
 * 异步写回在发起时记下世代,写盘完成时若世代已变(用户中途打开了别的文件),
 * 本次结果作废——不得把写盘内容记到新文件的会话账上,session.originalRaw
 * 也不得被旧保存任务覆盖(隔离不只在 store 层,archive 层自守)。
 */
let sessionGeneration = 0

/** 发起写回前取当前世代 */
export function currentSessionGeneration(): number {
  return sessionGeneration
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

/** 写回底稿裁决结果 */
export type WriteBase =
  | { ok: true; base: string; kind: 'data-only' | 'full-app' }
  | { ok: false; reason: string }

/**
 * 写回底稿裁决:
 * - 普通数据写回:以磁盘原文为底,仅替换数据节点(保留原文其余部分,by design)
 * - 应用升级写回:迁移后的旧文件不允许「新数据 + 旧应用代码」组合落盘,
 *   必须以当前应用完整快照为底整体替换;快照不可用时明确拒绝,不做降级伪装
 */
export function resolveWriteBase(
  freshRaw: string,
  fullAppUpgrade: boolean,
  snapshot: string | null,
  snapshotOk: boolean,
  snapshotIssues: string[],
): WriteBase {
  if (!fullAppUpgrade) return { ok: true, base: freshRaw, kind: 'data-only' }
  if (!snapshotOk || !snapshot) {
    return { ok: false, reason: snapshotIssues.join(';') || '当前应用快照校验失败' }
  }
  return { ok: true, base: snapshot, kind: 'full-app' }
}

/** 句柄模式保存:尽力检测外部修改 → 底稿裁决 → 精确替换数据节点 → 写回原文件 */
export async function saveToHandle(
  node: TripNode,
  opts?: { fullAppUpgrade?: boolean },
): Promise<SaveOutcome> {
  const handle = session.handle as any
  if (!handle) return { outcome: 'error', detail: '无文件句柄' }
  // 发起时的会话世代:写盘完成时核对,中途换绑文件则本次作废
  const gen = sessionGeneration

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

  // 外部修改检测为尽力检测:重读磁盘内容与会话开始时的原文比对(升级替换会整体覆盖,检测更必要)
  if (freshRaw !== session.originalRaw) {
    return { outcome: 'conflict', freshRaw }
  }

  // 底稿裁决:普通写回=磁盘原文;升级写回=当前应用完整快照(应用代码与数据一并升级)
  const wb = resolveWriteBase(
    freshRaw,
    opts?.fullAppUpgrade === true,
    session.snapshot,
    session.snapshotOk,
    session.snapshotIssues,
  )
  if (!wb.ok) {
    return {
      outcome: 'error',
      detail: '应用升级写回被拒绝(' + wb.reason + ');请改用「另存为副本」或「导出 JSON」',
    }
  }

  const r = replaceDataNode(wb.base, node)
  if (!r.ok) {
    return {
      outcome: 'downgraded',
      detail:
        (wb.kind === 'full-app' ? '应用快照' : '原文件') +
        (r.reason === 'multiple'
          ? '数据节点不唯一,拒绝写入'
          : '缺少数据节点,拒绝写入'),
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

  // 写盘完成时核对世代:中途用户已打开别的文件,本次写盘内容不得记入新文件会话
  if (sessionGeneration !== gen) {
    return { outcome: 'error', detail: '保存期间文件会话已切换,本次写盘结果已废弃' }
  }
  session.originalRaw = r.html
  return { outcome: 'saved', html: r.html }
}

export function adoptHandle(html: string, handle: unknown): void {
  sessionGeneration++
  session.handle = handle
  session.originalRaw = html
  persistLastHandle(handle)
}

/** 当前会话绑定的文件名(句柄模式);嵌入模式由调用方从 location 推导 */
export function sessionFileName(): string | null {
  const h = session.handle as { name?: unknown } | null
  return typeof h?.name === 'string' && h.name !== '' ? h.name : null
}

/** 尽力而为持久化最近绑定的文件句柄,供刷新后重连(见 handleStore) */
function persistLastHandle(handle: unknown): void {
  try {
    void saveLastHandle({
      handle,
      fileName: String((handle as { name?: unknown })?.name ?? ''),
    })
  } catch {
    /* 尽力而为 */
  }
}

export function clearSessionFile(): void {
  sessionGeneration++
  session.handle = null
  session.originalRaw = null
}

/** 冲突重载时复用仍有效的句柄 */
export function getSessionHandle(): unknown | null {
  return session.handle
}

/**
 * 副本内容来源优先级:
 * - 默认:句柄磁盘原文 → 校验通过的快照
 * - preferSnapshot(应用升级场景):跳过磁盘原文,直接用快照——
 *   避免「新数据 + 旧应用代码」的副本落盘
 * 两者皆不可用则失败
 */
function buildCopyHtml(node: TripNode, preferSnapshot = false): { ok: true; html: string } | { ok: false; reason: string } {
  if (!preferSnapshot && session.originalRaw) {
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
  preferSnapshot = false,
): { ok: true; fileName: string } | { ok: false; reason: string } {
  const r = buildCopyHtml(node, preferSnapshot)
  if (!r.ok) return r
  const fileName = sanitizeFileName(node.project.name) + '.html'
  triggerDownload(r.html, fileName, 'text/html;charset=utf-8')
  return { ok: true, fileName }
}

export type SaveAsResult =
  | { ok: true; fileName: string }
  | { ok: false; reason: 'unsupported' | 'cancelled' | 'error'; detail?: string }

/** 另存为副本:showSaveFilePicker 落盘(仍属副本,不写回原文件) */
export async function saveAsViaPicker(node: TripNode, preferSnapshot = false): Promise<SaveAsResult> {
  if (!pickerSupported()) return { ok: false, reason: 'unsupported' }
  const r = buildCopyHtml(node, preferSnapshot)
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
