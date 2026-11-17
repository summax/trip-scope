/**
 * TripScope 业务领域类型(schema v3,data.trip)。
 *
 * 依据:docs/scope-cut-2026-11-17.md(五域裁剪:退款/押金退回/押金类型与转消费/返利/优惠
 * 整体移除;支付类型只剩流出类四种;附加费保留;报价=成人基准价+票档覆盖+附加费)。
 * 全部金额为整数分(≥0);日期为本地 YYYY-MM-DD 字符串;引用一律用稳定 id。
 */

/* ---------------- 旅行基础 ---------------- */

/** 票档:成人档 ratioPercent=100;其余档按比例计价(比例活规则) */
export interface FareTier {
  id: string
  name: string
  /** 占成人基准价的百分比(1~100) */
  ratioPercent: number
}

export interface Traveler {
  id: string
  name: string
  tierId: string
}

export interface TripInfo {
  startDate: string
  endDate: string
}

/* ---------------- 消费对象(对象级共享设置) ---------------- */

/** 交通区段:D-14 跨日交通归属出发日 */
export interface Leg {
  id: string
  title: string
  /** 出发日 YYYY-MM-DD */
  date: string
  /** 参与人 id 列表;空 = 全体旅行者 */
  participants?: string[]
}

/** 住宿单:半开区间 [checkIn, checkOut),晚数 = 日期差 */
export interface Stay {
  id: string
  title: string
  checkIn: string
  checkOut: string
  /** 参与人 id 列表;空 = 全体(仅当无房间分配时参与分摊) */
  participants?: string[]
  /** 分摊方式:按晚(默认)/整体记在入住日 */
  shareMode?: 'byNight' | 'whole'
}

/** 房间项:挂在住宿单下 */
export interface RoomItem {
  id: string
  stayId: string
  title: string
  /** 间数 */
  count: number
  /** 每间容纳人数 */
  capacity: number
}

/** 自由费用 */
export interface Expense {
  id: string
  title: string
  date: string
  amountCents: number
  note?: string
  /** 参与人 id 列表;空 = 全体 */
  participants?: string[]
}

/* ---------------- 候选 ---------------- */

/** 票档绝对额覆盖:该档不按比例,直接用此价 */
export interface TierOverride {
  tierId: string
  cents: number
}

export interface Surcharge {
  label: string
  cents: number
}

export type CandidateKind = 'traffic' | 'room' | 'package'

/**
 * 候选(三态统一持有,按 kind 区分):
 * - traffic:按人计价,adultCents=基准成人价,票档按比例/覆盖
 * - room:按间计价,adultCents=每间每晚
 * - package:整段一口价,totalCents
 */
export interface Candidate {
  id: string
  kind: CandidateKind
  /** 所属消费对象 id(交通=legId;房间=roomItemId;套餐=stayId) */
  subjectId: string
  label: string
  /** 交通:出发/到达时刻(自由文本,如 08:30) */
  depart?: string
  arrive?: string
  /** room:每间容纳人数(容量校验用) */
  capacity?: number
  /** traffic/room:基准价(成人/每间每晚),整数分 */
  adultCents: number
  /** package:一口价,整数分 */
  totalCents?: number
  /** 票档绝对额覆盖 */
  tierOverrides?: TierOverride[]
  /** 附加费(恒另计加价) */
  surcharges?: Surcharge[]
  /** 报价有效期(YYYY-MM-DD),过期 → 警告 */
  validUntil?: string
  /** 退改规则文本(信息性,无退款记录机制) */
  refundPolicyText?: string
  note?: string
}

/* ---------------- 组合与方案 ---------------- */

/** subjectId → candidateId */
export type SelectionMap = Record<string, string>
/** stayId → 'rooms' | 'package' */
export type StayModeMap = Record<string, 'rooms' | 'package'>

export interface Combination {
  selections: SelectionMap
  stayModes: StayModeMap
}

export interface Plan {
  id: string
  name: string
  archivedAt: string
  selections: SelectionMap
  stayModes: StayModeMap
  /** 存档时合计参照值(仅用于"候选已变化,差额 +X"提示,非真相) */
  archiveTotalCents: number
  /** 存档时逐候选金额参照(候选已变化的确定性锚) */
  archiveAmounts: Record<string, number>
}

/* ---------------- 预算 ---------------- */

export type BudgetSourceType = 'first' | 'refresh'
export type LineObjType = 'traffic' | 'stay' | 'expense' | 'manual'

export interface BudgetLine {
  budgetLineId: string
  /** 逻辑行 ID:跨版本识别同一业务项;手动行默认无对应(不继承) */
  logicalLineId?: string
  name: string
  amountCents: number
  objType: LineObjType
  /** 来源消费对象 id(刷新传播锚点);手动行无 */
  sourceObjectId?: string
  /** 来源候选 id(现价对比定位) */
  sourceCandidateRef?: string
  /** 分摊快照:参与人(空=全体) */
  participants?: string[]
  /** 手动行原因 */
  manualReason?: string
  createdAt: string
  updatedAt?: string
}

