/**
 * TripScope 数据契约与节点操作。
 *
 * 每个旅行/工具 HTML 内嵌一个数据节点:
 *   <script id="app-data" type="application/json">{ ... }</script>
 *
 * 序列化时把 `<` 转义为 \u003c,防止数据中的 `</script>`、HTML 注释
 * 提前闭合脚本标签破坏宿主 HTML;读取走 JSON.parse,自动还原。
 */

/** 当前应用支持的数据 schema 版本 */
export const SUPPORTED_SCHEMA_VERSION = 1

/** 空白工具(尚未保存为旅行文件)的占位 id */
export const BLANK_TOOL_ID = '__blank__'

/** 数据格式标识 */
export const FORMAT = 'tripscope'

export interface ProjectMeta {
  id: string
  name: string
}

export interface DemoItem {
  id: string
  label: string
  qty: number
}

export interface TripData {
  demo?: {
    note?: string
    countA?: number
    countB?: number
    items?: DemoItem[]
  }
}

export interface TripNode {
  format: string
  schemaVersion: number
  project: ProjectMeta
  updatedAt: string
  appVersion: string
  data: TripData
}

/**
 * 草稿条目:
 * - node:工作副本快照
 * - savedAt:草稿写入时间(存储维度)
 * - baseUpdatedAt:草稿生成时所基于的文件版本(内容维度)
 */
export interface DraftEntry {
  node: TripNode
  savedAt: string
  baseUpdatedAt: string | null
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * 序列化数据节点 JSON:带缩进便于人工审阅,并把所有 `<` 转义为 \u003c,
 * 防止 `</script>`、`<!--` 等序列提前闭合脚本标签。
 */
export function serializeNode(node: TripNode): string {
  return JSON.stringify(node, null, 2).replace(/</g, '\\u003c')
}

export type NodeParseResult =
  | { ok: true; node: TripNode }
  | { ok: false; reason: 'corrupted'; detail?: string }

/** 解析数据节点 JSON 文本,做最小结构校验(schemaVersion 整数、project.id 字符串) */
export function parseNodeJson(jsonText: string): NodeParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch (e) {
    return { ok: false, reason: 'corrupted', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: 'corrupted', detail: '数据不是 JSON 对象' }
  }
  const n = raw as Record<string, unknown>
  const sv = n.schemaVersion
  if (typeof sv !== 'number' || !Number.isInteger(sv) || sv < 1) {
    return { ok: false, reason: 'corrupted', detail: 'schemaVersion 缺失或非法' }
  }
  const proj = n.project as Record<string, unknown> | undefined
  if (!proj || typeof proj.id !== 'string' || proj.id.length === 0) {
    return { ok: false, reason: 'corrupted', detail: 'project.id 缺失或非法' }
  }
  const node: TripNode = {
    format: typeof n.format === 'string' ? n.format : '',
    schemaVersion: sv,
    project: { id: proj.id, name: typeof proj.name === 'string' ? proj.name : '未命名旅行' },
    updatedAt: typeof n.updatedAt === 'string' ? n.updatedAt : nowIso(),
    appVersion: typeof n.appVersion === 'string' ? n.appVersion : '',
    data: (n.data && typeof n.data === 'object' ? n.data : {}) as TripData,
  }
  return { ok: true, node }
}

/* ------------------------------------------------------------------ */
/* 数据节点定位与替换:严格边界,命中数必须为 1                          */
/* ------------------------------------------------------------------ */

