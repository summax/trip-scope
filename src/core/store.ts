import { reactive } from 'vue'
import {
  BLANK_TOOL_ID,
  SUPPORTED_SCHEMA_VERSION,
  blankNode,
  deepClone,
  extractDataNode,
  newId,
  nowIso,
  serializeNode,
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
  listUnsavedDrafts,
  resolveDraftOnOpen,
  saveDraft,
  loadTheme,
  saveTheme,
  type DraftListItem,
} from './persistence/storage'
import {
  adoptHandle,
  clearSessionFile,
  downloadTripCopy,
  getSessionHandle,
  openTripViaPicker,
  saveAsViaPicker,
  saveToHandle,
  sessionFileName,
  snapshotStatus,
  pickerSupported,
} from './persistence/archive'
import { loadLastHandle, clearLastHandle } from './persistence/handleStore'
import { exportJson, importFromFile } from './persistence/transfer'

/* ------------------------------------------------------------------ */
/* 全局响应式状态                                                       */
/* ------------------------------------------------------------------ */

export type ScreenMode = 'trip' | 'foreign' | 'safe'
export type OpenMode = 'embedded' | 'handle'

export type SafeDraftItem = DraftListItem

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
  draftsPanelOpen: boolean
  draftsPanelList: SafeDraftItem[]
  theme: 'light' | 'dark'
  snapshotIssues: string[]
  pickerSupported: boolean
  appVersion: string
  /** 句柄模式下,本次会话首次写回将把磁盘原文件从 v{N} 原地升级;非 null 时保存前需确认 */
  upgradeFromVersion: number | null
  upgradeConfirmOpen: boolean
  /** 刷新后可重连的最近文件(句柄经 IndexedDB 持久化) */
  reconnectOffer: { fileName: string } | null
  /** 当前上下文的文件名锚点:句柄模式=句柄文件名;嵌入模式=宿主文件名 */
  currentFileName: string | null
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
  draftsPanelOpen: false,
  draftsPanelList: [],
  theme: 'light',
  snapshotIssues: [],
  pickerSupported: false,
  appVersion: __APP_VERSION__,
  upgradeFromVersion: null,
  upgradeConfirmOpen: false,
  reconnectOffer: null,
  currentFileName: null,
})

/* toast 自动消失定时器 */
let toastTimer: ReturnType<typeof setTimeout> | null = null
let draftTimer: ReturnType<typeof setTimeout> | null = null

/** 草稿防抖窗口(ms):测试可注入,生产默认 300ms */
let draftDebounceMs = 300
export function setDraftDebounceForTest(ms: number): void {
  draftDebounceMs = ms
}

/** 升级写回确认标记:同一上下文内确认过一次即可,上下文切换即重置 */
let upgradeWriteConfirmed = false

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
  /** 准入跑过迁移链时的迁移前版本号(仅 handle 模式参与升级确认裁决) */
  migratedFrom?: number
  /** 句柄模式的文件名锚点:调用方在准入成功后显式传入,消除「先 adopt 再 open」的顺序依赖 */
  fileName?: string | null
}

