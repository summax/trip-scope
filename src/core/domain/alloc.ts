/** 分摊与汇总(纯函数):按人/按日/按类/已付对比;范围外金额单列 R。 */
import { currentBudget } from './budget'
import { nightsBetween } from './pricing'
import { paidOfLine, pendingPayments } from './payments'
import type { BudgetLine, RoomItem, Stay, Traveler, TripBlob } from './types'

/** 最大余数法均分:余数分按顺序补给前 rem 人 */
export function splitEven(amount: number, n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(amount / n)
  const rem = amount - base * n
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    out.push(base + (i < rem ? 1 : 0))
  }
  return out
}

/** 行的有效参与人(空 = 全体旅行者) */
export function lineParticipants(line: BudgetLine, trip: TripBlob): Traveler[] {
  if (line.participants && line.participants.length > 0) {
    const set = new Set(line.participants)
    return trip.travelers.filter((t) => set.has(t.id))
  }
  return trip.travelers
}

/** 行的分摊(预算行/组合估算对象 → 按人按日的分摊行) */
export interface AllocRow {
  travelerId: string
  date: string
  cents: number
  line: BudgetLine
}

function isInRange(date: string, start: string, end: string): boolean {
  if (!start || !end) return true
  return date >= start && date <= end
}

/**
 * 预算侧分摊:对当前版本每行生成按人按日的分摊行。
 * - 交通/费用/手动:全额记对象日期,参与人最大余数均分
 * - 住宿(按晚):每晚金额均分给当晚占用者(房间分配优先,退回行参与人/全体)
 * - 日期不在旅行范围 → 金额进 R 桶(不进按人/按日)
 */
export function allocateTrip(trip: TripBlob): {
  rows: AllocRow[]
  outOfRange: { date: string; name: string; cents: number }[]
} {
  const cur = currentBudget(trip)
  const rows: AllocRow[] = []
  const outOfRange: { date: string; name: string; cents: number }[] = []
  if (!cur) return { rows, outOfRange }
  for (const line of cur.lines) {
    const parts = lineParticipants(line, trip)
    if (parts.length === 0) continue
    if (line.objType === 'stay') {
      allocateStay(trip, line, parts, rows, outOfRange)
    } else {
      const leg = trip.legs.find((l) => l.id === line.sourceObjectId)
      const exp = trip.expenses.find((e) => e.id === line.sourceObjectId)
      const date = leg?.date ?? exp?.date ?? ''
      if (date && !isInRange(date, trip.info.startDate, trip.info.endDate)) {
        outOfRange.push({ date, name: line.name, cents: line.amountCents })
        continue
      }
      const shares = splitEven(line.amountCents, parts.length)
      for (let i = 0; i < parts.length; i++) {
        rows.push({ travelerId: parts[i].id, date, cents: shares[i], line })
      }
    }
  }
  return { rows, outOfRange }
}

function allocateStay(
  trip: TripBlob,
  line: BudgetLine,
  parts: Traveler[],
  rows: AllocRow[],
  outOfRange: { date: string; name: string; cents: number }[],
): void {
  // sourceObjectId = roomItemId(逐房间模式)或 stayId(套餐模式)
  const roomItem = trip.roomItems.find((r) => r.id === line.sourceObjectId)
  const stay = roomItem
    ? trip.stays.find((s) => s.id === roomItem.stayId)
    : trip.stays.find((s) => s.id === line.sourceObjectId)
  if (!stay) return
  const nights = Math.max(1, nightsBetween(stay.checkIn, stay.checkOut))
  const whole = line.objType === 'stay' && stay.shareMode === 'whole'
  if (whole) {
    if (!isInRange(stay.checkIn, trip.info.startDate, trip.info.endDate)) {
      outOfRange.push({ date: stay.checkIn, name: line.name, cents: line.amountCents })
      return
    }
    const shares = splitEven(line.amountCents, parts.length)
    for (let i = 0; i < parts.length; i++) {
      rows.push({ travelerId: parts[i].id, date: stay.checkIn, cents: shares[i], line })
    }
    return
  }
  const nightly = Math.floor(line.amountCents / nights)
  let rem = line.amountCents - nightly * nights
  for (let n = 0; n < nights; n++) {
    const date = addDaysLocal(stay.checkIn, n)
    if (date === null) continue
    if (!isInRange(date, trip.info.startDate, trip.info.endDate)) {
      outOfRange.push({ date, name: line.name, cents: nightly + (rem > 0 ? 1 : 0) })
      if (rem > 0) rem -= 1
      continue
    }
    const occupants = occupantsForNight(trip, stay, roomItem, parts)
    const shares = splitEven(nightly + (rem > 0 ? 1 : 0), occupants.length)
    for (let i = 0; i < occupants.length; i++) {
      rows.push({ travelerId: occupants[i], date, cents: shares[i], line })
    }
    if (rem > 0) rem -= 1
  }
}

