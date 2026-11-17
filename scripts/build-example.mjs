import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * 从构建产物生成示例旅行 HTML。
 * 注意:节点读写逻辑与 src/core/schema.ts 保持一致(严格边界、`<` 转义)。
 */

// 与 src/core/schema.ts 的数据节点正则(NODE_RE_LOOSE)保持同构:分组 1=开标签,2=数据
const RE = /(<script id="app-data" type="application[/]json">)([\s\S]*?)<\/script>/g

const html = readFileSync(new URL('../dist/trip-scope.html', import.meta.url), 'utf8')

// schemaVersion 单一真相:从 schema.ts 源码解析,硬编码会在下次版本 bump 时暗炸 e2e
const schemaSrc = readFileSync(new URL('../src/core/schema.ts', import.meta.url), 'utf8')
const svMatch = schemaSrc.match(/SUPPORTED_SCHEMA_VERSION = (\d+)/)
if (!svMatch) throw new Error('无法从 schema.ts 解析 SUPPORTED_SCHEMA_VERSION')
const CURRENT_SCHEMA_VERSION = Number(svMatch[1])

const matches = [...html.matchAll(RE)]
if (matches.length !== 1) {
  throw new Error(`数据节点命中数必须为 1,实际 ${matches.length},产物结构异常`)
}

const node = {
  format: 'tripscope',
  schemaVersion: CURRENT_SCHEMA_VERSION,
  project: {
    id: '8f7c2b1a-3d4e-4f5a-9b8c-1a2b3c4d5e6f',
    name: '示例:2027 国庆云南旅行',
  },
  updatedAt: new Date().toISOString(),
  appVersion: '示例',
  data: {
    trip: {
      info: { startDate: '2027-10-01', endDate: '2027-10-04' },
      tiers: [
        { id: 'tier-adult', name: '成人', ratioPercent: 100 },
        { id: 'tier-child', name: '儿童', ratioPercent: 50 },
      ],
      travelers: [
        { id: 'trav-1', name: '爸爸', tierId: 'tier-adult' },
        { id: 'trav-2', name: '孩子', tierId: 'tier-child' },
      ],
      legs: [{ id: 'leg-1', title: '昆明 → 大理 高铁', date: '2027-10-01' }],
      stays: [
        { id: 'stay-1', title: '大理古城客栈', checkIn: '2027-10-01', checkOut: '2027-10-04' },
      ],
      roomItems: [{ id: 'room-1', stayId: 'stay-1', title: '标准间', count: 1, capacity: 3 }],
      expenses: [
        {
          id: 'expense-1',
          title: '苍山索道票',
          date: '2027-10-02',
          amountCents: 20000,
          note: '特殊字符验证:</script> 🎉 "引号" 「方括号」',
        },
      ],
      candidates: [
        {
          id: 'cand-g1421',
          kind: 'traffic',
          subjectId: 'leg-1',
          label: 'G1421 二等座',
          depart: '08:30',
          arrive: '11:26',
          adultCents: 34000,
          refundPolicyText: '开车前 15 日以上可免费退',
        },
        {
          id: 'cand-g1423',
          kind: 'traffic',
          subjectId: 'leg-1',
          label: 'G1423 二等座',
          depart: '10:05',
          arrive: '13:02',
          adultCents: 38000,
        },
        {
          id: 'cand-std',
          kind: 'room',
          subjectId: 'room-1',
          label: '标准间',
          adultCents: 28000,
        },
        {
          id: 'cand-family',
          kind: 'room',
          subjectId: 'room-1',
          label: '家庭房',
          adultCents: 36000,
        },
        {
          id: 'cand-pkg',
          kind: 'package',
          subjectId: 'stay-1',
          label: '含早套餐',
          totalCents: 96000,
        },
      ],
      assignments: { 'stay-1': { 'room-1': ['trav-1', 'trav-2'] } },
      combination: {
        selections: { 'leg-1': 'cand-g1421', 'room-1': 'cand-std', 'stay-1': 'cand-pkg' },
        stayModes: { 'stay-1': 'rooms' },
      },
      plans: [
        {
          id: 'plan-1',
          name: '高铁方案',
          archivedAt: '2026-11-17T08:00:00.000Z',
          selections: { 'leg-1': 'cand-g1421', 'room-1': 'cand-std', 'stay-1': 'cand-pkg' },
          stayModes: { 'stay-1': 'rooms' },
          archiveTotalCents: 155000,
          archiveAmounts: { 'cand-g1421': 51000, 'cand-std': 84000, 'cand-pkg': 96000 },
        },
        {
          id: 'plan-2',
          name: '家庭房方案',
          archivedAt: '2026-11-17T08:05:00.000Z',
          selections: { 'leg-1': 'cand-g1421', 'room-1': 'cand-family', 'stay-1': 'cand-pkg' },
          stayModes: { 'stay-1': 'rooms' },
          archiveTotalCents: 167000,
          archiveAmounts: { 'cand-g1421': 51000, 'cand-family': 108000, 'cand-pkg': 96000 },
        },
      ],
      budgets: [
        {
          id: 'budget-1',
          versionNo: 1,
          createdAt: '2026-11-17T08:10:00.000Z',
          sourceType: 'first',
          sourcePlanId: 'plan-1',
          lines: [
            {
              budgetLineId: 'line-1',
              logicalLineId: 'll-1',
              name: '昆明 → 大理 高铁 · G1421 二等座',
              amountCents: 51000,
              objType: 'traffic',
              sourceObjectId: 'leg-1',
              sourceCandidateRef: 'cand-g1421',
              createdAt: '2026-11-17T08:10:00.000Z',
            },
            {
              budgetLineId: 'line-2',
              logicalLineId: 'll-2',
              name: '大理古城客栈 · 标准间',
              amountCents: 84000,
              objType: 'stay',
              sourceObjectId: 'room-1',
              sourceCandidateRef: 'cand-std',
              createdAt: '2026-11-17T08:10:00.000Z',
            },
            {
              budgetLineId: 'line-3',
              logicalLineId: 'll-3',
              name: '苍山索道票',
              amountCents: 20000,
              objType: 'expense',
              sourceObjectId: 'expense-1',
              createdAt: '2026-11-17T08:10:00.000Z',
            },
          ],
        },
      ],
      payments: [
        {
          paymentId: 'pay-1',
          type: 'prepay',
          amountCents: 20000,
          paymentDate: '2026-11-17',
          method: '微信',
          note: '高铁票预付',
          ownershipType: 'line',
          budgetLineId: 'line-1',
          attributionState: 'settled',
        },
        {
          paymentId: 'pay-2',
          type: 'other',
          amountCents: 800,
          paymentDate: '2026-11-17',
          method: '现金',
          note: '路上买水',
          ownershipType: 'outside',
          attributionState: 'settled',
        },
      ],
      auditLog: [],
    },
  },
}

const json = JSON.stringify(node, null, 2).replace(/</g, '\\u003c')
// 仅替换分组 1(开标签)之后的内容,保留开标签原文
const out = html.replace(RE, (_m, open) => open + json + '</script>')

mkdirSync(new URL('../examples/', import.meta.url), { recursive: true })
writeFileSync(new URL('../examples/示例旅行.html', import.meta.url), out, 'utf8')
console.log('[example] examples/示例旅行.html 已生成')
