import { describe, expect, test } from 'vitest'
import {
  recordPayment,
  adjustPaymentAmount,
  adjustPaymentDate,
  adjustPaymentType,
  setAttribution,
  deletePayment,
  paidOfLine,
  paidTotal,
  outsideTotal,
  pendingPayments,
} from '../../src/core/domain/payments'
import { confirmBudget } from '../../src/core/domain/budget'
import { defaultTrip, type Plan, type TripBlob } from '../../src/core/domain/types'

function makeTripWithBudget(): TripBlob {
  const t = defaultTrip()
  t.legs = [{ id: 'leg1', title: 'A→B', date: '2027-10-01' }]
  t.candidates = [{ id: 'cT', kind: 'traffic', subjectId: 'leg1', label: 'G1', adultCents: 34000 }]
  t.travelers = [{ id: 'p1', name: '甲', tierId: 'tier-adult' }]
  t.combination = { selections: { leg1: 'cT' }, stayModes: {} }
  const plan: Plan = {
    id: 'plan1',
    name: '方案',
    archivedAt: 'x',
    selections: { leg1: 'cT' },
    stayModes: {},
    archiveTotalCents: 34000,
    archiveAmounts: { cT: 34000 },
  }
  t.plans = [plan]
  confirmBudget(t, 'plan1')
  return t
}

describe('录入与校验', () => {
  test('非法输入拒绝', () => {
    const t = makeTripWithBudget()
    expect(recordPayment(t, { type: 'full', amountCents: 0, paymentDate: '2027-10-01', ownershipType: 'none' }).ok).toBe(false)
    expect(recordPayment(t, { type: 'full', amountCents: 1.5, paymentDate: '2027-10-01', ownershipType: 'none' }).ok).toBe(false)
    expect(recordPayment(t, { type: 'full', amountCents: 100, paymentDate: 'bad', ownershipType: 'none' }).ok).toBe(false)
    expect(recordPayment(t, { type: 'full', amountCents: 100, paymentDate: '2027-10-01', ownershipType: 'line' }).ok).toBe(false)
  })

  test('录入归属行 → 归属建立审计;待归位计入已付', () => {
    const t = makeTripWithBudget()
    const line = t.budgets[0].lines[0]
    expect(
      recordPayment(t, {
        type: 'prepay',
        amountCents: 10000,
        paymentDate: '2027-10-01',
        ownershipType: 'line',
        budgetLineId: line.budgetLineId,
      }),
    ).toEqual({ ok: true })
    expect(t.auditLog[0].type).toBe('归属建立')
    expect(paidOfLine(t, line.budgetLineId)).toBe(10000)
    recordPayment(t, { type: 'other', amountCents: 500, paymentDate: '2027-10-01', ownershipType: 'none' })
    expect(paidTotal(t)).toBe(10500)
    expect(pendingPayments(t).length).toBe(1)
    recordPayment(t, { type: 'other', amountCents: 800, paymentDate: '2027-10-01', ownershipType: 'outside' })
    expect(outsideTotal(t)).toBe(800)
  })
})

describe('调整与归属操作(全部留痕)', () => {
  test('金额/日期/类型调整生成对应审计', () => {
    const t = makeTripWithBudget()
    recordPayment(t, { type: 'full', amountCents: 1000, paymentDate: '2027-10-01', ownershipType: 'none' })
    const id = t.payments[0].paymentId
    adjustPaymentAmount(t, id, 1200)
    adjustPaymentDate(t, id, '2027-10-02')
    adjustPaymentType(t, id, 'final')
    expect(t.payments[0].amountCents).toBe(1200)
    expect(t.payments[0].paymentDate).toBe('2027-10-02')
    expect(t.payments[0].type).toBe('final')
    const types = t.auditLog.map((a) => a.type)
    expect(types).toContain('金额调整')
    expect(types).toContain('日期调整')
    expect(types).toContain('类型调整')
    const amt = t.auditLog.find((a) => a.type === '金额调整')!
    expect(amt.beforeAmountCents).toBe(1000)
    expect(amt.afterAmountCents).toBe(1200)
  })

  test('归属变更分型:建立 / 转移 / 待归位归位 / 变更', () => {
    const t = makeTripWithBudget()
    const line = t.budgets[0].lines[0]
    recordPayment(t, { type: 'full', amountCents: 1000, paymentDate: '2027-10-01', ownershipType: 'none' })
    const id = t.payments[0].paymentId
    setAttribution(t, id, { ownershipType: 'line', budgetLineId: line.budgetLineId })
    expect(t.auditLog[t.auditLog.length - 1].type).toBe('待处理归位')
    setAttribution(t, id, { ownershipType: 'outside' })
    expect(t.auditLog[t.auditLog.length - 1].type).toBe('归属变更')
    setAttribution(t, id, { ownershipType: 'none' })
    expect(t.payments[0].attributionState).toBe('pending')
  })

  test('删除支付:记录移除且留删除审计', () => {
    const t = makeTripWithBudget()
    recordPayment(t, { type: 'full', amountCents: 1000, paymentDate: '2027-10-01', ownershipType: 'none' })
    const id = t.payments[0].paymentId
    expect(deletePayment(t, id)).toEqual({ ok: true })
    expect(t.payments.length).toBe(0)
    expect(t.auditLog.some((a) => a.paymentId === id && a.detail.includes('删除'))).toBe(true)
  })
})
