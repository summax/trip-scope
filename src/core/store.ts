import { reactive } from 'vue'
import {
  BLANK_TOOL_ID,
  blankNode,
  deepClone,
  extractDataNode,
  newId,
  nowIso,
  type DemoItem,
  type DraftEntry,
  type TripData,
  type TripNode,
} from './schema'
import { admitNode } from './admission'
import {
  deleteDraft,
  loadDraft,
  listDrafts,
  resolveDraftOnOpen,
  saveDraft,
  loadTheme,
  saveTheme,
} from './persistence/storage'
import {
  adoptHandle,
  clearSessionFile,
  downloadTripCopy,
  getSessionHandle,
  openTripViaPicker,
  saveAsViaPicker,
  saveToHandle,
  snapshotStatus,
  pickerSupported,
} from './persistence/archive'
import { exportJson, importFromFile } from './persistence/transfer'

/* ------------------------------------------------------------------ */
/* 全局响应式状态                                                       */
/* ------------------------------------------------------------------ */

export type ScreenMode = 'trip' | 'foreign' | 'safe'
export type OpenMode = 'embedded' | 'handle'

export interface SafeDraftItem {
  id: string
  name: string
  savedAt: string
  schemaVersion: number
}

export interface DraftBannerState {
  entry: DraftEntry
  basedOnCurrent: boolean
}

export interface State {
  screen: ScreenMode
  readonly: boolean
  readonlyReason: string
  safeDetail: string
  foreignDetail: string
  openMode: OpenMode
  node: TripNode | null
  fileUpdatedAt: string | null
  draftBanner: DraftBannerState | null
  storageError: string | null
  toast: string | null
  conflictFreshRaw: string | null
  safeDrafts: SafeDraftItem[]
  theme: 'light' | 'dark'
  snapshotIssues: string[]
  pickerSupported: boolean
  appVersion: string
}

export const state = reactive<State>({
  screen: 'trip',
  readonly: false,
  readonlyReason: '',
  safeDetail: '',
  foreignDetail: '',
  openMode: 'embedded',
  node: null,
  fileUpdatedAt: null,
  draftBanner: null,
  storageError: null,
  toast: null,
  conflictFreshRaw: null,
  safeDrafts: [],
  theme: 'light',
  snapshotIssues: [],
  pickerSupported: false,
  appVersion: __APP_VERSION__,
})

/* toast 自动消失定时器 */
let toastTimer: ReturnType<typeof setTimeout> | null = null
let draftTimer: ReturnType<typeof setTimeout> | null = null

/* ------------------------------------------------------------------ */
/* 主题                                                                 */
/* ------------------------------------------------------------------ */

export function initTheme(): void {
  applyTheme(loadTheme() ?? 'light')
}

export function toggleTheme(): void {
  applyTheme(state.theme === 'light' ? 'dark' : 'light')
}

function applyTheme(t: 'light' | 'dark'): void {
  state.theme = t
  document.documentElement.setAttribute('data-theme', t)
  saveTheme(t)
}

/* ------------------------------------------------------------------ */
/* 打开上下文(所有进入旅行上下文的路径都走这里)                          */
/* ------------------------------------------------------------------ */

interface OpenContext {
  openMode: OpenMode
  fileUpdatedAt: string | null
  readonly?: boolean
  readonlyReason?: string
  skipDraftCheck?: boolean
}