function occupantsForNight(
  trip: TripBlob,
  stay: Stay,
  roomItem: RoomItem | undefined,
  parts: Traveler[],
): string[] {
  const stayAssign = trip.assignments[stay.id] ?? {}
  if (roomItem) {
    const list = stayAssign[roomItem.id] ?? []
    if (list.length > 0) return list
  } else {
    const merged: string[] = []
    for (const roomId of Object.keys(stayAssign)) {
      for (const tid of stayAssign[roomId]) merged.push(tid)
    }
    if (merged.length > 0) return merged
  }
  return parts.map((t) => t.id)
}

function addDaysLocal(date: string, n: number): string | null {
  const t = Date.parse(date + 'T00:00:00')
  if (Number.isNaN(t)) return null
  const d = new Date(t + n * 86400000)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 汇总(当前版本 + 记账侧) */
export interface PersonSummary {
  travelerId: string
  name: string
  budget: number
  paidShare: number
}

export interface DaySummary {
  date: string
  budget: number
}

export interface CategorySummary {
  objType: 'traffic' | 'stay' | 'expense' | 'manual'
  budget: number
  paid: number
}

export interface TripSummary {
  hasBudget: boolean
  budgetTotal: number
  paidTotal: number
  outsideTotal: number
  pendingTotal: number
  pendingCount: number
  diff: number
  perPerson: PersonSummary[]
  perDay: DaySummary[]
  perCategory: CategorySummary[]
  outOfRangeTotal: number
  outOfRangeRows: { date: string; name: string; cents: number }[]
}

export function tripSummary(trip: TripBlob): TripSummary {
  const cur = currentBudget(trip)
  const alloc = allocateTrip(trip)
  let budgetTotal = 0
  for (const l of cur?.lines ?? []) budgetTotal += l.amountCents
  const paid = paidTotalOf(trip)
  const pending = pendingPayments(trip)
  let pendingTotal = 0
  for (const p of pending) pendingTotal += p.amountCents
  let outside = 0
  for (const p of trip.payments) {
    if (p.ownershipType === 'outside') outside += p.amountCents
  }
  const perPerson: PersonSummary[] = trip.travelers.map((t) => ({
    travelerId: t.id,
    name: t.name,
    budget: 0,
    paidShare: 0,
  }))
  const byId = new Map(perPerson.map((x) => [x.travelerId, x]))
  for (const r of alloc.rows) {
    const cell = byId.get(r.travelerId)
    if (cell) cell.budget += r.cents
  }
  // 每人已付 = 行已付 × 该行分摊权重
  const byLine = new Map<string, AllocRow[]>()
  for (const r of alloc.rows) {
    const list = byLine.get(r.line.budgetLineId) ?? []
    list.push(r)
    byLine.set(r.line.budgetLineId, list)
  }
  for (const line of cur?.lines ?? []) {
    const rows = byLine.get(line.budgetLineId)
    if (!rows || rows.length === 0) continue
    const totalW = rows.reduce((acc, r) => acc + r.cents, 0)
    if (totalW <= 0) continue
    const linePaid = paidOfLine(trip, line.budgetLineId)
    for (const r of rows) {
      const cell = byId.get(r.travelerId)
      if (cell) cell.paidShare += Math.round((linePaid * r.cents) / totalW)
    }
  }
  const perDayMap = new Map<string, number>()
  for (const r of alloc.rows) {
    perDayMap.set(r.date, (perDayMap.get(r.date) ?? 0) + r.cents)
  }
  const perDay: DaySummary[] = [...perDayMap.entries()]
    .map(([date, budget]) => ({ date, budget }))
    .sort((x, y) => (x.date < y.date ? -1 : 1))
  const catOrder: CategorySummary['objType'][] = ['traffic', 'stay', 'expense', 'manual']
  const perCategory: CategorySummary[] = catOrder.map((t) => ({ objType: t, budget: 0, paid: 0 }))
  for (const l of cur?.lines ?? []) {
    const cat = perCategory.find((c) => c.objType === l.objType)
    if (cat) cat.budget += l.amountCents
  }
  for (const p of trip.payments) {
    if (p.ownershipType === 'line') {
      const ref = findLineRef(trip, p.budgetLineId)
      const cat = perCategory.find((c) => c.objType === ref?.line.objType)
      if (cat) cat.paid += p.amountCents
  }
  }
  const oor = alloc.outOfRange
  let outOfRangeTotal = 0
  for (const r of oor) outOfRangeTotal += r.cents
  return {
    hasBudget: trip.budgets.length > 0,
    budgetTotal,
    paidTotal: paid,
    outsideTotal: outside,
    pendingTotal,
    pendingCount: pending.length,
    diff: budgetTotal - paid,
    perPerson,
    perDay,
    perCategory,
    outOfRangeTotal,
    outOfRangeRows: oor,
  }
}

function paidTotalOf(trip: TripBlob): number {
  let s = 0
  for (const p of trip.payments) s += p.amountCents
  return s
}

function findLineRef(
  trip: TripBlob,
  id: string | undefined,
): { line: { objType: CategorySummary['objType'] } } | null {
  for (const v of trip.budgets) {
    const line = v.lines.find((l) => l.budgetLineId === id)
    if (line) return { line }
  }
  return null
}
