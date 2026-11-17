<script setup lang="ts">
/** 方案对比:组合与全部方案同屏直接比较(最高交互需求);存档/加载=整体替换+确认。 */
import { computed, ref } from 'vue'
import * as ops from '../../core/domain/ops'
import { combinationTotal, planPriceContext } from '../../core/domain/pricing'
import type { Plan } from '../../core/domain/types'

const trip = computed(() => ops.readTrip())
const newPlanName = ref('')
const confirmLoadFor = ref<string | null>(null)

const comboTotal = computed(() =>
  trip.value ? combinationTotal(trip.value, trip.value.combination.selections) : 0,
)

function planCtx(p: Plan) {
  return trip.value
    ? planPriceContext(trip.value, p)
    : { total: 0, diffCents: 0, changedCandidateIds: [] as string[] }
}

function selectedLabel(selections: Record<string, string>, subjectId: string): string {
  const cid = selections[subjectId]
  if (!cid) return '—'
  const c = trip.value?.candidates.find((x) => x.id === cid)
  return c ? c.label : '(已删)'
}

function rowSubjects() {
  const t = trip.value
  if (!t) return []
  const rows: { subjectId: string; title: string; kind: string }[] = []
  for (const leg of t.legs) {
    rows.push({ subjectId: leg.id, title: leg.title, kind: '交通' })
  }
  for (const stay of t.stays) {
    rows.push({ subjectId: stay.id, title: stay.title + '(住宿)', kind: '住宿' })
  }
  return rows
}

function savePlan(): void {
  const name = newPlanName.value.trim()
  if (!name || !trip.value) return
  if (Object.keys(trip.value.combination.selections).length === 0) {
    return
  }
  ops.savePlan(name)
  newPlanName.value = ''
}

function doLoad(planId: string): void {
  ops.loadPlan(planId)
  confirmLoadFor.value = null
}

function modeLabels(modes: Record<string, 'rooms' | 'package'>): string {
  const keys = Object.keys(modes)
  if (keys.length === 0) return '逐房间(默认)'
  return keys.map((k) => k + ':' + (modes[k] === 'package' ? '套餐' : '房间')).join(' ')
}
</script>

<template>
  <div v-if="trip" class="space-y-4">
    <div class="card">
      <div class="mb-2 text-sm font-medium">存档当前组合为新方案</div>
      <div class="flex gap-2">
        <input v-model="newPlanName" class="input flex-1" placeholder="方案名(如:高铁方案)" />
        <button
          class="btn btn-primary"
          :disabled="!newPlanName.trim() || Object.keys(trip.combination.selections).length === 0"
          @click="savePlan"
        >
          存档
        </button>
      </div>
      <p class="mt-1 text-xs text-muted">
        存档 = 复制组合(选择集+计价模式);加载 = 整体替换当前组合(需确认)。
      </p>
    </div>

    <div class="card overflow-x-auto">
      <div class="mb-2 text-sm font-medium">同屏对比(组合 + 方案)</div>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-muted">
            <th class="py-1 pr-3">对象</th>
            <th class="py-1 pr-3">
              当前组合(¥{{ (comboTotal / 100).toFixed(2) }})
            </th>
            <th v-for="p in trip.plans" :key="p.id" class="py-1 pr-3">
              {{ p.name }}
              <span :class="planCtx(p).diffCents > 0 ? 'text-danger' : 'text-brand'">
                ({{ planCtx(p).diffCents >= 0 ? '+' : '' }}{{ (planCtx(p).diffCents / 100).toFixed(2) }})
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in rowSubjects()" :key="r.subjectId" class="border-t border-line">
            <td class="py-1.5 pr-3 whitespace-nowrap">{{ r.title }}</td>
            <td class="py-1.5 pr-3">{{ selectedLabel(trip.combination.selections, r.subjectId) }}</td>
            <td v-for="p in trip.plans" :key="p.id" class="py-1.5 pr-3">
              {{ selectedLabel(p.selections, r.subjectId) }}
            </td>
          </tr>
          <tr v-if="trip.stays.length > 0" class="border-t border-line">
            <td class="py-1.5 pr-3 text-muted">计价模式</td>
            <td class="py-1.5 pr-3 text-xs">
              {{ modeLabels(trip.combination.stayModes) }}
            </td>
            <td v-for="p in trip.plans" :key="'m' + p.id" class="py-1.5 pr-3 text-xs">
              {{ modeLabels(p.stayModes) }}
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="trip.plans.length === 0" class="mt-2 text-xs text-muted">
        尚无方案。选好组合后存档,即可同屏对比多个方案。
      </p>
    </div>

    <div class="card">
      <div class="mb-2 text-sm font-medium">方案列表</div>
      <div class="space-y-2">
        <div
          v-for="p in trip.plans"
          :key="p.id"
          class="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2"
        >
          <span class="font-medium text-sm">{{ p.name }}</span>
          <span class="badge">现价 ¥{{ (planCtx(p).total / 100).toFixed(2) }}</span>
          <span v-if="planCtx(p).changedCandidateIds.length > 0" class="badge text-warn">
            候选已变化({{ planCtx(p).changedCandidateIds.length }} 项)
          </span>
          <span class="text-xs text-muted">存档于 {{ p.archivedAt.slice(0, 10) }}</span>
          <div class="ml-auto flex gap-1">
            <button class="btn text-xs" @click="confirmLoadFor = p.id">加载</button>
            <button class="btn-ghost-danger" @click="ops.deletePlan(p.id)">删除</button>
          </div>
        </div>
        <div
          v-if="confirmLoadFor"
          class="rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-sm"
        >
          加载将<b>整体替换</b>当前组合(未存档改动将丢失),确认?
          <div class="mt-2 flex gap-2">
            <button class="btn btn-primary text-xs" @click="doLoad(confirmLoadFor)">确认加载</button>
            <button class="btn text-xs" @click="confirmLoadFor = null">取消</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

