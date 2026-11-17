import { describe, expect, test } from 'vitest'
import { splitEven, allocateTrip, tripSummary } from '../../src/core/domain/alloc'
import { confirmBudget } from '../../src/core/domain/budget'
import { defaultTrip, type Plan, type TripBlob } from '../../src/core/domain/types'

function makeTrip(): TripBlob {
  const t = defaultTrip()
  t.info = { startDate: '2027-10-01', endDate: '2027-10-04' }
  t.travelers = [
    { id: 'p1', name: '甲', tierId: 'tier-adult' },
    { id: 'p2', name: '乙', tierId: 'tier-adult' },
    { id: 'p3', name: '丙', tierId: 'tier-adult' },
  ]
  t.legs = [{ id: 'leg1', title: 'A→B', date: '2027-10-01' }]
  t.stays = [{ id: 'stay1', title: '客栈', checkIn: '2027-10-01', checkOut: '2027-10-04' }]
  t.roomItems = [{ id: 'room1', stayId: 'stay1', title: '标间', count: 1, capacity: 3 }]
  t.candidates = [
    { id: 'cT', kind: 'traffic', subjectId: 'leg1', label: 'G1', adultCents: 30000 },
    { id: 'cR', kind: 'room', subjectId: 'room1', label: '标间价', adultCents: 28000 },
  ]
  return t
}

function makePlan(t: TripBlob): Plan {
  return {
    id: 'plan1',
    name: '方案',
    archivedAt: 'x',
    selections: { leg1: 'cT', room1: 'cR' },
    stayModes: { stay1: 'rooms' },
    archiveTotalCents: 0,
    archiveAmounts: {},
  }
}

describe('splitEven 最大余数法', () => {
  test('整除与余数分配', () => {
    expect(splitEven(100, 4)).toEqual([25, 25, 25, 25])
    expect(splitEven(100, 3)).toEqual([34, 33, 33])
    expect(splitEven(0, 2)).toEqual([0, 0])
    expect(splitEven(100, 0)).toEqual([])
  })
})

describe('分摊', () => {
  test('交通行按参与人均分(空参与人=全体)', () => {
    const t = makeTrip()
    t.plans = [makePlan(t)]
    confirmBudget(t, 'plan1')
    const { rows } = allocateTrip(t)
    const trafficRows = rows.filter((r) => r.line.sourceObjectId === 'leg1')
    expect(trafficRows.length).toBe(3)
    expect(trafficRows.reduce((a, r) => a + r.cents, 0)).toBe(90000) // 3 成人 × 30000
    expect(trafficRows.every((r) => r.date === '2027-10-01')).toBe(true)
  })

  test('住宿按晚分摊给当晚占用者;未分配者不参与', () => {
    const t = makeTrip()
    t.plans = [makePlan(t)]
    confirmBudget(t, 'plan1')
    t.assignments = { stay1: { room1: ['p1'] } }
    const { rows } = allocateTrip(t)
    const stayRows = rows.filter((r) => r.line.sourceObjectId === 'room1')
    // 3 晚 × 28000(1 间) = 84000,全部归 p1
    expect(stayRows.length).toBe(3)
    expect(stayRows.every((r) => r.travelerId === 'p1')).toBe(true)
    expect(stayRows.reduce((a, r) => a + r.cents, 0)).toBe(84000)
    const dates = stayRows.map((r) => r.date).sort()
    expect(dates).toEqual(['2027-10-01', '2027-10-02', '2027-10-03'])
  })

  test('范围外金额进 R 不摊', () => {
    const t = makeTrip()
    t.info.endDate = '2027-10-02'
    t.legs[0].date = '2027-10-10'
    t.plans = [makePlan(t)]
    confirmBudget(t, 'plan1')
    const { rows, outOfRange } = allocateTrip(t)
    expect(rows.some((r) => r.line.sourceObjectId === 'leg1')).toBe(false)
    // 交通 90000 在范围外 + 住宿第 3 晚(10-03,超出 endDate=10-02)的 28000
    expect(outOfRange.length).toBe(2)
    expect(outOfRange.reduce((a, r) => a + r.cents, 0)).toBe(90000 + 28000)
  })
})

describe('tripSummary', () => {
  test('预算/已付/差额/按人/按类', () => {
    const t = makeTrip()
    t.plans = [makePlan(t)]
    confirmBudget(t, 'plan1')
    t.assignments = { stay1: { room1: ['p1', 'p2'] } }
    const trafficLine = t.budgets[0].lines.find((l) => l.sourceObjectId === 'leg1')!
    const stayLine = t.budgets[0].lines.find((l) => l.sourceObjectId === 'room1')!
    t.payments = [
      { paymentId: 'a', type: 'full', amountCents: 30000, paymentDate: '2027-10-01', ownershipType: 'line', budgetLineId: trafficLine.budgetLineId, attributionState: 'settled' },
      { paymentId: 'b', type: 'other', amountCents: 999, paymentDate: '2027-10-01', ownershipType: 'none', attributionState: 'pending' },
    ]
    const s = tripSummary(t)
    expect(s.budgetTotal).toBe(90000 + 84000)
    expect(s.paidTotal).toBe(30999)
    expect(s.pendingTotal).toBe(999)
    expect(s.diff).toBe(174000 - 30999)
    const p1 = s.perPerson.find((p) => p.travelerId === 'p1')!
    const p3 = s.perPerson.find((p) => p.travelerId === 'p3')!
    expect(p1.budget).toBe(30000 + 42000) // 交通 1/3 + 住宿每晚一半
    expect(p3.budget).toBe(30000) // 无住宿分配
    expect(s.perPerson.reduce((a, p) => a + p.budget, 0)).toBe(174000)
    expect(p1.paidShare + p3.paidShare + s.perPerson.find((p) => p.travelerId === 'p2')!.paidShare).toBe(30000)
    const cat = s.perCategory.find((c) => c.objType === 'traffic')!
    expect(cat.budget).toBe(90000)
    expect(cat.paid).toBe(30000)
    expect(s.outOfRangeTotal).toBe(0)
    void stayLine
  })
})
