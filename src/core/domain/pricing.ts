/** 计价与候选判定(纯函数层)。票档价 = 覆盖价 ?? round(基准价 × 比例 / 100)。 */
import type { Candidate, FareTier, Traveler, TripBlob } from './types'

/** 晚数 = 半开区间 [a, b) 的日期差(非法或倒挂时为 0) */
export function nightsBetween(a: string, b: string): number {
  const t1 = Date.parse(a + 'T00:00:00')
  const t2 = Date.parse(b + 'T00:00:00')
  if (Number.isNaN(t1) || Number.isNaN(t2)) return 0
  const diff = Math.round((t2 - t1) / 86400000)
  return diff > 0 ? diff : 0
}

/** 本地今天(YYYY-MM-DD) */
export function todayStr(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 日期加 N 天;非法输入返回 null */
export function addDays(date: string, n: number): string | null {
  const t = Date.parse(date + 'T00:00:00')
  if (Number.isNaN(t)) return null
  const d = new Date(t + n * 86400000)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 票档价:覆盖价优先,否则 round(基准价 × 比例 / 100);档不存在返回 null */
export function tierPrice(c: Candidate, tiers: FareTier[], tierId: string): number | null {
  const tier = tiers.find((t) => t.id === tierId)
  if (!tier) return null
  const ov = (c.tierOverrides ?? []).find((o) => o.tierId === tierId)
  if (ov) return ov.cents
  return Math.round((c.adultCents * tier.ratioPercent) / 100)
}

/** 附加费合计(整数分) */
export function surchargeSum(c: Candidate): number {
  let s = 0
  for (const x of c.surcharges ?? []) s += x.cents
  return s
}

/** 档内人数统计:tierId → 人数 */
export function tierCounts(travelers: Traveler[]): Map<string, number> {
  const m = new Map<string, number>()
  tierCountsSink(travelers, m)
  return m
}

function tierCountsSink(travelers: Traveler[], m: Map<string, number>): void {
  for (const p of travelers) {
    m.set(p.tierId, (m.get(p.tierId) ?? 0) + 1)
  }
}

/** 候选金额(整数分):按 kind 分派计价链 + 附加费 */
export function candidateAmount(c: Candidate, trip: TripBlob): number {
  if (c.kind === 'package') {
    return (c.totalCents ?? 0) + surchargeSum(c)
  }
  if (c.kind === 'room') {
    // room 候选的 subjectId 是房间项 ID,晚数需经房间项找到所属住宿单
    const item = trip.roomItems.find((r) => r.id === c.subjectId)
    const stay = item ? trip.stays.find((s) => s.id === item.stayId) : undefined
    const nights = stay ? nightsBetween(stay.checkIn, stay.checkOut) : 0
    const count = item ? Math.max(0, Math.floor(item.count)) : 0
    return c.adultCents * nights * count + surchargeSum(c)
  }
  // traffic:每档人数 × 档价
  const counts = tierCounts(trip.travelers)
  let sum = 0
  for (const [tierId, n] of counts) {
    const price = tierPrice(c, trip.tiers, tierId)
    if (price !== null && n > 0) sum += price * n
  }
  return sum + surchargeSum(c)
}

/** 从选择集解析候选(含悬空检测) */
export interface SelectionEntry {
  subjectId: string
  candidate: Candidate
}

export function resolveSelections(
  trip: TripBlob,
  selections: Record<string, string>,
): { ok: SelectionEntry[]; dangling: { subjectId: string; candidateId: string }[] } {
  const ok: SelectionEntry[] = []
  const dangling: { subjectId: string; candidateId: string }[] = []
  for (const subjectId of Object.keys(selections)) {
    const candidateId = selections[subjectId]
    const candidate = trip.candidates.find((c) => c.id === candidateId)
    if (candidate && candidate.subjectId === subjectId) {
      ok.push({ subjectId, candidate })
    } else {
      dangling.push({ subjectId, candidateId })
    }
  }
  return { ok, dangling }
}

/** 组合总额:所选候选按当前价实时重算 */
export function combinationTotal(
  trip: TripBlob,
  selections: Record<string, string>,
): number {
  const r = resolveSelections(trip, selections)
  let total = 0
  for (const e of r.ok) total += candidateAmount(e.candidate, trip)
  return total
}

/** 方案存档时的价格上下文:候选变化检测用 */
export interface PlanPriceContext {
  /** 当前价合计 */
  total: number
  /** 与存档参照值的差额(现价合计 − 存档合计) */
  diffCents: number
  /** 有价格变化的候选 id 列表 */
  changedCandidateIds: string[]
}

/** 方案现价重算与"候选已变化"检测 */
export function planPriceContext(trip: TripBlob, plan: PlanLike): PlanPriceContext {
  const r = resolveSelections(trip, plan.selections)
  let total = 0
  const changed: string[] = []
  for (const e of r.ok) {
    const now = candidateAmount(e.candidate, trip)
    const archived = plan.archiveAmounts[e.candidate.id]
    if (archived !== undefined && archived !== now) changed.push(e.candidate.id)
    total += now
  }
  return { total, diffCents: total - plan.archiveTotalCents, changedCandidateIds: changed }
}

/** planPriceContext 所需的方案形(兼容快照差额参照) */
export interface PlanLike {
  selections: Record<string, string>
  archiveTotalCents: number
  /** 存档时的逐候选金额参照(候选已变化检测的确定性锚) */
  archiveAmounts: Record<string, number>
}

/** 候选层警告:报价过期(validUntil < 今天) */
export function expiredCandidateIds(trip: TripBlob, today: string): string[] {
  const out: string[] = []
  for (const c of trip.candidates) {
    if (c.validUntil && c.validUntil < today) out.push(c.id)
  }
  return out
}

/** 住宿容量检查:间数×容量 ≥ 分配人数;不足 → 警告条目 */
export interface CapacityIssue {
  stayId: string
  stayTitle: string
  roomId: string
  roomTitle: string
  assigned: number
  seats: number
}

export function capacityIssues(trip: TripBlob): CapacityIssue[] {
  const out: CapacityIssue[] = []
  for (const stay of trip.stays) {
    const items = trip.roomItems.filter((r) => r.stayId === stay.id)
    for (const item of items) {
      const assigned = (trip.assignments[stay.id]?.[item.id] ?? []).length
      const seats = Math.max(0, Math.floor(item.count)) * Math.max(1, item.capacity)
      if (assigned > seats) {
        out.push({
          stayId: stay.id,
          stayTitle: stay.title,
          roomId: item.id,
          roomTitle: item.title,
          assigned,
          seats,
        })
      }
    }
  }
  return out
}


