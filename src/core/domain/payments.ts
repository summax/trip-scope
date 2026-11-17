/** 支付域(实付记账;裁剪后单一流出类,四类型)。 */
import { newId, nowIso } from '../schema'
import { findLine } from './budget'
import type { AuditEntry, OwnershipType, Payment, PaymentType, TripBlob } from './types'

export function findPayment(trip: TripBlob, paymentId: string): Payment | null {
  return trip.payments.find((p) => p.paymentId === paymentId) ?? null
}

/** 行已付合计(仅归属该行的支付) */
export function paidOfLine(trip: TripBlob, budgetLineId: string): number {
  let sum = 0
  for (const p of trip.payments) {
    if (p.ownershipType === 'line' && p.budgetLineId === budgetLineId) sum += p.amountCents
  }
  return sum
}

/** 已付总额(全部支付;待归位也计入现金) */
export function paidTotal(trip: TripBlob): number {
  let sum = 0
  for (const p of trip.payments) sum += p.amountCents
  return sum
}

/** 待归位支付(已付但归属未定) */
export function pendingPayments(trip: TripBlob): Payment[] {
  return trip.payments.filter((p) => p.attributionState === 'pending')
}

/** 预算外支付合计 */
export function outsideTotal(trip: TripBlob): number {
  let sum = 0
  for (const p of trip.payments) {
    if (p.ownershipType === 'outside') sum += p.amountCents
  }
  return sum
}

/** 归属定位快照(审计载荷) */
function attributionOf(p: Payment, trip: TripBlob): {
  ownershipType: OwnershipType
  budgetLineId?: string
  lineName?: string
  versionNo?: number
} {
  if (p.ownershipType === 'line') {
    const ref = findLine(trip, p.budgetLineId)
    return {
      ownershipType: 'line',
      budgetLineId: p.budgetLineId,
      lineName: ref?.line.name,
      versionNo: ref?.version.versionNo,
    }
  }
  return { ownershipType: p.ownershipType }
}

function pushAudit(trip: TripBlob, e: Omit<AuditEntry, 'id' | 'at'>): void {
  trip.auditLog.push({ id: newId(), at: nowIso(), ...e })
}

export interface RecordPaymentInput {
  type: PaymentType
  amountCents: number
  paymentDate: string
  method?: string
  note?: string
  ownershipType: OwnershipType
  budgetLineId?: string
}

/** 录入支付:实付金额;归属三选一;行归属即归属建立审计 */
export function recordPayment(
  trip: TripBlob,
  input: RecordPaymentInput,
): { ok: boolean; error?: string } {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: '金额必须是正整数分' }
  }
  if (!/^\d{4}-\d\d-\d\d$/.test(input.paymentDate)) {
    return { ok: false, error: '支付日期格式应为 YYYY-MM-DD' }
  }
  if (input.ownershipType === 'line' && !input.budgetLineId) {
    return { ok: false, error: '归属预算行时必须选择行' }
  }
  const pay: Payment = {
    paymentId: newId(),
    type: input.type,
    amountCents: input.amountCents,
    paymentDate: input.paymentDate,
    method: input.method,
    note: input.note,
    ownershipType: input.ownershipType,
    budgetLineId: input.ownershipType === 'line' ? input.budgetLineId : undefined,
    attributionState: input.ownershipType === 'none' ? 'pending' : 'settled',
  }
  trip.payments.push(pay)
  if (pay.ownershipType === 'line') {
    const ref = findLine(trip, pay.budgetLineId)
    pushAudit(trip, {
      type: '归属建立',
      paymentId: pay.paymentId,
      detail: `归属「${ref?.line.name ?? '?'}」(V${ref?.version.versionNo ?? '?'}),${input.amountCents} 分`,
      before: { ownershipType: 'none' },
      after: attributionOf(pay, trip),
    })
  } else if (pay.ownershipType === 'outside') {
    pushAudit(trip, {
      type: '归属建立',
      paymentId: pay.paymentId,
      detail: `预算外支出 ${input.amountCents} 分`,
      before: { ownershipType: 'none' },
      after: { ownershipType: 'outside' },
    })
  }
  return { ok: true }
}