/** 刷新时点的组合选择状态最小快照(不记价格) */
export interface SourceSnapshot {
  snapshotAt: string
  selections: { subjectId: string; candidateId: string }[]
  stayModes: { stayId: string; mode: 'rooms' | 'package' }[]
}

export interface BudgetVersion {
  id: string
  versionNo: number
  createdAt: string
  sourceType: BudgetSourceType
  /** 首次确认的来源方案;刷新恒空(策略乙) */
  sourcePlanId?: string
  sourceSnapshot?: SourceSnapshot
  lines: BudgetLine[]
}

/* ---------------- 支付(实付记账) ---------------- */

export type PaymentType = 'prepay' | 'final' | 'full' | 'other'
export type OwnershipType = 'line' | 'outside' | 'none'
export type AttributionState = 'settled' | 'pending'

export interface Payment {
  paymentId: string
  type: PaymentType
  /** 实付金额(正,整数分)——填入即最终实际金额 */
  amountCents: number
  /** YYYY-MM-DD */
  paymentDate: string
  method?: string
  note?: string
  /** 归属:预算行 / 预算外 / 无(待归位) */
  ownershipType: OwnershipType
  /** 仅归属=预算行时非空;行被清理后保留为悬空历史引用 */
  budgetLineId?: string
  attributionState: AttributionState
  /** 版本清理时附着的行级快照(时点事实,追加不覆盖) */
  cleanups?: {
    versionNo: number
    lineName: string
    lineAmountCents: number
    paymentAmountCents: number
    at: string
  }[]
}

/* ---------------- 审计(追加式,永不删除) ---------------- */

export type AuditType =
  | '归属建立'
  | '归属变更'
  | '支付转移'
  | '待处理归位'
  | '金额调整'
  | '日期调整'
  | '类型调整'
  | '版本清理'

export interface AuditAttributionSnapshot {
  ownershipType: OwnershipType
  budgetLineId?: string
  lineName?: string
  versionNo?: number
}

export interface AuditEntry {
  id: string
  at: string
  type: AuditType
  paymentId?: string
  /** 人读摘要(冗余行名/版本,行清理后仍可读) */
  detail: string
  before?: AuditAttributionSnapshot
  after?: AuditAttributionSnapshot
  beforeAmountCents?: number
  afterAmountCents?: number
  beforeDate?: string
  afterDate?: string
  beforeType?: PaymentType
  afterType?: PaymentType
}

/* ---------------- 旅行数据根(schema v3 data.trip) ---------------- */

export interface TripBlob {
  info: TripInfo
  tiers: FareTier[]
  travelers: Traveler[]
  legs: Leg[]
  stays: Stay[]
  roomItems: RoomItem[]
  expenses: Expense[]
  candidates: Candidate[]
  assignments: Record<string, Record<string, string[]>>
  combination: Combination
  plans: Plan[]
  budgets: BudgetVersion[]
  payments: Payment[]
  auditLog: AuditEntry[]
}

/** 业务数据缺省(ensureTrip 用) */
export function defaultTrip(): TripBlob {
  return {
    info: { startDate: '', endDate: '' },
    tiers: [
      { id: 'tier-adult', name: '成人', ratioPercent: 100 },
      { id: 'tier-child', name: '儿童', ratioPercent: 50 },
    ],
    travelers: [],
    legs: [],
    stays: [],
    roomItems: [],
    expenses: [],
    candidates: [],
    assignments: {},
    combination: { selections: {}, stayModes: {} },
    plans: [],
    budgets: [],
    payments: [],
    auditLog: [],
  }
}

/** 兼容缺失字段的浅规范化(老 v3 文件/部分字段缺失时兜底,不深改) */
export function normalizeTrip(t: Partial<TripBlob> | undefined): TripBlob {
  const d = defaultTrip()
  if (!t || typeof t !== 'object') return d
  return {
    info: { startDate: t.info?.startDate ?? '', endDate: t.info?.endDate ?? '' },
    tiers: Array.isArray(t.tiers) && t.tiers.length > 0 ? t.tiers : d.tiers,
    travelers: t.travelers ?? [],
    legs: t.legs ?? [],
    stays: t.stays ?? [],
    roomItems: t.roomItems ?? [],
    expenses: t.expenses ?? [],
    candidates: t.candidates ?? [],
    assignments: t.assignments ?? {},
    combination: {
      selections: t.combination?.selections ?? {},
      stayModes: t.combination?.stayModes ?? {},
    },
    plans: t.plans ?? [],
    budgets: t.budgets ?? [],
    payments: t.payments ?? [],
    auditLog: t.auditLog ?? [],
  }
}
