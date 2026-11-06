import { SUPPORTED_SCHEMA_VERSION, normalizeRev, type TripNode } from './schema'

/**
 * schemaVersion → schemaVersion+1 的类型化迁移链。
 *
 * 契约:
 * - run 为纯函数,产出新对象,不复用/修改输入(准入持有的原始节点不可被污染)
 * - 只窄校验本步触碰的字段,其余字段 spread 保真(准入宽容哲学,迁移不新增拒绝面)
 * - 版本号由 runMigrations 在每步成功后统一 stamp(from+1),步骤自身不管理版本
 * - 链必须从 v1 起连续无缺口,模块加载即校验(配置错误在构建/测试期就炸)
 */

export interface MigrationStep {
  /** 本步迁移的来源版本,必须等于上一步的 to */
  from: number
  describe: string
  run: (node: TripNode) => TripNode
}

/** v1 → v2:rev 回填、demo 归档到 legacy.demo;其余原样保真 */
export function migrateV1toV2(node: TripNode): TripNode {
  const raw = node as unknown as Record<string, unknown>
  const srcData = (raw.data && typeof raw.data === 'object' ? raw.data : {}) as Record<
    string,
    unknown
  >
  const data: Record<string, unknown> = { ...srcData }

  // demo 归档:迁移永不覆盖、永不丢弃 legacy 既有内容。
  // legacy.demo 已存在(与待归档 demo 同键冲突)或 legacy 非普通对象时,
  // 拒绝迁移(抛错 → runMigrations 失败 → 只读模式),绝不静默取舍;
  // legacy 为 null 视同不存在(v1 契约本无 legacy 字段)。
  const demo = data.demo
  if (demo !== undefined) {
    const legacy = data.legacy
    if (legacy !== undefined && legacy !== null) {
      const isPlainObject = typeof legacy === 'object' && !Array.isArray(legacy)
      if (!isPlainObject) {
        throw new Error(
          `legacy 为非对象值(${Array.isArray(legacy) ? '数组' : typeof legacy}),归档将丢失原值,已拒绝迁移`,
        )
      }
      if ('demo' in (legacy as Record<string, unknown>)) {
        throw new Error(
          'legacy.demo 与待归档的 demo 同键冲突,拒绝静默覆盖;请人工合并后重试',
        )
      }
      data.legacy = { ...(legacy as Record<string, unknown>), demo }
    } else {
      data.legacy = { demo }
    }
    delete data.demo
  }

  const next: Record<string, unknown> = { ...raw, data, rev: normalizeRev(raw.rev) }
  return next as unknown as TripNode
}

const MIGRATIONS: MigrationStep[] = [
  {
    from: 1,
    describe: 'v1→v2:rev 回填、演示数据归档 legacy',
    run: migrateV1toV2,
  },
]

// 链连续性守卫:从 v1 到 SUPPORTED-1 每一步都必须存在,缺口 = 配置错误
for (let v = 1; v < SUPPORTED_SCHEMA_VERSION; v++) {
  if (!MIGRATIONS.some((s) => s.from === v)) {
    throw new Error(`迁移链配置缺口:缺少从 v${v} 的迁移函数`)
  }
}

export type MigrationResult = { ok: true; node: TripNode } | { ok: false; error: string }

export function runMigrations(node: TripNode): MigrationResult {
  let cur = node
  while (cur.schemaVersion < SUPPORTED_SCHEMA_VERSION) {
    const step = MIGRATIONS.find((s) => s.from === cur.schemaVersion)
    if (!step) return { ok: false, error: `缺少从 v${cur.schemaVersion} 的迁移函数` }
    try {
      const out = step.run(cur)
      if (!out || typeof out !== 'object') return { ok: false, error: '迁移步骤未返回节点' }
      cur = out
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    // 版本号统一 stamp:每步恰好 +1,循环推进有保证,无需步数守卫
    cur.schemaVersion = step.from + 1
  }
  cur.schemaVersion = SUPPORTED_SCHEMA_VERSION
  return { ok: true, node: cur }
}