// `[/]` 字符类写法:模式源码文本不再匹配自身,免受压缩器改写影响
// `[/]` 字符类写法:模式源码文本不再匹配自身,免受压缩器改写影响;分组 1=开标签,2=数据
const NODE_RE = /(<script id="app-data" type="application[/]json">)([\s\S]*?)<\/script>/g
// 属性顺序宽容版(仍要求开标签内含 application/json),命中数同样必须为 1
const NODE_RE_LOOSE = /(<script\b[^>]*\bid=["']app-data["'][^>]*>)([\s\S]*?)<\/script>/gi

export type ExtractResult =
  | { ok: true; json: string; openTag: string; start: number; end: number }
  | { ok: false; reason: 'missing' | 'multiple' }

export function findDataNode(html: string): ExtractResult {
  const strict = [...html.matchAll(NODE_RE)]
  if (strict.length === 1) {
    const m = strict[0]
    return { ok: true, json: m[2], openTag: m[1], start: m.index!, end: m.index! + m[0].length }
  }
  if (strict.length > 1) return { ok: false, reason: 'multiple' }
  const loose = [...html.matchAll(NODE_RE_LOOSE)].filter((m) =>
    /application\/json/i.test(m[1]),
  )
  if (loose.length === 1) {
    const m = loose[0]
    return { ok: true, json: m[2], openTag: m[1], start: m.index!, end: m.index! + m[0].length }
  }
  if (loose.length > 1) return { ok: false, reason: 'multiple' }
  return { ok: false, reason: 'missing' }
}

export function extractDataNode(
  html: string,
): { ok: true; json: string } | { ok: false; reason: 'missing' | 'multiple' } {
  const r = findDataNode(html)
  return r.ok ? { ok: true, json: r.json } : r
}

/**
 * 替换 HTML 中的数据节点内容。严格边界:开标签 + 数据 + `</script>` 整体唯一命中,
 * 0 或 >1 一律拒绝写入;开标签原文保留,只替换内容。
 */
export function replaceDataNode(
  html: string,
  node: TripNode,
): { ok: true; html: string } | { ok: false; reason: 'missing' | 'multiple' } {
  const found = findDataNode(html)
  if (!found.ok) return found
  // 开标签使用匹配到的原文,不做 indexOf 推断(避免属性值含 `>` 的脆弱点)
  const next = found.openTag + serializeNode(node) + '</script>'
  return { ok: true, html: html.slice(0, found.start) + next + html.slice(found.end) }
}

/* ------------------------------------------------------------------ */
/* 快照自校验:唯一数据节点 / 主应用脚本标记 / 资源内联                  */
/* outerHTML 是 DOM 序列化快照,不是磁盘原始文件,不宣称字节级精确        */
/* ------------------------------------------------------------------ */

export interface SnapshotValidation {
  ok: boolean
  issues: string[]
}

export function validateSnapshotHtml(html: string, appMarker: string): SnapshotValidation {
  const issues: string[] = []
  const found = findDataNode(html)
  if (!found.ok) issues.push(found.reason === 'multiple' ? '数据节点不唯一' : '未找到数据节点')
  if (!html.includes(appMarker)) issues.push('缺少主应用脚本标记')

  // 只扫描脚本/样式以外的标记区:校验代码自身的正则源码位于 script 块内,
  // 剔除后"自匹配"在结构上不可能(且不受压缩器常量折叠影响)
  const markupOnly = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')

  if (/<script\b[^>]*\bsrc\s*=/i.test(markupOnly)) issues.push('存在外链脚本')
  const badLinks = [...markupOnly.matchAll(/<link\b[^>]*>/gi)].filter(
    (m) => !/href\s*=\s*["']?data:/i.test(m[0]),
  )
  if (badLinks.length > 0) issues.push(`存在 ${badLinks.length} 个非内联 link 资源`)
  if (!html.includes('<style')) issues.push('缺少内联样式')
  return { ok: issues.length === 0, issues }
}

export function blankNode(): TripNode {
  return {
    format: FORMAT,
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    project: { id: BLANK_TOOL_ID, name: '未命名旅行' },
    updatedAt: nowIso(),
    appVersion: __APP_VERSION__,
    data: {},
  }
}

/** 键序无关的规范化 JSON(草稿/文件内容比对、防键序漂移) */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']'
  const obj = v as Record<string, unknown>
  return (
    '{' +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k]))
      .join(',') +
    '}'
  )
}

export function contentEquals(a: TripData, b: TripData): boolean {
  return canonicalJson(a) === canonicalJson(b)
}

/** 节点内容签名:项目名 + 数据(时间戳不参与,改名/改数据都能检出分歧) */
export function nodeContentSignature(n: Pick<TripNode, 'project' | 'data'>): string {
  return canonicalJson({ name: n.project.name, data: n.data })
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

export function sanitizeFileName(name: string): string {
  // 尾随点/空格在 Windows 文件系统上会产生非法或危险文件名(如 "..")
  const clean = name.replace(/[\\/:*?"<>|]/g, '_').trim()
  const trimmed = clean.slice(0, 60).replace(/[. ]+$/, '')
  const base = trimmed.length > 0 ? trimmed : 'trip'
  return WINDOWS_RESERVED.test(base) ? '_' + base : base
}

export function deepClone<T>(v: T): T {
  // JSON 往返克隆:数据契约是纯 JSON;structuredClone 无法克隆 Vue reactive 代理(会抛 DataCloneError)
  return JSON.parse(JSON.stringify(v))
}
