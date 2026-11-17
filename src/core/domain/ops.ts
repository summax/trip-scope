/** 业务操作层:UI 唯一变更入口;经 store.commit(撤销单元)。 */
import { state, commit, setToast } from '../store'
import { newId, nowIso } from '../schema'
import { parseAmount } from '../amount'
import { confirmBudget, cleanupVersion, currentBudget, refreshBudget } from './budget'
import {
  adjustPaymentAmount,
  adjustPaymentDate,
  adjustPaymentType,
  recordPayment,
  setAttribution,
  deletePayment,
} from './payments'
import { candidateAmount, combinationTotal } from './pricing'
import type { Candidate, OwnershipType, PaymentType } from './types'
import { normalizeTrip, type TripBlob } from './types'

export function useTrip(): TripBlob | null {
  if (!state.node) return null
  return normalizeTrip(state.node.data.trip)
}

/** 读侧规范化:每次 UI 渲染取规范后的快照(不写回) */
export function readTrip(): TripBlob | null {
  return useTrip()
}

/** 惰性创建(仅当 trip 缺失时创建一次;已有数据零触碰,不得把文件标记为脏) */
export function ensureTrip(): TripBlob | null {
  if (!state.node || state.readonly) return null
  const existing = state.node.data.trip
  if (!existing) {
    commit(() => {}, 'ensure-trip')
  }
  return normalizeTrip(state.node.data.trip)
}

/** 金额解析:非法返回 null(界面自行提示) */
export function parseMoney(input: string): number | null {
  const r = parseAmount(input)
  return r.ok ? r.cents : null
}

/** 元字符串 → 分(成功 toast-free,失败返回 null) */
export function moneyOrNull(input: string): number | null {
  return parseMoney(input)
}

/* ---------------------------------------------------------------- */
/* 旅行基础                                                           */
/* ---------------------------------------------------------------- */

export function setTripDates(startDate: string, endDate: string): void {
  commit((t) => {
    t.info.startDate = startDate
    t.info.endDate = endDate
  }, 'trip-dates')
}

export function addTraveler(name: string, tierId: string): void {
  commit((t) => {
    t.travelers.push({ id: newId(), name, tierId })
  })
}

export function removeTraveler(travelerId: string): void {
  commit((t) => {
    removeTravelerClean(t, travelerId)
    t.travelers = t.travelers.filter((x) => x.id !== travelerId)
  })
}

export function setTravelerName(travelerId: string, name: string): void {
  commit((t) => {
    const x = t.travelers.find((p) => p.id === travelerId)
    if (x) x.name = name
  }, 'trav-name:' + travelerId)
}

export function setTravelerTier(travelerId: string, tierId: string): void {
  commit((t) => {
    const x = t.travelers.find((p) => p.id === travelerId)
    if (x) x.tierId = tierId
  }, 'trav-tier:' + travelerId)
}

export function removeTravelerClean(trip: TripBlob, travelerId: string): void {
  for (const stayId of Object.keys(trip.assignments)) {
    const byRoom = trip.assignments[stayId]
    for (const roomId of Object.keys(byRoom)) {
      byRoom[roomId] = byRoom[roomId].filter((x) => x !== travelerId)
    }
  }
}

/* ---------------- 票档 ---------------- */

export function addTier(name: string, ratioPercent: number): void {
  commit((t) => {
    t.tiers.push({ id: newId(), name, ratioPercent })
  })
}

export function setTierRatio(tierId: string, ratioPercent: number): void {
  commit((t) => {
    const x = t.tiers.find((y) => y.id === tierId)
    if (x) x.ratioPercent = ratioPercent
  }, 'tier-ratio:' + tierId)
}

export function removeTier(tierId: string): void {
  commit((t) => {
    t.tiers = t.tiers.filter((x) => x.id !== tierId)
  })
}

/* ---------------- 交通区段 ---------------- */

export function addLeg(title: string, date: string): void {
  commit((t) => {
    t.legs.push({ id: newId(), title, date })
  })
}

export function updateLegField(legId: string, field: 'title' | 'date', value: string): void {
  commit((t) => {
    const leg = t.legs.find((x) => x.id === legId)
    if (leg) (leg as unknown as Record<string, string>)[field] = value
  }, 'leg:' + legId)
}

export function removeLeg(legId: string): void {
  commit((t) => {
    t.legs = t.legs.filter((x) => x.id !== legId)
    t.candidates = t.candidates.filter((c) => c.subjectId !== legId)
    delete t.combination.selections[legId]
  })
}

