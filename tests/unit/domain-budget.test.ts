import { describe, expect, test } from 'vitest'
import {
  confirmBudget,
  refreshBudget,
  currentBudget,
  currentVersionNo,
  canCleanupVersion,
  cleanupVersion,
  compareVersions,
  overpaidLines,
  findLine,
} from '../../src/core/domain/budget'
import { defaultTrip, type Plan, type TripBlob } from '../../src/core/domain/types'

function makeTrip(): TripBlob {
  const t = defaultTrip()
  t.info = { startDate: '2027-10-01', endDate: '2027-10-04' }
  t.travelers = [{ id: 'p1', name: '甲', tierId: 'tier-adult' }]
  t.legs = [{ id: 'leg1', title: 'A→B', date: '2027-10-01' }]
  t.stays = [{ id: 'stay1', title: '客栈', checkIn: '2027-10-01', checkOut: '2027-10-04' }]
  t.roomItems = [{ id: 'room1', stayId: 'stay1', title: '标间', count: 1, capacity: 2 }]
  t.expenses = [{ id: 'exp1', title: '索道', date: '2027-10-02', amountCents: 20000 }]
  t.candidates = [
    { id: 'cT', kind: 'traffic', subjectId: 'leg1', label: 'G1', adultCents: 34000 },
    { id: 'cR', kind: 'room', subjectId: 'room1', label: '标间价', adultCents: 28000 },
  ]
  t.combination = { selections: { leg1: 'cT', room1: 'cR' }, stayModes: { stay1: 'rooms' } }
  return t
}

function makePlan(t: TripBlob, id = 'plan1'): Plan {
  return {
    id,
    name: '方案',
    archivedAt: '2026-11-17T00:00:00.000Z',
    selections: { ...t.combination.selections },
    stayModes: { ...t.combination.stayModes },
    archiveTotalCents: 34000 + 84000 + 20000,
    archiveAmounts: { cT: 34000, cR: 84000 },
  }
}

describe('确认与刷新', () => {
  test('confirmBudget 从方案生成 V1:三行、逻辑 ID、来源块', () => {
    const t = makeTrip()
    t.plans = [makePlan(t)]
    expect(confirmBudget(t, 'plan1')).toEqual({ ok: true })
    expect(confirmBudget(t, 'plan1').ok).toBe(false) // 已有预算
    const v1 = currentBudget(t)!
    expect(v1.versionNo).toBe(1)
    expect(v1.sourceType).toBe('first')
    expect(v1.sourcePlanId).toBe('plan1')
    expect(v1.lines.length).toBe(3) // 交通 + 房间 + 费用
    expect(v1.lines.every((l) => !!l.logicalLineId)).toBe(true)
    const amounts = v1.lines.map((l) => l.amountCents).sort((a, b) => a - b)
    expect(amounts).toEqual([20000, 34000, 84000])
  })

  test('refreshBudget 策略乙:继承 logicalLineId、来源快照必生成、sourcePlanId 恒空', () => {
    const t = makeTrip()
    t.plans = [makePlan(t)]
    confirmBudget(t, 'plan1')
    const v1 = currentBudget(t)!
    const idsBefore = new Map(v1.lines.map((l) => [l.sourceObjectId, l.logicalLineId]))
    // 候选改价后刷新:行金额按现价
    t.candidates[0].adultCents = 35000
    t.candidates[1].adultCents = 30000
    expect(refreshBudget(t)).toEqual({ ok: true })
    const v2 = currentBudget(t)!
    expect(v2.versionNo).toBe(2)
    expect(v2.sourceType).toBe('refresh')
    expect(v2.sourcePlanId).toBeUndefined()
    expect(v2.sourceSnapshot).toBeTruthy()
    expect(v2.sourceSnapshot!.selections.length).toBe(2)
    expect(v2.sourceSnapshot!.stayModes.length).toBe(1)
    // 逻辑行传播
    for (const l of v2.lines) {
      if (l.sourceObjectId && l.objType !== 'expense') {
        expect(l.logicalLineId).toBe(idsBefore.get(l.sourceObjectId))
      }
    }
    const trafficLine = v2.lines.find((l) => l.sourceObjectId === 'leg1')!
    expect(trafficLine.amountCents).toBe(35000)
  })

  test('refresh 情况 B:支付挂靠的逻辑项消失 → 转待归位 + 审计', () => {
    const t = makeTrip()
    t.plans = [makePlan(t)]
    confirmBudget(t, 'plan1')
    const v1 = currentBudget(t)!
    const line = v1.lines.find((l) => l.sourceObjectId === 'leg1')!
    t.payments.push({
      paymentId: 'pay1',
      type: 'full',
      amountCents: 10000,
      paymentDate: '2026-11-17',
      ownershipType: 'line',
      budgetLineId: line.budgetLineId,
      attributionState: 'settled',
    })
    // 组合中取消交通选择后刷新 → 交通行不再包含
    delete t.combination.selections.leg1
    refreshBudget(t)
    expect(t.payments[0].attributionState).toBe('pending')
    expect(t.auditLog.some((a) => a.type === '待处理归位' && a.paymentId === 'pay1')).toBe(true)
  })

  test('手动行不随刷新继承', () => {
    const t = makeTrip()
    t.plans = [makePlan(t)]
    confirmBudget(t, 'plan1')
    const v1 = currentBudget(t)!
    v1.lines.push({
      budgetLineId: 'm1',
      logicalLineId: 'ml1',
      name: '手动',
      amountCents: 5000,
      objType: 'manual',
      createdAt: 'x',
    })
    refreshBudget(t)
    const v2 = currentBudget(t)!
    expect(v2.lines.some((l) => l.objType === 'manual')).toBe(false)
  })
})