export function openTrip(
  node: TripNode,
  opts: OpenContext,
): void {
  state.screen = 'trip'
  state.readonly = opts.readonly === true
  state.readonlyReason = opts.readonlyReason ?? ''
  state.safeDetail = ''
  state.foreignDetail = ''
  state.node = node
  state.openMode = opts.openMode
  state.fileUpdatedAt = opts.fileUpdatedAt
  state.draftBanner = null
  state.storageError = null
  state.conflictFreshRaw = null
  state.safeDrafts = []

  if (!state.readonly && !opts.skipDraftCheck) {
    const r = resolveDraftOnOpen(node.project.id, node.data)
    if (r.entry) {
      state.draftBanner = {
        entry: r.entry,
        basedOnCurrent: r.entry.baseUpdatedAt === opts.fileUpdatedAt,
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 编辑(自动草稿):任何编辑都会 bump updatedAt 并 debounce 写草稿;      */
/* 只读模式全部禁止                                                     */
/* ------------------------------------------------------------------ */

export function updateData(mutate: (data: TripData) => void): void {
  if (!canEdit()) return
  mutate(state.node!.data)
  state.node!.updatedAt = nowIso()
  scheduleDraft()
}

export function renameProject(name: string): void {
  if (!canEdit() || !state.node) return
  state.node.project.name = name.trim()
  state.node.updatedAt = nowIso()
  scheduleDraft()
}

function canEdit(): boolean {
  return state.screen === 'trip' && !state.readonly && state.node !== null
}

function scheduleDraft(): void {
  if (state.readonly || !state.node) return
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    if (!state.node) return
    const r = saveDraft(state.node, state.fileUpdatedAt)
    if (!r.ok) {
      state.storageError =
        '本地草稿保存失败(' + r.error + '),请尽快使用「保存」或「导出 JSON」'
    }
  }, 300)
}

/* ------------------------------------------------------------------ */
/* 草稿横幅:恢复 / 丢弃                                                */
/* ------------------------------------------------------------------ */

export function restoreDraft(): void {
  if (!state.draftBanner || !state.node) return
  // 横幅持有的 entry 是内存副本,即使草稿存储已被后续编辑覆盖也能完整恢复
  state.node = state.draftBanner.entry.node
  state.draftBanner = null
  setToast('已恢复草稿')
}

export function discardDraft(): void {
  if (!state.draftBanner || !state.node) return
  deleteDraft(state.draftBanner.entry.node.project.id)
  state.draftBanner = null
  setToast('已丢弃草稿')
}

/* ------------------------------------------------------------------ */
/* 新建 / 打开 / 保存 / 副本 / 导入导出                                  */
/* ------------------------------------------------------------------ */

export function newTrip(): void {
  deleteDraft(BLANK_TOOL_ID)
  const n = blankNode()
  n.project = { id: newId(), name: '未命名旅行' }
  clearSessionFile()
  openTrip(n, { openMode: 'embedded', fileUpdatedAt: null, skipDraftCheck: true })
  setToast('已新建旅行')
}

export async function openHandleFile(): Promise<void> {
  if (!pickerSupported()) {
    setToast('当前浏览器不支持应用内文件选择器,请改用「导入」或直接双击打开旅行文件')
    return
  }
  const r = await openTripViaPicker()
  if (!r.ok) {
    if (r.reason === 'cancelled') return
    if (r.reason === 'unsupported') {
      setToast('当前浏览器不支持应用内文件选择器,请改用「导入」或直接双击打开旅行文件')
      return
    }
    setToast('打开文件失败:' + (r.detail ?? '未知错误'))
    return
  }

  const ex = extractDataNode(r.html)
  if (!ex.ok) {
    setToast('所选文件不是有效的 TripScope 旅行文件:' + (ex.reason === 'multiple' ? '数据节点不唯一' : '未找到数据节点'))
    return
  }
  const adm = admitNode(ex.json)
  if (!adm.ok) {
    if (adm.kind === 'corrupted') {
      // 数据损坏:不采纳句柄,写回通道保持关闭,原文件不会被破坏
      openSafe('所选文件数据损坏(' + (adm.detail ?? '结构不符') + ');已进入安全模式,原文件不会被写回')
    } else {
      setForeign('所选文件不是 TripScope 旅行数据(' + (adm.detail ?? '') + ')')
    }
    return
  }
  adoptHandle(r.html, r.handle)
  openTrip(adm.node, {
    openMode: 'handle',
    fileUpdatedAt: adm.node.updatedAt,
    readonly: adm.mode === 'readonly',
    readonlyReason: adm.reason ?? '',
  })
}

export async function save(): Promise<void> {
  if (!canEdit() || !state.node) return
  const node = state.node

  if (state.openMode === 'handle') {
    const r = await saveToHandle(node)
    if (r.outcome === 'saved') {
      state.fileUpdatedAt = node.updatedAt
      setToast('已保存到文件')
      return
    }
    if (r.outcome === 'conflict') {
      state.conflictFreshRaw = r.freshRaw
      return
    }
    if (r.outcome === 'downgraded') {
      const d = downloadTripCopy(node)
      if (d.ok) {
        setToast('未能写回原文件(' + (r.detail ?? '') + '),已改为下载副本「' + d.fileName + '」')
      } else {
        setToast('未能写回原文件(' + (r.detail ?? '') + '),副本生成失败:' + d.reason + ';请使用「导出 JSON」')
      }
      return
    }
    setToast('保存失败:' + r.detail)
    return
  }

  // 双击模式:保存 = 下载副本,同一旅行延续(保持 id;空白工具首次保存固化真实 UUID)
  if (node.project.id === BLANK_TOOL_ID) {
    node.project.id = newId()
    deleteDraft(BLANK_TOOL_ID)
  }
  const d = downloadTripCopy(node)
  if (d.ok) {
    state.fileUpdatedAt = node.updatedAt
    setToast('已下载副本「' + d.fileName + '」,请从下载位置打开该文件继续编辑')
  } else {
    setToast('副本生成失败:' + d.reason + ';请使用「导出 JSON」')
  }
}

export async function saveAsCopy(): Promise<void> {
  if (!canEdit() || !state.node) return
  const clone = deepClone(state.node)
  clone.project = { id: newId(), name: state.node.project.name + ' 副本' }
  const r = await saveAsViaPicker(clone)
  if (r.ok) {
    setToast('副本已另存为「' + r.fileName + '」(新 UUID,与原旅行草稿互不干扰)')
    return
  }
  if (r.reason === 'cancelled') return
  if (r.reason === 'unsupported') {
    const d = downloadTripCopy(clone)
    if (d.ok) {
      setToast('当前浏览器不支持另存选择器,已改为下载副本「' + d.fileName + '」')
    } else {
      setToast('副本生成失败:' + d.reason + ';请使用「导出 JSON」')
    }
    return
  }
  setToast('另存副本失败:' + (r.detail ?? '未知错误'))
}

export function doExportJson(): void {
  if (!state.node || state.screen !== 'trip') return
  const r = exportJson(state.node)
  if (r.ok) setToast('已导出「' + r.fileName + '」')
}

export async function importFile(file: File): Promise<void> {
  const r = await importFromFile(file)
  if (!r.ok) {
    setToast('导入失败:' + r.reason)
    return
  }
  clearSessionFile()
  openTrip(r.node, {
    openMode: 'embedded',
    fileUpdatedAt: r.node.updatedAt,
    readonly: r.mode === 'readonly',
    readonlyReason: r.reason ?? '',
    skipDraftCheck: false,
  })
  setToast('导入成功')
}

/* ------------------------------------------------------------------ */
/* 外部修改冲突(句柄模式写回前检测到磁盘内容变化)                        */
/* ------------------------------------------------------------------ */

export type ConflictChoice = 'reload' | 'copy' | 'cancel'

export async function resolveExternalConflict(choice: ConflictChoice): Promise<void> {
  const raw = state.conflictFreshRaw
  state.conflictFreshRaw = null
  if (choice === 'cancel' || !raw) return

  if (choice === 'copy') {
    await saveAsCopy()
    return
  }

  // reload:以磁盘最新内容为准重载(句柄仍有效,继续绑定该文件)
  const ex = extractDataNode(raw)
  if (!ex.ok) {
    setToast('磁盘文件已损坏,无法重载;当前编辑仍在草稿中,请「另存为副本」或「导出 JSON」')
    return
  }
  const adm = admitNode(ex.json)
  if (!adm.ok) {
    if (adm.kind === 'corrupted') openSafe('磁盘文件数据损坏,已进入安全模式;当前编辑仍在草稿中')
    else setForeign('磁盘文件不是 TripScope 旅行数据(' + (adm.detail ?? '') + ')')
    return
  }
  adoptHandle(raw, getSessionHandle())
  openTrip(adm.node, {
    openMode: 'handle',
    fileUpdatedAt: adm.node.updatedAt,
    readonly: adm.mode === 'readonly',
    readonlyReason: adm.reason ?? '',
  })
  setToast('已重载磁盘最新内容')
}

/* ------------------------------------------------------------------ */
/* 安全模式 / 外来文件屏                                                */
/* ------------------------------------------------------------------ */

export function openSafe(detail: string): void {
  state.screen = 'safe'
  state.safeDetail = detail
  state.node = null
  state.draftBanner = null
  state.storageError = null
  state.conflictFreshRaw = null
  clearSessionFile()
  state.safeDrafts = listDrafts()
}

export function setForeign(detail: string): void {
  state.screen = 'foreign'
  state.foreignDetail = detail
  state.node = null
  state.draftBanner = null
  state.storageError = null
  state.conflictFreshRaw = null
  clearSessionFile()
}

export function restoreFromSafe(id: string): void {
  const d = loadDraft(id)
  if (!d) {
    setToast('草稿已不存在,请刷新草稿列表')
    state.safeDrafts = listDrafts()
    return
  }
  clearSessionFile()
  openTrip(d.node, { openMode: 'embedded', fileUpdatedAt: d.baseUpdatedAt, skipDraftCheck: true })
  setToast('已恢复草稿「' + d.node.project.name + '」')
}

export function refreshSafeDrafts(): void {
  state.safeDrafts = listDrafts()
}

/* ------------------------------------------------------------------ */
/* 内部工具                                                             */
/* ------------------------------------------------------------------ */

function setToast(msg: string): void {
  state.toast = msg
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    state.toast = null
  }, 4000)
}

/** 兜底反馈通道:生产版 Vue 会静默吞掉异步事件处理器中的异常,由 main.ts 的 errorHandler 调用 */
export function surfaceError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  state.toast = '操作失败:' + msg + '(请重试,或使用「导出 JSON」保全数据)'
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    state.toast = null
  }, 6000)
}

export function initRuntimeFlags(): void {
  state.pickerSupported = pickerSupported()
  state.snapshotIssues = snapshotStatus().issues
}

export function addItem(): void {
  if (!canEdit()) return
  updateData((d) => {
    const items = (d.demo?.items ?? []) as DemoItem[]
    items.push({ id: newId().slice(0, 8), label: '新条目', qty: 1 })
    if (d.demo) d.demo.items = items
    else d.demo = { items }
  })
}

export function removeItem(itemId: string): void {
  if (!canEdit()) return
  updateData((d) => {
    const items = ((d.demo?.items ?? []) as DemoItem[]).filter((i) => i.id !== itemId)
    if (d.demo) d.demo.items = items
  })
}

export function insertSpecialChars(): void {
  if (!canEdit()) return
  updateData((d) => {
    if (!d.demo) d.demo = {}
    d.demo.note = '</script>特殊字符测试 🎉 <b>粗体</b> "引号" '
  })
}