/* ---------------- 住宿/房间/分配 ---------------- */

export function addStay(title: string, checkIn: string, checkOut: string): void {
  commit((t) => {
    t.stays.push({ id: newId(), title, checkIn, checkOut })
  })
}

export function updateStayField(
  stayId: string,
  field: 'title' | 'checkIn' | 'checkOut' | 'shareMode',
  value: string,
): void {
  commit((t) => {
    const s = t.stays.find((x) => x.id === stayId)
    if (s) {
      const rec = s as unknown as Record<string, string>
      rec[field] = value
    }
  }, 'stay:' + stayId)
}

export function removeStay(stayId: string): void {
  commit((t) => {
    t.stays = t.stays.filter((x) => x.id !== stayId)
    const roomIds = t.roomItems.filter((r) => r.stayId === stayId).map((r) => r.id)
    t.roomItems = t.roomItems.filter((r) => r.stayId !== stayId)
    t.candidates = t.candidates.filter(
      (c) => c.subjectId !== stayId && !roomIds.includes(c.subjectId),
    )
    delete t.combination.selections[stayId]
    delete t.combination.stayModes[stayId]
    delete t.assignments[stayId]
  })
}

export function addRoomItem(stayId: string, title: string, count: number, capacity: number): void {
  commit((t) => {
    t.roomItems.push({ id: newId(), stayId, title, count, capacity })
  })
}

export function updateRoomField(
  roomId: string,
  field: 'title' | 'count' | 'capacity',
  value: number | string,
): void {
  commit((t) => {
    const r = t.roomItems.find((x) => x.id === roomId)
    if (!r) return
    if (field === 'title') r.title = value as string
    else r[field] = Math.max(0, Math.floor(Number(value) || 0))
  }, 'room:' + roomId + ':' + field)
}

export function removeRoomItem(roomId: string): void {
  commit((t) => {
    t.roomItems = t.roomItems.filter((x) => x.id !== roomId)
    t.candidates = t.candidates.filter((c) => c.subjectId !== roomId)
  })
}

/** 房间分配:整段住宿,房间 → 旅行者集合 */
export function toggleRoomAssignment(
  stayId: string,
  roomId: string,
  travelerId: string,
): void {
  commit((t) => {
    const byRoom = (t.assignments[stayId] = t.assignments[stayId] ?? {})
    const list = byRoom[roomId] ?? []
    const idx = list.indexOf(travelerId)
    if (idx >= 0) list.splice(idx, 1)
    else list.push(travelerId)
    byRoom[roomId] = list
  })
}

/* ---------------- 自由费用 ---------------- */

export function addExpense(
  title: string,
  date: string,
  amountStr: string,
  note?: string,
): boolean {
  const cents = parseMoneyInput(amountStr)
  if (cents === null) {
    setToast('金额无效,示例:128 或 128.5')
    return false
  }
  commit((t) => {
    t.expenses.push({
      id: newId(),
      title,
      date,
      amountCents: cents,
      note,
    })
  })
  return true
}

export function updateExpenseField(
  expenseId: string,
  field: 'title' | 'date' | 'note',
  value: string,
): void {
  commit((t) => {
    const e = t.expenses.find((x) => x.id === expenseId)
    if (e) (e as unknown as Record<string, string>)[field] = value
  }, 'exp:' + expenseId + ':' + field)
}

export function setExpenseAmount(expenseId: string, amountStr: string): boolean {
  const cents = parseMoneyInput(amountStr)
  if (cents === null) {
    setToast('金额无效')
    return false
  }
  commit((t) => {
    const e = t.expenses.find((x) => x.id === expenseId)
    if (e) e.amountCents = cents
  }, 'exp-amt:' + expenseId)
  return true
}

export function removeExpense(expenseId: string): void {
  commit((t) => {
    t.expenses = t.expenses.filter((x) => x.id !== expenseId)
    // 费用无候选;预算行由版本冻结,不在删除时触碰
  })
}

/* ---------------- 候选 ---------------- */

export interface CandidateInput {
  kind: 'traffic' | 'room' | 'package'
  subjectId: string
  label: string
  depart?: string
  arrive?: string
  capacity?: number
  adultStr: string
  totalStr?: string
  validUntil?: string
  refundPolicyText?: string
}

