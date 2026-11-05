import { FORMAT, SUPPORTED_SCHEMA_VERSION, parseNodeJson, type TripNode } from './schema'
import { runMigrations } from './migrate'

/**
 * 数据准入:格式校验 → 版本裁决。
 * - format 不符 → foreign(拒绝打开)
 * - schemaVersion 高于支持 → readonly(数据保留,只读查看,可导出 JSON)
 * - schemaVersion 低于支持 → 跑迁移链,成功 → normal;失败 → readonly + 原因
 */
export type Admission =
  | { ok: true; mode: 'normal' | 'readonly'; node: TripNode; reason?: string }
  | { ok: false; kind: 'corrupted' | 'foreign'; detail?: string }

export function admitNode(jsonText: string): Admission {
  const p = parseNodeJson(jsonText)
  if (!p.ok) return { ok: false, kind: 'corrupted', detail: p.detail }

  const node = p.node
  if (node.format !== FORMAT) {
    return { ok: false, kind: 'foreign', detail: `format="${node.format || '(空)'}" 不是 tripscope` }
  }
  if (node.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    return {
      ok: true,
      mode: 'readonly',
      node,
      reason: `数据版本 v${node.schemaVersion} 高于当前应用支持的 v${SUPPORTED_SCHEMA_VERSION},已进入只读模式;可导出 JSON,写入类操作已禁用`,
    }
  }
  if (node.schemaVersion < SUPPORTED_SCHEMA_VERSION) {
    const m = runMigrations(node)
    if (!m.ok) {
      return {
        ok: true,
        mode: 'readonly',
        node,
        reason: `迁移失败:${m.error};已进入只读模式`,
      }
    }
    return { ok: true, mode: 'normal', node: m.node }
  }
  return { ok: true, mode: 'normal', node }
}
