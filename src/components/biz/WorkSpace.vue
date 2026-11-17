<script setup lang="ts">
/** 工作区 Tab 框架:八视图切换;挂载时确保业务数据存在 */
import { onMounted, ref, computed } from 'vue'
import { state } from '../../core/store'
import { ensureTrip } from '../../core/domain/ops'
import TripTab from './TripTab.vue'
import LegsTab from './LegsTab.vue'
import StaysTab from './StaysTab.vue'
import ExpensesTab from './ExpensesTab.vue'
import CompareTab from './CompareTab.vue'
import BudgetTab from './BudgetTab.vue'
import LedgerTab from './LedgerTab.vue'
import SummaryTab from './SummaryTab.vue'

const tabs = [
  { key: 'trip', label: '旅行' },
  { key: 'legs', label: '交通' },
  { key: 'stays', label: '住宿' },
  { key: 'expenses', label: '费用' },
  { key: 'compare', label: '方案' },
  { key: 'budget', label: '预算' },
  { key: 'ledger', label: '记账' },
  { key: 'summary', label: '汇总' },
] as const

type TabKey = (typeof tabs)[number]['key']
const active = ref<TabKey>('trip')

const readonly = computed(() => state.readonly)

onMounted(() => {
  ensureTrip()
})
</script>

<template>
  <div class="space-y-4">
    <div
      v-if="readonly"
      class="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
    >
      只读模式:数据版本高于当前应用或迁移失败,仅可查看与导出。
    </div>
    <div class="flex gap-1 overflow-x-auto pb-1">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="btn whitespace-nowrap"
        :class="active === t.key ? 'btn-primary' : ''"
        @click="active = t.key"
      >
        {{ t.label }}
      </button>
    </div>
    <KeepAlive>
      <TripTab v-if="active === 'trip'" />
      <LegsTab v-else-if="active === 'legs'" />
      <StaysTab v-else-if="active === 'stays'" />
      <ExpensesTab v-else-if="active === 'expenses'" />
      <CompareTab v-else-if="active === 'compare'" />
      <BudgetTab v-else-if="active === 'budget'" />
      <LedgerTab v-else-if="active === 'ledger'" />
      <SummaryTab v-else-if="active === 'summary'" />
    </KeepAlive>
  </div>
</template>
