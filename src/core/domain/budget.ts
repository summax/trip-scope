/** 预算版本域(纯函数,操作传入的 TripBlob)。 */
import { newId, nowIso } from '../schema'
import { candidateAmount, resolveSelections } from './pricing'
import type {
  BudgetLine,
  BudgetVersion,
  LineObjType,
  SourceSnapshot,
  TripBlob,
} from './types'

/** 支付的归属定位(审计与情况 B 处理共用) */
export interface LineRefInfo {
  budgetLineId: string
  lineName: string
  versionNo: number
}

export function findLine(
  trip: TripBlob,
  budgetLineId: string | undefined,
): { version: BudgetVersion; line: BudgetLine } | null {
  if (!budgetLineId) return null
  for (const v of trip.budgets) {
    const line = v.lines.find((l) => l.budgetLineId === budgetLineId)
    if (line) return { version: v, line }
  }
  return null
}

/** 当前版本号(最大,无预算 → 0) */
export function currentVersionNo(trip: TripBlob): number {
  let max = 0
  for (const v of trip.budgets) if (v.versionNo > max) max = v.versionNo
  return max
}

/** 当前可编辑版本;无预算 → null */
export function currentBudget(trip: TripBlob): BudgetVersion | null {
  const no = currentVersionNo(trip)
  return no === 0 ? null : (trip.budgets.find((v) => v.versionNo === no) ?? null)
}

/** 消费对象标题(交通=区段标题;房间=住宿·房间;套餐/房间组=住宿标题;费用=标题) */
export function objectTitle(trip: TripBlob, subjectId: string): string {
  const leg = trip.legs.find((x) => x.id === subjectId)
  if (leg) return leg.title
  const item = trip.roomItems.find((x) => x.id === subjectId)
  if (item) {
    const stay = trip.stays.find((s) => s.id === item.stayId)
    return (stay ? stay.title + ' · ' : '') + item.title
  }
  const stay = trip.stays.find((x) => x.id === subjectId)
  if (stay) return stay.title
  const exp = trip.expenses.find((x) => x.id === subjectId)
  if (exp) return exp.title
  return subjectId
}

/** 行种子:从选择集 + 费用生成的预算行快照内容 */
export interface LineSeed {
  name: string
  amountCents: number
  objType: LineObjType
  sourceObjectId?: string
  sourceCandidateRef?: string
  participants?: string[]
}

function participantsOf(trip: TripBlob, subjectId: string): string[] | undefined {
  const leg = trip.legs.find((x) => x.id === subjectId)
  if (leg) return leg.participants
  const item = trip.roomItems.find((x) => x.id === subjectId)
  if (item) {
    const stay = trip.stays.find((s) => s.id === item.stayId)
    return stay?.participants
  }
  const stay = trip.stays.find((x) => x.id === subjectId)
  if (stay) return stay.participants
  const exp = trip.expenses.find((x) => x.id === subjectId)
  return exp?.participants
}

/** 从选择集 + 费用生成行种子(费用对象恒成行) */
export function linesFromSelection(
  trip: TripBlob,
  selections: Record<string, string>,
): LineSeed[] {
  const seeds: LineSeed[] = []
  const r = resolveSelections(trip, selections)
  for (const e of r.ok) {
    const c = e.candidate
    const label = objectTitle(trip, e.subjectId)
    const parts = participantsOf(trip, e.subjectId)
    if (c.kind === 'traffic') {
      seeds.push({
        name: label + ' · ' + c.label,
        amountCents: candidateAmount(c, trip),
        objType: 'traffic',
        sourceObjectId: e.subjectId,
        sourceCandidateRef: c.id,
        participants: parts,
      })
    } else if (c.kind === 'room') {
      seeds.push({
        name: label + ' · ' + c.label,
        amountCents: candidateAmount(c, trip),
        objType: 'stay',
        sourceObjectId: e.subjectId,
        sourceCandidateRef: c.id,
        participants: parts,
      })
    } else {
      seeds.push({
        name: label + ' · ' + c.label,
        amountCents: candidateAmount(c, trip),
        objType: 'stay',
        sourceObjectId: e.subjectId,
        sourceCandidateRef: c.id,
        participants: parts,
      })
    }
  }
  for (const ex of trip.expenses) {
    seeds.push({
      name: ex.title,
      amountCents: ex.amountCents,
      objType: 'expense',
      sourceObjectId: ex.id,
      participants: ex.participants,
    })
  }
  return seeds
}

