import { extractDataNode, sanitizeFileName, serializeNode, type TripNode } from '../schema'
import { admitNode } from '../admission'
import { triggerDownload } from './archive'

/**
 * JSON 导出/导入 + 旅行 HTML 数据提取。
 * 导入走 <input type="file">,只读取数据,不执行所选文件、不产生文件句柄。
 */

export type ImportResult =
  | { ok: true; node: TripNode; mode: 'normal' | 'readonly'; reason?: string }
  | { ok: false; reason: string }

export function exportJson(node: TripNode): { ok: true; fileName: string } {
  const fileName = sanitizeFileName(node.project.name) + '.json'
  triggerDownload(serializeNode(node), fileName, 'application/json;charset=utf-8')
  return { ok: true, fileName }
}

export async function importFromFile(file: File): Promise<ImportResult> {
  let text: string
  try {
    text = await file.text()
  } catch {
    return { ok: false, reason: '无法读取文件内容' }
  }

  const looksHtml = /\.html?$/i.test(file.name) || /^\s*</.test(text)

  if (looksHtml) {
    const ex = extractDataNode(text)
    if (!ex.ok) {
      return {
        ok: false,
        reason:
          ex.reason === 'multiple'
            ? '文件包含多个数据节点,拒绝导入'
            : '未找到 TripScope 数据节点',
      }
    }
    return toResult(admitNode(ex.json))
  }

  return toResult(admitNode(text))
}

function toResult(
  a: ReturnType<typeof admitNode>,
): ImportResult {
  if (!a.ok) {
    if (a.kind === 'corrupted') {
      return { ok: false, reason: '数据损坏' + (a.detail ? ':' + a.detail : '') }
    }
    return { ok: false, reason: '不是 TripScope 旅行数据' + (a.detail ? ':' + a.detail : '') }
  }
  return { ok: true, node: a.node, mode: a.mode, reason: a.reason }
}
