<script setup lang="ts">
/** 预算:首次确认(从方案)/按现价刷新(策略乙,来源快照必生成)/手动行/版本对比/清理 */
import { computed, ref } from 'vue'
import * as ops from '../../core/domain/ops'
import {
  currentBudget,
  currentVersionNo,
  compareVersions,
  canCleanupVersion,
} from '../../core/domain/budget'
import { paidOfLine } from '../../core/domain/payments'
import { formatCents } from '../../core/amount'

const trip = computed(() => ops.readTrip())
const cur = computed(() => (trip.value ? currentBudget(trip.value) : null))
const vno = computed(() => (trip.value ? currentVersionNo(trip.value) : 0))

const refreshConfirm = ref(false)
const cleanupConfirmFor = ref<number | null>(null)

const newLine = ref({ name: '', amount: '', reason: '' })

function addManualLine(): void {
  const ok = ops.addManualLine(
    newLine.value.name.trim(),
    newLine.value.amount,
    newLine.value.reason.trim(),
  )
  if (ok) newLine.value = { name: '', amount: '', reason: '' }
}

const cmpA = ref(1)
const cmpB = ref(1)

function linePaid(budgetLineId: string): number {
  return trip.value ? paidOfLine(trip.value, budgetLineId) : 0
}

function money(cents: number): string {
  return formatCents(cents)
}
</script>

