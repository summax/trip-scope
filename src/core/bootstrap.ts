import { blankNode, extractDataNode, BLANK_TOOL_ID } from './schema'
import { admitNode } from './admission'
import * as archive from './persistence/archive'
import * as store from './store'
import { loadDraft } from './persistence/storage'

/**
 * 启动序列:快照捕获(解析完成、挂载之前)→ 主题 → 运行时标记 →
 * 解析数据节点 → 准入(格式/版本/迁移)→ 打开上下文。
 */
export function run(): void {
  archive.captureSnapshot()
  store.initTheme()
  store.initRuntimeFlags()

  const ex = extractDataNode(document.documentElement.outerHTML)
  if (!ex.ok) {
    store.openSafe(
      '应用文件结构异常(' +
        (ex.reason === 'multiple' ? '数据节点不唯一' : '未找到数据节点') +
        ');可尝试恢复本地草稿',
    )
    return
  }

  const raw = ex.json.trim()
  // 空白工具:数据节点为 null,静默恢复空白工具草稿(如有),否则开新空白
  if (raw === '' || raw === 'null' || raw === 'undefined') {
    const d = loadDraft(BLANK_TOOL_ID)
    archive.clearSessionFile()
    store.openTrip(d ? d.node : blankNode(), {
      openMode: 'embedded',
      fileUpdatedAt: null,
      skipDraftCheck: true,
    })
    return
  }

  const adm = admitNode(ex.json)
  if (!adm.ok) {
    if (adm.kind === 'corrupted') {
      store.openSafe('内嵌旅行数据损坏(' + (adm.detail ?? '结构不符') + ');原文件未被修改,可尝试恢复本地草稿')
    } else {
      store.setForeign('内嵌数据 format="' + (adm.detail ?? '') + '",不是 TripScope 旅行文件')
    }
    return
  }
  store.openTrip(adm.node, {
    openMode: 'embedded',
    fileUpdatedAt: adm.node.updatedAt,
    readonly: adm.mode === 'readonly',
    readonlyReason: adm.reason ?? '',
  })
}