/** 确认 V1:从已存档方案生成首版预算;失败返回原因 */
export function confirmBudget(
  trip: TripBlob,
  planId: string,
): { ok: boolean; error?: string } {
  const plan = trip.plans.find((p) => p.id === planId)
  if (!plan) return { ok: false, error: '方案不存在' }
  if (trip.budgets.length > 0) return { ok: false, error: '已有正式预算' }
  const mint = () => newId()
  const lines: BudgetLine[] = linesFromSelection(trip, plan.selections).map((s) => ({
    budgetLineId: newId(),
    logicalLineId: mint(),
    name: s.name,
    amountCents: s.amountCents,
    objType: s.objType,
    sourceObjectId: s.sourceObjectId,
    sourceCandidateRef: s.sourceCandidateRef,
    participants: s.participants,
    createdAt: nowIso(),
  }))
  const version: BudgetVersion = {
    id: newId(),
    versionNo: 1,
    createdAt: nowIso(),
    sourceType: 'first',
    sourcePlanId: plan.id,
    lines,
  }
  trip.budgets.push(version)
  return { ok: true }
}

/** 刷新时点的来源快照(不记价格) */
function snapshotOf(
  selections: Record<string, string>,
  stayModes: Record<string, 'rooms' | 'package'>,
): SourceSnapshot {
  const sels = Object.keys(selections).map((subjectId) => ({
    subjectId,
    candidateId: selections[subjectId],
  }))
  const modes = Object.keys(stayModes).map((stayId) => ({
    stayId,
    mode: stayModes[stayId],
  }))
  return { snapshotAt: nowIso(), selections: sels, stayModes: modes }
}

/**
 * 刷新(策略乙):从当前组合生成新版本。
 * - sourceObjectId 相同 → 继承上一版 logicalLineId(逻辑行传播)
 * - 来源对象未在新选择中 → 不产生新行(情况 A,逻辑 ID 留在旧实例)
 * - 支付挂靠的旧行逻辑项消失 → 支付转"待归位"(情况 B,追加审计)
 * - 手动行不继承(默认无跨版本对应)
 */
export function refreshBudget(trip: TripBlob): { ok: boolean; error?: string } {
  const prev = currentBudget(trip)
  if (!prev) return { ok: false, error: '尚无正式预算' }
  const prevByObject = new Map<string, BudgetLine>()
  for (const l of prev.lines) {
    if (l.sourceObjectId) prevByObject.set(l.sourceObjectId, l)
  }
  const seeds = linesFromSelection(
    trip,
    trip.combination.selections,
  )
  const lines: BudgetLine[] = seeds.map((s) => {
    const inherited =
      s.sourceObjectId !== undefined ? prevByObject.get(s.sourceObjectId) : undefined
    return {
      budgetLineId: newId(),
      logicalLineId: inherited ? inherited.logicalLineId : newId(),
      name: s.name,
      amountCents: s.amountCents,
      objType: s.objType,
      sourceObjectId: s.sourceObjectId,
      sourceCandidateRef: s.sourceCandidateRef,
      participants: s.participants,
      createdAt: nowIso(),
    }
  })
  const version: BudgetVersion = {
    id: newId(),
    versionNo: prev.versionNo + 1,
    createdAt: nowIso(),
    sourceType: 'refresh',
    sourceSnapshot: snapshotOf(trip.combination.selections, trip.combination.stayModes),
    lines,
  }
  trip.budgets.push(version)
  // 情况 B:旧版行被支付挂靠、但其逻辑项不在新版本 → 转待归位
  const newLogicalIds = new Set(
    lines.map((l) => l.logicalLineId).filter((x) => x !== undefined),
  )
  for (const pay of trip.payments) {
    const ref = findLine(trip, pay.budgetLineId)
    if (!ref) continue
    if (ref.version.id !== prev.id) continue
    const lid = ref.line.logicalLineId
    if (lid !== undefined && newLogicalIds.has(lid)) continue
    pay.attributionState = 'pending'
    trip.auditLog.push({
      id: newId(),
      at: nowIso(),
      type: '待处理归位',
      paymentId: pay.paymentId,
      detail: `刷新后逻辑项不再包含,转待归位(原:${ref.line.name} V${ref.version.versionNo})`,
      before: {
        ownershipType: 'line',
        budgetLineId: pay.budgetLineId,
        lineName: ref.line.name,
        versionNo: ref.version.versionNo,
      },
      after: { ownershipType: 'none' },
    })
  }
  return { ok: true }
}