function parseMoneyInput(s: string): number | null {
  const r = parseAmount(s)
  return r.ok ? r.cents : null
}

export function addCandidate(input: CandidateInput): boolean {
  const cents = parseMoneyInput(input.adultStr)
  if (cents === null) {
    setToast('基准价无效')
    return false
  }
  commit((t) => {
    const c: Candidate = {
      id: newId(),
      kind: input.kind,
      subjectId: input.subjectId,
      label: input.label,
      adultCents: cents,
      surcharges: [],
    }
    if (input.depart !== undefined) c.depart = input.depart
    if (input.arrive !== undefined) c.arrive = input.arrive
    if (input.capacity !== undefined) c.capacity = input.capacity
    if (input.totalStr !== undefined) {
      const total = parseMoneyInput(input.totalStr)
      if (total !== null) c.totalCents = total
    }
    if (input.validUntil !== undefined) c.validUntil = input.validUntil
    if (input.refundPolicyText !== undefined) c.refundPolicyText = input.refundPolicyText
    t.candidates.push(c)
  })
  return true
}

export function removeCandidate(candidateId: string): void {
  commit((t) => {
    t.candidates = t.candidates.filter((x) => x.id !== candidateId)
    for (const subjectId of Object.keys(t.combination.selections)) {
      if (t.combination.selections[subjectId] === candidateId) {
        delete t.combination.selections[subjectId]
      }
    }
  })
}

/** 选择/取消选择候选(组合层) */
export function selectCandidate(subjectId: string, candidateId: string | null): void {
  commit((t) => {
    if (candidateId === null) delete t.combination.selections[subjectId]
    else t.combination.selections[subjectId] = candidateId
  })
}

/** 住宿计价模式是组合层持久状态;选中的套餐保留为"已选但未生效" */
export function setStayMode(stayId: string, mode: 'rooms' | 'package'): void {
  commit((t) => {
    t.combination.stayModes[stayId] = mode
  })
}

/* ---------------- 方案(存档/加载/删除) ---------------- */

/** 存档:复制组合 → 新方案;记录逐候选金额参照(候选已变化检测锚) */
export function savePlan(name: string): void {
  commit((t) => {
    const amounts: Record<string, number> = {}
    for (const subjectId of Object.keys(t.combination.selections)) {
      const c = t.candidates.find((x) => x.id === t.combination.selections[subjectId])
      if (c) amounts[c.id] = candidateAmount(c, t)
    }
    t.plans.push({
      id: newId(),
      name,
      archivedAt: nowIso(),
      selections: { ...t.combination.selections },
      stayModes: { ...t.combination.stayModes },
      archiveTotalCents: combinationTotal(t, t.combination.selections),
      archiveAmounts: amounts,
    })
  })
  setToast('已存档方案「' + name + '」')
}

/** 加载:方案 → 组合整体替换(§6.11 语义;UI 层负责显式确认弹层) */
export function loadPlan(planId: string): void {
  commit((t) => {
    const plan = t.plans.find((p) => p.id === planId)
    if (!plan) return
    t.combination.selections = { ...plan.selections }
    t.combination.stayModes = { ...plan.stayModes }
  })
  setToast('已加载方案到当前组合')
}

export function deletePlan(planId: string): void {
  commit((t) => {
    t.plans = t.plans.filter((p) => p.id !== planId)
  })
}

/* ---------------- 预算 ---------------- */

export function doConfirmBudget(planId: string): boolean {
  let ok = false
  let err = ''
  commit((t) => {
    const r = confirmBudget(t, planId)
    ok = r.ok
    err = r.error ?? ''
  })
  if (!ok) setToast(err || '确认失败')
  else setToast('已确认正式预算 V1(来源:方案)')
  return ok
}

export function doRefreshBudget(): boolean {
  let ok = false
  let err = ''
  commit((t) => {
    const r = refreshBudget(t)
    ok = r.ok
    err = r.error ?? ''
  })
  if (!ok) setToast(err || '刷新失败')
  else setToast('已按当前组合刷新预算(来源快照已记录)')
  return ok
}

export function doCleanupVersion(versionNo: number): boolean {
  let ok = false
  let err = '清理失败'
  commit((t) => {
    const r = cleanupVersion(t, versionNo)
    ok = r.ok
    err = r.error ?? '清理失败'
  })
  if (!ok) {
    setToast(err)
    return false
  }
  setToast('已清理版本 V' + versionNo)
  return true
}