<template>
  <div v-if="trip" class="space-y-4">
    <div v-if="!cur" class="card">
      <div class="mb-2 text-sm font-medium">尚无正式预算</div>
      <p class="text-xs text-muted">
        先在「方案」页存档一个方案,然后从方案确认 V1;之后用「按现价刷新」从当前组合生成新版本。
      </p>
      <div v-if="trip.plans.length === 0" class="mt-2 text-xs text-muted">
        没有可确认的方案。
      </div>
      <div v-else class="mt-3 space-y-2">
        <button
          v-for="p in trip.plans"
          :key="p.id"
          class="btn"
          @click="ops.doConfirmBudget(p.id)"
        >
          确认「{{ p.name }}」为正式预算 V1
        </button>
      </div>
    </div>

    <template v-else>
      <div class="card">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-sm font-medium">当前版本 V{{ vno }}</span>
          <span class="badge">{{ cur!.sourceType === 'first' ? '首次确认' : '按现价刷新' }}</span>
          <span v-if="cur!.sourceType === 'first'" class="badge">
            来源方案:{{ trip.plans.find((p) => p.id === cur!.sourcePlanId)?.name ?? '(已删)' }}
          </span>
          <span v-else class="badge">来源=当前组合(快照已记录)</span>
          <div class="ml-auto">
            <button v-if="!refreshConfirm" class="btn btn-primary" @click="refreshConfirm = true">
              按现价刷新
            </button>
          </div>
        </div>
        <div
          v-if="refreshConfirm"
          class="mt-2 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-sm"
        >
          刷新将<b>按当前组合取数</b>生成新版本 V{{ vno + 1 }}:组合中未存档的临时改动会进入正式预算;旧版本整体冻结、历史支付归属不变。确认?
          <div class="mt-2 flex gap-2">
            <button
              class="btn btn-primary text-xs"
              @click="ops.doRefreshBudget(); refreshConfirm = false"
            >
              确认刷新
            </button>
            <button class="btn text-xs" @click="refreshConfirm = false">取消</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="mb-2 text-sm font-medium">
          预算行({{ cur!.lines.length }})· 合计 ¥{{ money(cur!.lines.reduce((a, l) => a + l.amountCents, 0) / 100) }}
        </div>
        <div class="space-y-1.5">
          <div
            v-for="line in cur!.lines"
            :key="line.budgetLineId"
            class="flex flex-wrap items-center gap-2 text-sm"
          >
            <span class="flex-1 min-w-30">{{ line.name }}</span>
            <span v-if="line.objType === 'manual'" class="badge text-info">手动</span>
            <span class="text-muted">¥{{ money(line.amountCents) }}</span>
            <span class="text-xs" :class="linePaid(line.budgetLineId) > 0 ? 'text-brand' : 'text-muted'">
              已付 ¥{{ money(linePaid(line.budgetLineId)) }}
            </span>
            <span
              v-if="linePaid(line.budgetLineId) > line.amountCents"
              class="badge text-warn"
            >
              已多付
            </span>
            <button
              v-if="line.objType === 'manual'"
              class="btn-ghost-danger"
              @click="ops.removeManualLine(line.budgetLineId)"
            >
              删
            </button>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <input v-model="newLine.name" class="input flex-1 min-w-30" placeholder="手动行名称" />
          <input v-model="newLine.amount" class="input w-28" placeholder="金额(元)" />
          <input v-model="newLine.reason" class="input w-40" placeholder="原因" />
          <button class="btn" :disabled="!newLine.name.trim() || !newLine.amount" @click="addManualLine">
            + 手动行
          </button>
        </div>
        <p class="mt-1 text-xs text-muted">手动行不随刷新继承;刷新后需在新版本重新添加。</p>
      </div>

      <div class="card">
        <div class="mb-2 text-sm font-medium">版本历史({{ trip.budgets.length }})</div>
        <div class="space-y-1.5">
          <div
            v-for="v in [...trip.budgets].sort((a, b) => b.versionNo - a.versionNo)"
            :key="v.id"
            class="flex flex-wrap items-center gap-2 text-sm"
          >
            <span class="font-medium">V{{ v.versionNo }}</span>
            <span class="text-xs text-muted">{{ v.createdAt.slice(0, 10) }}</span>
            <span class="badge">{{ v.lines.length }} 行</span>
            <span class="badge">
              ¥{{ money(v.lines.reduce((a, l) => a + l.amountCents, 0)) }}
            </span>
            <span class="text-xs text-muted">
              {{ v.sourceType === 'first' ? '首次确认' : '刷新(组合)' }}
            </span>
            <button
              v-if="canCleanupVersion(trip, v.versionNo)"
              class="btn-ghost-danger ml-auto"
              @click="cleanupConfirmFor = v.versionNo"
            >
              清理
            </button>
          </div>
        </div>
        <div
          v-if="cleanupConfirmFor !== null"
          class="mt-2 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-sm"
        >
          清理 V{{ cleanupConfirmFor }}:引用其行的支付将附着行级快照(时点事实,不改写),版本移除。确认?
          <div class="mt-2 flex gap-2">
            <button
              class="btn btn-primary text-xs"
              @click="ops.doCleanupVersion(cleanupConfirmFor); cleanupConfirmFor = null"
            >
              确认清理
            </button>
            <button class="btn text-xs" @click="cleanupConfirmFor = null">取消</button>
          </div>
        </div>
        <p class="mt-1 text-xs text-muted">当前版本与上一版不可清理;清理可撤销(撤销栈)。</p>
      </div>

      <div class="card">
        <div class="mb-2 text-sm font-medium">版本对比</div>
        <div class="flex flex-wrap gap-2 text-sm">
          <select v-model.number="cmpA" class="input w-28">
            <option v-for="v in trip.budgets" :key="v.id" :value="v.versionNo">V{{ v.versionNo }}</option>
          </select>
          <span class="self-center text-muted">对比</span>
          <select v-model.number="cmpB" class="input w-28">
            <option v-for="v in trip.budgets" :key="v.id" :value="v.versionNo">V{{ v.versionNo }}</option>
          </select>
        </div>
        <div v-if="cmpA !== cmpB" class="mt-3">
          <table class="w-full text-sm">
            <tbody>
              <tr
                v-for="r in compareVersions(trip, cmpA, cmpB).rows"
                :key="r.logicalLineId"
                class="border-t border-line"
              >
                <td class="py-1 pr-2">{{ r.a?.name ?? r.b?.name }}</td>
                <td class="py-1 pr-2 text-right">
                  {{ r.a ? '¥' + money(r.a.amountCents) : '—' }}
                </td>
                <td class="py-1 pr-2 text-right">
                  {{ r.b ? '¥' + money(r.b.amountCents) : '—' }}
                </td>
                <td class="py-1">
                  <span
                    :class="{
                      'text-warn': r.status === 'changed',
                      'text-brand': r.status === 'added',
                      'text-danger': r.status === 'removed',
                      'text-muted': r.status === 'same',
                    }"
                  >
                    {{ r.status === 'same' ? '同额' : r.status === 'changed' ? '改额' : r.status === 'added' ? '新增' : '不再包含' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div class="mt-1 text-xs text-muted">
            V{{ cmpA }} 合计 ¥{{ money(compareVersions(trip, cmpA, cmpB).totalA) }}
            · V{{ cmpB }} 合计 ¥{{ money(compareVersions(trip, cmpA, cmpB).totalB) }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