describe('清理与对比', () => {
  test('清理守卫:当前与上一版不可清理;清理后支付附行级快照且审计', () => {
    const t = makeTrip()
    t.plans = [makePlan(t)]
    confirmBudget(t, 'plan1')
    refreshBudget(t) // V2
    refreshBudget(t) // V3
    expect(currentVersionNo(t)).toBe(3)
    expect(canCleanupVersion(t, 3)).toBe(false)
    expect(canCleanupVersion(t, 2)).toBe(false)
    expect(canCleanupVersion(t, 1)).toBe(true)
    const v1line = t.budgets.find((v) => v.versionNo === 1)!.lines[0]
    t.payments.push({
      paymentId: 'pay1',
      type: 'full',
      amountCents: 999,
      paymentDate: '2026-11-17',
      ownershipType: 'line',
      budgetLineId: v1line.budgetLineId,
      attributionState: 'settled',
    })
    expect(cleanupVersion(t, 1)).toEqual({ ok: true })
    expect(t.budgets.some((v) => v.versionNo === 1)).toBe(false)
    expect(t.payments[0].cleanups?.[0]).toMatchObject({
      versionNo: 1,
      lineName: v1line.name,
      lineAmountCents: v1line.amountCents,
      paymentAmountCents: 999,
    })
    expect(t.auditLog.some((a) => a.type === '版本清理')).toBe(true)
  })

  test('compareVersions 改额/新增/不再包含/同额', () => {
    const t = makeTrip()
    t.plans = [makePlan(t)]
    confirmBudget(t, 'plan1')
    t.candidates[0].adultCents = 35000
    delete t.combination.selections.room1
    t.expenses.push({ id: 'exp2', title: '新费用', date: '2027-10-03', amountCents: 100 })
    refreshBudget(t)
    const cmp = compareVersions(t, 1, 2)
    const statuses = cmp.rows.map((r) => r.status).sort()
    expect(statuses).toContain('changed') // 交通改额
    expect(statuses).toContain('removed') // 房间不再包含
    expect(statuses).toContain('added') // 新费用
    expect(cmp.rows.length).toBe(4)
    expect(cmp.totalA).toBe(34000 + 84000 + 20000)
    expect(cmp.totalB).toBe(35000 + 20000 + 100)
  })

  test('overpaidLines 行级多付', () => {
    const t = makeTrip()
    t.plans = [makePlan(t)]
    confirmBudget(t, 'plan1')
    const line = currentBudget(t)!.lines.find((l) => l.sourceObjectId === 'exp1')!
    t.payments.push(
      { paymentId: 'a', type: 'full', amountCents: 15000, paymentDate: 'x', ownershipType: 'line', budgetLineId: line.budgetLineId, attributionState: 'settled' },
      { paymentId: 'b', type: 'other', amountCents: 6000, paymentDate: 'x', ownershipType: 'line', budgetLineId: line.budgetLineId, attributionState: 'settled' },
    )
    const over = overpaidLines(t)
    expect(over.length).toBe(1)
    expect(over[0].paid).toBe(21000)
    expect(findLine(t, line.budgetLineId)?.version.versionNo).toBe(1)
  })
})