/* ---------------- 手动预算行 ---------------- */

export function addManualLine(name: string, amountStr: string, reason: string): boolean {
  const cents = parseMoneyInput(amountStr)
  if (cents === null) {
    setToast('金额无效')
    return false
  }
  let ok = false
  commit((t) => {
    const cur = currentBudget(t)
    if (!cur) return
    cur.lines.push({
      budgetLineId: newId(),
      logicalLineId: newId(),
      name,
      amountCents: cents,
      objType: 'manual',
      manualReason: reason,
      createdAt: nowIso(),
    })
    ok = true
  })
  if (!ok) setToast('尚无正式预算')
  return ok
}

export function removeManualLine(lineId: string): void {
  commit((t) => {
    const cur = currentBudget(t)
    if (!cur) return
    cur.lines = cur.lines.filter((l) => l.budgetLineId !== lineId)
  })
}

/** 修改手动行金额(限当前版本手动行) */
export function setManualLineAmount(lineId: string, amountStr: string): boolean {
  const cents = parseMoneyInput(amountStr)
  if (cents === null) {
    setToast('金额无效')
    return false
  }
  let ok = false
  commit((t) => {
    const cur = currentBudget(t)
    if (!cur) return
    const line = cur.lines.find((l) => l.budgetLineId === lineId && l.objType === 'manual')
    if (!line) return
    line.amountCents = cents
    line.updatedAt = nowIso()
    ok = true
  })
  if (!ok) setToast('行不存在或非当前版本')
  return ok
}

/* ---------------- 支付 ---------------- */

let errFromDomain = ''

export interface RecordPaymentArgs {
  type: PaymentType
  amountStr: string
  paymentDate: string
  method?: string
  note?: string
  ownershipType: OwnershipType
  budgetLineId?: string
}

export function doRecordPayment(args: RecordPaymentArgs): boolean {
  const cents = parseMoneyInput(args.amountStr)
  if (cents === null) {
    setToast('金额无效,示例:128 或 128.5')
    return false
  }
  let ok = false
  commit((t) => {
    const r = recordPayment(t, { ...args, amountCents: cents })
    ok = r.ok
    if (!r.ok) errFromDomain = r.error ?? ''
  })
  if (!ok) setToast(errFromDomain || '录入失败')
  return ok
}

export function doAdjustAmount(paymentId: string, amountStr: string): boolean {
  const cents = parseMoneyInput(amountStr)
  if (cents === null) {
    setToast('金额无效')
    return false
  }
  let ok = false
  commit((t) => {
    const r = adjustPaymentAmount(t, paymentId, cents)
    ok = r.ok
    if (!r.ok) errFromDomain = r.error ?? ''
  })
  if (!ok) setToast(errFromDomain || '调整失败')
  return ok
}

export function doAdjustDate(paymentId: string, newDate: string): boolean {
  let ok = false
  commit((t) => {
    const r = adjustPaymentDate(t, paymentId, newDate)
    ok = r.ok
    if (!r.ok) errFromDomain = r.error ?? ''
  })
  if (!ok) setToast(errFromDomain || '调整失败')
  return ok
}

export function doAdjustType(paymentId: string, newType: PaymentType): boolean {
  let ok = false
  commit((t) => {
    const r = adjustPaymentType(t, paymentId, newType)
    ok = r.ok
    if (!r.ok) errFromDomain = r.error ?? ''
  })
  if (!ok) setToast(errFromDomain || '调整失败')
  return ok
}

export function doSetAttribution(
  paymentId: string,
  ownershipType: OwnershipType,
  budgetLineId?: string,
): boolean {
  let ok = false
  commit((t) => {
    const r = setAttribution(t, paymentId, { ownershipType, budgetLineId })
    ok = r.ok
    if (!r.ok) errFromDomain = r.error ?? ''
  })
  if (!ok) setToast(errFromDomain || '归属失败')
  else setToast('归属已更新(审计已记录)')
  return ok
}

export function doDeletePayment(paymentId: string): boolean {
  let ok = false
  commit((t) => {
    const r = deletePayment(t, paymentId)
    ok = r.ok
    if (!r.ok) errFromDomain = r.error ?? ''
  })
  if (!ok) setToast(errFromDomain || '删除失败')
  return ok
}

/** ops 供 UI 使用的类型再导出 */
export type { PaymentType, OwnershipType } from './types'