/** 可否清理某版本:非当前且非当前的前一版(保留当前+上一版) */
export function canCleanupVersion(trip: TripBlob, versionNo: number): boolean {
  const cur = currentVersionNo(trip)
  if (versionNo >= cur) return false
  return versionNo !== cur - 1
}

/**
 * 版本清理:引用被清理版本行的支付先附一层行级快照(时点事实,追加不覆盖),
 * 然后移除该版本;支付与审计零丢失。
 */
export function cleanupVersion(
  trip: TripBlob,
  versionNo: number,
): { ok: boolean; error?: string } {
  if (!canCleanupVersion(trip, versionNo)) {
    return { ok: false, error: '只能清理非当前且非上一版的版本' }
  }
  const version = trip.budgets.find((v) => v.versionNo === versionNo)
  if (!version) return { ok: false, error: '版本不存在' }
  const lineById = new Map(version.lines.map((l) => [l.budgetLineId, l]))
  for (const pay of trip.payments) {
    if (!pay.budgetLineId) continue
    const line = lineById.get(pay.budgetLineId)
    if (!line) continue
    pay.cleanups = pay.cleanups ?? []
    pay.cleanups.push({
      versionNo,
      lineName: line.name,
      lineAmountCents: line.amountCents,
      paymentAmountCents: pay.amountCents,
      at: nowIso(),
    })
  }
  trip.budgets = trip.budgets.filter((v) => v.versionNo !== versionNo)
  trip.auditLog.push({
    id: newId(),
    at: nowIso(),
    type: '版本清理',
    detail: `清理预算版本 V${versionNo}(引用支付已附行级快照)`,
  })
  return { ok: true }
}

/** 版本对比行(按 logicalLineId 对应) */
export interface CompareRow {
  logicalLineId: string
  a?: BudgetLine
  b?: BudgetLine
  status: 'same' | 'changed' | 'added' | 'removed'
}

/** 版本对比:按 logicalLineId 对应,状态 = 改额/新增/不再包含 */
export function compareVersions(
  trip: TripBlob,
  versionNoA: number,
  versionNoB: number,
): { rows: CompareRow[]; totalA: number; totalB: number } {
  const va = trip.budgets.find((v) => v.versionNo === versionNoA)
  const vb = trip.budgets.find((v) => v.versionNo === versionNoB)
  if (!va || !vb) return { rows: [], totalA: 0, totalB: 0 }
  const byLogical = new Map<string, CompareRow>()
  for (const l of va.lines) {
    const key = l.logicalLineId ?? 'manual:' + l.budgetLineId
    byLogical.set(key, { logicalLineId: key, a: l, status: 'removed' })
  }
  for (const l of vb.lines) {
    const key = l.logicalLineId ?? 'manual:' + l.budgetLineId
    const row = byLogical.get(key)
    if (row) {
      row.b = l
      row.status = (row.a?.amountCents ?? 0) === l.amountCents ? 'same' : 'changed'
    } else {
      byLogical.set(key, { logicalLineId: key, b: l, status: 'added' })
    }
  }
  let totalA = 0
  let totalB = 0
  for (const l of va.lines) totalA += l.amountCents
  for (const l of vb.lines) totalB += l.amountCents
  return { rows: [...byLogical.values()], totalA, totalB }
}

/** 当前版本行级多付检测:Σ已归位支付 > 行金额 → 警告 */
export function overpaidLines(trip: TripBlob): {
  line: BudgetLine
  paid: number
  amount: number
}[] {
  const cur = currentBudget(trip)
  if (!cur) return []
  const out: { line: BudgetLine; paid: number; amount: number }[] = []
  for (const line of cur.lines) {
    let paid = 0
    for (const p of trip.payments) {
      if (p.ownershipType === 'line' && p.budgetLineId === line.budgetLineId) {
        paid += p.amountCents
      }
    }
    if (paid > line.amountCents) out.push({ line, paid, amount: line.amountCents })
  }
  return out
}
