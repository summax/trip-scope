import { describe, expect, test } from 'vitest'
import {
  nightsBetween,
  addDays,
  tierPrice,
  candidateAmount,
  combinationTotal,
  resolveSelections,
  planPriceContext,
  expiredCandidateIds,
  capacityIssues,
} from '../../src/core/domain/pricing'
import { defaultTrip, type Candidate, type TripBlob } from '../../src/core/domain/types'

function tripWithBase(): TripBlob {
  const t = defaultTrip()
  t.travelers = [
    { id: 'p1', name: '成人甲', tierId: 'tier-adult' },
    { id: 'p2', name: '儿童乙', tierId: 'tier-child' },
  ]
  t.legs = [{ id: 'leg1', title: 'A→B', date: '2027-10-01' }]
  t.stays = [{ id: 'stay1', title: '客栈', checkIn: '2027-10-01', checkOut: '2027-10-04' }]
  t.roomItems = [{ id: 'room1', stayId: 'stay1', title: '标间', count: 2, capacity: 3 }]
  t.expenses = [{ id: 'exp1', title: '索道', date: '2027-10-02', amountCents: 20000 }]
  t.candidates = [
    {
      id: 'cTraffic',
      kind: 'traffic',
      subjectId: 'leg1',
      label: 'G1',
      adultCents: 34000,
      surcharges: [{ label: '保险', cents: 500 }],
    },
    { id: 'cRoom', kind: 'room', subjectId: 'room1', label: '标间价', adultCents: 28000 },
    { id: 'cPkg', kind: 'package', subjectId: 'stay1', label: '套餐', adultCents: 0, totalCents: 96000 },
  ]
  return t
}

describe('日期', () => {
  test('nightsBetween 半开区间与非法输入', () => {
    expect(nightsBetween('2027-10-01', '2027-10-04')).toBe(3)
    expect(nightsBetween('2027-10-01', '2027-10-01')).toBe(0)
    expect(nightsBetween('2027-10-04', '2027-10-01')).toBe(0)
    expect(nightsBetween('', '2027-10-04')).toBe(0)
  })
  test('addDays', () => {
    expect(addDays('2027-10-01', 3)).toBe('2027-10-04')
    expect(addDays('bad', 1)).toBeNull()
  })
})

describe('票价与候选金额', () => {
  test('tierPrice:比例 / 覆盖 / 未知档', () => {
    const t = tripWithBase()
    const c = t.candidates[0]
    expect(tierPrice(c, t.tiers, 'tier-adult')).toBe(34000)
    expect(tierPrice(c, t.tiers, 'tier-child')).toBe(17000)
    c.tierOverrides = [{ tierId: 'tier-child', cents: 12000 }]
    expect(tierPrice(c, t.tiers, 'tier-child')).toBe(12000)
    expect(tierPrice(c, t.tiers, 'nope')).toBeNull()
  })

  test('traffic 按档人数计价 + 附加费;room 按间晚;package 一口价', () => {
    const t = tripWithBase()
    expect(candidateAmount(t.candidates[0], t)).toBe(51000 + 500)
    expect(candidateAmount(t.candidates[1], t)).toBe(28000 * 3 * 2)
    expect(candidateAmount(t.candidates[2], t)).toBe(96000)
  })

  test('resolveSelections 悬空检测', () => {
    const t = tripWithBase()
    const r = resolveSelections(t, { leg1: 'cTraffic', room1: 'missing' })
    expect(r.ok.length).toBe(1)
    expect(r.dangling).toEqual([{ subjectId: 'room1', candidateId: 'missing' }])
  })

  test('combinationTotal 求和', () => {
    const t = tripWithBase()
    const total = combinationTotal(t, { leg1: 'cTraffic', room1: 'cRoom' })
    expect(total).toBe(51500 + 168000)
  })

  test('planPriceContext 候选变化与差额', () => {
    const t = tripWithBase()
    const plan = {
      selections: { leg1: 'cTraffic' },
      archiveTotalCents: 51000,
      archiveAmounts: { cTraffic: 51000 },
    }
    const before = planPriceContext(t, plan)
    expect(before.diffCents).toBe(500)
    expect(before.changedCandidateIds).toEqual(['cTraffic'])
    t.candidates[0].adultCents = 35000
    const after = planPriceContext(t, plan)
    expect(after.changedCandidateIds).toEqual(['cTraffic'])
    expect(after.total).toBe(35000 + 17500 + 500)
  })
})

describe('候选层警告', () => {
  test('报价过期判定', () => {
    const t = tripWithBase()
    t.candidates[0].validUntil = '2027-01-01'
    expect(expiredCandidateIds(t, '2027-06-01')).toEqual(['cTraffic'])
    expect(expiredCandidateIds(t, '2026-12-31')).toEqual([])
  })
  test('容量不足', () => {
    const t = tripWithBase()
    t.assignments = { stay1: { room1: ['p1', 'p2'] } }
    t.roomItems[0].count = 0
    t.roomItems[0].capacity = 1
    const issues = capacityIssues(t)
    expect(issues.length).toBe(1)
    expect(issues[0].assigned).toBe(2)
    expect(issues[0].seats).toBe(0)
  })
})