function openTrip(
  node: TripNode,
  opts: OpenContext,
): void {
  flushDraft()
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
  state.upgradeFromVersion = null
  upgradeWriteConfirmed = false
  // 文件名锚点:调用方显式传入优先;句柄模式退回会话句柄(恢复/重载等会话已绑定时);
  // 嵌入模式读宿主文件(location 不可用时为 null)
  state.currentFileName =
    opts.fileName !== undefined
      ? opts.fileName
      : opts.openMode === 'handle'
        ? sessionFileName()
        : typeof location !== 'undefined'
          ? decodeURIComponent(location.pathname.split('/').pop() ?? '') || null
          : null
  if (
    opts.openMode === 'handle' &&
    typeof opts.migratedFrom === 'number' &&
    opts.migratedFrom < SUPPORTED_SCHEMA_VERSION
  ) {
    // 本次会话的首次写回会把磁盘原文件从 v{N} 原地升级;首次「保存到文件」前必须经确认
    state.upgradeFromVersion = opts.migratedFrom
  }

  if (!state.readonly && !opts.skipDraftCheck) {
    const r = resolveDraftOnOpen(node.project.id, node)
    if (r.entry) {
      state.draftBanner = {
        entry: r.entry,
        basedOnCurrent: r.entry.baseUpdatedAt === opts.fileUpdatedAt,
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* 上下文准入工厂:所有把旅行数据载入上下文的路径都经此处,                */
/* 绕过准入在结构上不可能(openTrip 不对外导出)                          */
/* ------------------------------------------------------------------ */

export interface OpenJsonResult {
  opened: boolean
}

/** JSON 文本 → 准入(格式/版本/迁移)→ 打开上下文 */
export function openFromJson(
  json: string,
  openMode: OpenMode,
  opts?: { fileUpdatedAt?: string | null; skipDraftCheck?: boolean; fileName?: string | null },
): OpenJsonResult {
  const adm = admitNode(json)
  if (!adm.ok) {
    if (adm.kind === 'corrupted') {
      openSafe('数据损坏(' + (adm.detail ?? '') + ');原文件未被修改,可尝试恢复本地草稿')
    } else {
      setForeign('不是 TripScope 旅行数据(' + (adm.detail ?? '') + ')')
    }
    return { opened: false }
  }
  openTrip(adm.node, {
    openMode,
    fileUpdatedAt: opts?.fileUpdatedAt !== undefined ? opts.fileUpdatedAt : adm.node.updatedAt,
    readonly: adm.mode === 'readonly',
    readonlyReason: adm.reason ?? '',
    skipDraftCheck: opts?.skipDraftCheck,
    migratedFrom: adm.migratedFrom,
    fileName: opts?.fileName,
  })
  return { opened: true }
}

/** 从草稿条目恢复(同样强制过准入):恢复路径不可能载入未过准入的数据 */
export function restoreDraftNode(
  node: TripNode,
  openMode: OpenMode,
  fileUpdatedAt: string | null,
): OpenJsonResult {
  return openFromJson(serializeNode(node), openMode, {
    fileUpdatedAt,
    skipDraftCheck: true,
  })
}

/**
 * 空白工具打开:恢复最近一份从未落盘的草稿(创建于空白工具、未保存过文件),
 * 防止刷新/关闭导致未保存内容成为孤儿键;没有则开全新空白。
 */
export function openBlankTool(): void {
  clearSessionFile()
  const candidates = listUnsavedDrafts()
  const d = candidates.find((e) => e.node.project.id === BLANK_TOOL_ID) ?? candidates[0]
  if (d) {
    const restored = restoreDraftNode(d.node, 'embedded', null)
    if (restored.opened && d.node.project.id !== BLANK_TOOL_ID) {
      setToast('已恢复未保存的旅行「' + d.node.project.name + '」')
    }
    return
  }
  openTrip(blankNode(), { openMode: 'embedded', fileUpdatedAt: null, skipDraftCheck: true })
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
  // 不在输入回调里 trim:否则尾随空格无法输入;文件命名时由 sanitizeFileName 兜底
  state.node.project.name = name
  state.node.updatedAt = nowIso()
  scheduleDraft()
}

function canEdit(): boolean {
  return state.screen === 'trip' && !state.readonly && state.node !== null
}

/** 排期时的快照:回调触发时上下文可能已切换,必须写排期时的内容与键 */
let pendingDraft: { node: TripNode; base: string | null } | null = null

function scheduleDraft(): void {
  if (state.readonly || !state.node) return
  pendingDraft = { node: deepClone(state.node), base: state.fileUpdatedAt }
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(flushDraft, draftDebounceMs)
}

/** 立即把排期中的草稿写入存储(上下文切换前 / beforeunload 时调用) */
export function flushDraft(): void {
  if (draftTimer) {
    clearTimeout(draftTimer)
    draftTimer = null
  }
  if (!pendingDraft) return
  const p = pendingDraft
  pendingDraft = null
  const r = saveDraft(p.node, p.base)
  if (!r.ok) {
    state.storageError =
      '本地草稿保存失败(' + r.error + '),请尽快使用「保存」或「导出 JSON」'
  }
}

/* ------------------------------------------------------------------ */
/* 草稿横幅:恢复 / 丢弃                                                */
/* ------------------------------------------------------------------ */

export function restoreDraft(): void {
  if (!state.draftBanner || !state.node) return
  // 横幅持有的 entry 是内存副本,即使草稿存储已被后续编辑覆盖也能完整恢复;
  // 恢复同样经过准入(高版本草稿 → 只读),不可能绕过
  const r = restoreDraftNode(state.draftBanner.entry.node, state.openMode, state.fileUpdatedAt)
  state.draftBanner = null
  if (!r.opened) return
  setToast('已恢复草稿')
}

export function discardDraft(): void {
  if (!state.draftBanner || !state.node) return
  // 丢弃声明「文件版本为准」:挂起的排期快照属同键时一并清除,否则 300ms 后复活
  const bannerId = state.draftBanner.entry.node.project.id
  if (pendingDraft && pendingDraft.node.project.id === bannerId) pendingDraft = null
  deleteDraft(bannerId)
  state.draftBanner = null
  setToast('已丢弃草稿')
}

/* ------------------------------------------------------------------ */
/* 新建 / 打开 / 保存 / 副本 / 导入导出                                  */
/* ------------------------------------------------------------------ */

export function newTrip(): void {
  // 待冲刷的排期快照属于即将删除的空白键时一并清除,否则 openTrip 的冲刷会把旧编辑复活到该键
  if (pendingDraft && pendingDraft.node.project.id === BLANK_TOOL_ID) pendingDraft = null
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
  // 准入在工厂内强制执行;仅在成功打开后才采纳句柄(损坏/外来文件不采纳,写回通道保持关闭)
  const opened = openFromJson(ex.json, 'handle', { fileName: unknownHandleName(r.handle) })
  if (opened.opened) {
    adoptHandle(r.html, r.handle)
  }
}

/** unknown 句柄取文件名;无名字符串时返回 null */
function unknownHandleName(handle: unknown): string | null {
  const n = (handle as { name?: unknown } | null)?.name
  return typeof n === 'string' && n !== '' ? n : null
}

export async function save(): Promise<void> {
  if (!canEdit() || !state.node) return
  const node = state.node
  // 落盘痕迹必须准:写出文件的 appVersion 一律是当前应用版本
  node.appVersion = __APP_VERSION__

  if (state.openMode === 'handle') {
    // 迁移写回 = 原地升级磁盘原文件;本次会话首次写回必须经确认(取消后下次保存再次询问)
    if (state.upgradeFromVersion !== null && !upgradeWriteConfirmed) {
      state.upgradeConfirmOpen = true
      return
    }
    // 升级写回:迁移后的旧文件以当前应用完整快照为底整体替换,不允许「新数据+旧代码」组合落盘
    const r = await saveToHandle(node, { fullAppUpgrade: state.upgradeFromVersion !== null })
    if (r.outcome === 'saved') {
      state.fileUpdatedAt = node.updatedAt
      state.upgradeFromVersion = null
      setToast('已保存到文件')
      return
    }
    if (r.outcome === 'conflict') {
      state.conflictFreshRaw = r.freshRaw
      return
    }
    if (r.outcome === 'downgraded') {
      // 升级场景的降级副本同样必须携带当前应用代码(preferSnapshot)
      const d = downloadTripCopy(node, state.upgradeFromVersion !== null)
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
    // 固化后旧空白键即将删除:挂起的排期快照若属该键,一并清除,否则冲刷复活旧内容
    if (pendingDraft && pendingDraft.node.project.id === BLANK_TOOL_ID) pendingDraft = null
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
  clone.appVersion = __APP_VERSION__
  clone.project = { id: newId(), name: state.node.project.name + ' 副本' }
  // 迁移升级场景的副本必须是完整新版本(应用代码 + 数据),不许旧代码进副本
  const preferSnapshot = state.upgradeFromVersion !== null
  const r = await saveAsViaPicker(clone, preferSnapshot)
  if (r.ok) {
    setToast('副本已另存为「' + r.fileName + '」(新 UUID,与原旅行草稿互不干扰)')
    return
  }
  if (r.reason === 'cancelled') return
  if (r.reason === 'unsupported') {
    const d = downloadTripCopy(clone, preferSnapshot)
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
  // 落盘痕迹必须准:JSON 导出也是落盘路径,与 save/saveAsCopy 同一纪律
  state.node.appVersion = __APP_VERSION__
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
  openFromJson(serializeNode(r.node), 'embedded')
  setToast('导入成功')
}

/* ------------------------------------------------------------------ */
/* 迁移写回升级确认                                                      */
/* ------------------------------------------------------------------ */

/** 确认升级写回:本次会话内不再重复询问 */
export function confirmUpgradeWrite(): void {
  state.upgradeConfirmOpen = false
  upgradeWriteConfirmed = true
  void save()
}

/** 取消:弹层关闭,下次保存仍会询问 */
export function cancelUpgradeWrite(): void {
  state.upgradeConfirmOpen = false
}

/** 弹层内改走「另存为副本」:原文件保持 v{N} 原样,弹层关闭 */
export function upgradeCopyInstead(): void {
  state.upgradeConfirmOpen = false
  void saveAsCopy()
}

/* ------------------------------------------------------------------ */
/* 刷新后重连(句柄持久化)                                               */
/* ------------------------------------------------------------------ */

/** 启动时读取持久化槽位,填充重连邀请。不自动连接:复权需要用户手势 */
export async function initReconnectOffer(): Promise<void> {
  const p = await loadLastHandle()
  if (!p || !p.fileName) return
  state.reconnectOffer = { fileName: p.fileName }
}

/** 忽略:关闭邀请条并删除持久化槽位,不再提示 */
export function dismissReconnect(): void {
  state.reconnectOffer = null
  void clearLastHandle()
}

/**
 * 重连最近文件:复权(重连按钮点击即用户手势)→ 重读磁盘 → 准入 → 句柄模式重新打开。
 * 任何失败都不静默:toast 说明原因;文件已消失时清除槽位,不悬挂死邀请。
 */
export async function reconnectLastFile(): Promise<void> {
  const offer = state.reconnectOffer
  if (!offer) return
  const p = await loadLastHandle()
  if (!p) {
    state.reconnectOffer = null
    return
  }
  const handle = p.handle as {
    queryPermission?: (o: { mode: string }) => Promise<string>
    requestPermission?: (o: { mode: string }) => Promise<string>
    getFile?: () => Promise<File>
  }
  let granted = false
  try {
    if (typeof handle.queryPermission === 'function') {
      granted = (await handle.queryPermission({ mode: 'readwrite' })) === 'granted'
    }
    if (!granted && typeof handle.requestPermission === 'function') {
      granted = (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'
    }
  } catch {
    granted = false
  }
  if (!granted) {
    setToast('未能获得「' + offer.fileName + '」的写权限,未重连')
    return
  }
  let text: string
  try {
    const f = await handle.getFile?.()
    if (!f) throw new Error('句柄无 getFile')
    text = await f.text()
  } catch {
    setToast('「' + offer.fileName + '」已无法读取(可能被移动或删除),已清除重连记录')
    state.reconnectOffer = null
    void clearLastHandle()
    return
  }
  const ex = extractDataNode(text)
  if (!ex.ok) {
    setToast('「' + offer.fileName + '」结构异常,未打开')
    return
  }
  const opened = openFromJson(ex.json, 'handle', { fileName: offer.fileName })
  if (opened.opened) {
    adoptHandle(text, p.handle)
    state.reconnectOffer = null
    setToast('已重新连接「' + offer.fileName + '」')
  }
}

export type ConflictChoice = 'reload' | 'copy' | 'cancel'

/* ------------------------------------------------------------------ */
/* 外部修改冲突(句柄模式写回前检测到磁盘内容变化)                        */
/* ------------------------------------------------------------------ */

export async function resolveExternalConflict(choice: ConflictChoice): Promise<void> {
  const raw = state.conflictFreshRaw
  state.conflictFreshRaw = null
  if (choice === 'cancel' || !raw) return

  if (choice === 'copy') {
    await saveAsCopy()
    return
  }

  // reload:以磁盘最新内容为准重载(句柄仍有效,继续绑定该文件);重载同样强制过准入
  const ex = extractDataNode(raw)
  if (!ex.ok) {
    setToast('磁盘文件已损坏,无法重载;当前编辑仍在草稿中,请「另存为副本」或「导出 JSON」')
    return
  }
  const opened = openFromJson(ex.json, 'handle', { fileName: sessionFileName() })
  if (opened.opened) {
    adoptHandle(raw, getSessionHandle())
    setToast('已重载磁盘最新内容')
  }
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
  const r = restoreDraftNode(d.node, 'embedded', d.baseUpdatedAt)
  if (!r.opened) return
  setToast('已恢复草稿「' + d.node.project.name + '」')
}

export function refreshSafeDrafts(): void {
  state.safeDrafts = listDrafts()
}

/* ------------------------------------------------------------------ */
/* 草稿箱:普通界面查看/恢复/删除全部草稿(含未落盘的孤儿草稿)              */
/* ------------------------------------------------------------------ */

export function openDraftsPanel(): void {
  state.draftsPanelOpen = true
  state.draftsPanelList = listDrafts()
}

export function closeDraftsPanel(): void {
  state.draftsPanelOpen = false
}

function refreshDraftsPanel(): void {
  state.draftsPanelList = listDrafts()
}

/** 从草稿箱恢复:同样强制过准入;成败分别反馈,不谎报 */
export function restoreFromPanel(id: string): void {
  const d = loadDraft(id)
  if (!d) {
    setToast('草稿已不存在,请刷新草稿箱')
    refreshDraftsPanel()
    return
  }
  clearSessionFile()
  const r = restoreDraftNode(d.node, 'embedded', d.baseUpdatedAt)
  state.draftsPanelOpen = false
  if (!r.opened) return
  setToast('已恢复草稿「' + d.node.project.name + '」')
}

export function deleteFromPanel(id: string): void {
  // 待冲刷的排期快照属于被删草稿时一并清除,否则 300ms 后复活,提示与事实不符
  if (pendingDraft && pendingDraft.node.project.id === id) pendingDraft = null
  deleteDraft(id)
  refreshDraftsPanel()
  setToast('草稿已删除')
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
