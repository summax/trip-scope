import { extractDataNode } from './schema'
import * as archive from './persistence/archive'
import * as store from './store'

/**
 * 启动序列:快照捕获(解析完成、挂载之前)→ 主题 → 运行时标记 →
 * 解析数据节点 → 准入 → 打开上下文。
 */
export function run(): void {
  archive.captureSnapshot()
  store.initTheme()
  store.initRuntimeFlags()
  // 读取持久化句柄槽位,填充「重新连接」邀请(异步,不阻塞打开链路)
  void store.initReconnectOffer()

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
  // 空白工具:数据节点为 null → 恢复最近一份未落盘草稿(如有),否则全新空白
  if (raw === '' || raw === 'null' || raw === 'undefined') {
    store.openBlankTool()
    return
  }

  store.openFromJson(raw, 'embedded')
}