/** 调整支付金额(审计:金额调整;多付在派生层重新检测) */
export function adjustPaymentAmount(
  trip: TripBlob,
  paymentId: string,
  newCents: number,
): { ok: boolean; error?: string } {
  const pay = findPayment(trip, paymentId)
  if (!pay) return { ok: false, error: '支付不存在' }
  if (!Number.isSafeInteger(newCents) || newCents <= 0) {
    return { ok: false, error: '金额必须是正整数分' }
  }
  if (newCents === pay.amountCents) return { ok: true }
  pushAudit(trip, {
    type: '金额调整',
    paymentId,
    detail: `金额 ${pay.amountCents} → ${newCents} 分`,
    beforeAmountCents: pay.amountCents,
    afterAmountCents: newCents,
  })
  pay.amountCents = newCents
  return { ok: true }
}

/** 调整支付日期(审计:日期调整) */
export function adjustPaymentDate(
  trip: TripBlob,
  paymentId: string,
  newDate: string,
): { ok: boolean; error?: string } {
  const pay = findPayment(trip, paymentId)
  if (!pay) return { ok: false, error: '支付不存在' }
  if (!/^\d{4}-\d\d-\d\d$/.test(newDate)) {
    return { ok: false, error: '日期格式应为 YYYY-MM-DD' }
  }
  if (newDate === pay.paymentDate) return { ok: true }
  pushAudit(trip, {
    type: '日期调整',
    paymentId,
    detail: `日期 ${pay.paymentDate} → ${newDate}`,
    beforeDate: pay.paymentDate,
    afterDate: newDate,
  })
  pay.paymentDate = newDate
  return { ok: true }
}

/** 调整支付类型(裁剪后单分类,类型调整自由但留痕) */
export function adjustPaymentType(
  trip: TripBlob,
  paymentId: string,
  newType: PaymentType,
): { ok: boolean; error?: string } {
  const pay = findPayment(trip, paymentId)
  if (!pay) return { ok: false, error: '支付不存在' }
  if (newType === pay.type) return { ok: true }
  pushAudit(trip, {
    type: '类型调整',
    paymentId,
    detail: `类型 ${pay.type} → ${newType}`,
    beforeType: pay.type,
    afterType: newType,
  })
  pay.type = newType
  return { ok: true }
}

export interface AttributionTarget {
  ownershipType: OwnershipType
  budgetLineId?: string
}

/** 设置归属:建立/变更/转移/待归位归位,审计按 before/after 分型 */
export function setAttribution(
  trip: TripBlob,
  paymentId: string,
  target: AttributionTarget,
): { ok: boolean; error?: string } {
  const pay = findPayment(trip, paymentId)
  if (!pay) return { ok: false, error: '支付不存在' }
  if (target.ownershipType === 'line' && !target.budgetLineId) {
    return { ok: false, error: '归属预算行时必须选择行' }
  }
  const before = attributionOf(pay, trip)
  const wasPending = pay.attributionState === 'pending'
  pay.budgetLineId = target.ownershipType === 'line' ? target.budgetLineId : undefined
  pay.ownershipType = target.ownershipType
  pay.attributionState = target.ownershipType === 'none' ? 'pending' : 'settled'
  const after = attributionOf(pay, trip)
  let type: AuditEntry['type']
  if (wasPending && target.ownershipType !== 'none') {
    type = '待处理归位'
  } else if (before.ownershipType === 'none' && target.ownershipType !== 'none') {
    type = '归属建立'
  } else if (
    before.ownershipType !== 'none' &&
    before.ownershipType !== 'outside' &&
    after.ownershipType === 'line' &&
    before.budgetLineId !== after.budgetLineId
  ) {
    type = '支付转移'
  } else {
    type = '归属变更'
  }
  pushAudit(trip, {
    type,
    paymentId,
    detail:
      `归属:${describeAttribution(before)} → ${describeAttribution(after)}`,
    before,
    after,
  })
  return { ok: true }
}

function describeAttribution(a: {
  ownershipType: OwnershipType
  lineName?: string
  versionNo?: number
}): string {
  if (a.ownershipType === 'line') return `行「${a.lineName ?? '?'}」V${a.versionNo ?? '?'}`
  if (a.ownershipType === 'outside') return '预算外'
  return '待归位'
}

/** 删除支付(显式操作;审计记一条删除说明,支付记录本身移除) */
export function deletePayment(trip: TripBlob, paymentId: string): { ok: boolean; error?: string } {
  const idx = trip.payments.findIndex((p) => p.paymentId === paymentId)
  if (idx < 0) return { ok: false, error: '支付不存在' }
  pushAudit(trip, {
    type: '归属变更',
    paymentId,
    detail: `删除支付记录(${findPayment(trip, paymentId)?.amountCents ?? 0} 分)`,
  })
  trip.payments.splice(idx, 1)
  return { ok: true }
}
