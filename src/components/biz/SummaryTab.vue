<script setup lang="ts">
/** 汇总:预算 vs 已付/按人/按日/按类;范围外单列 */
import { computed } from 'vue'
import * as ops from '../../core/domain/ops'
import { tripSummary } from '../../core/domain/alloc'
import { formatCents } from '../../core/amount'

const trip = computed(() => ops.readTrip())
const s = computed(() => (trip.value ? tripSummary(trip.value) : null))

function money(cents: number): string {
  return formatCents(cents)
}

const catName: Record<string, string> = {
  traffic: '交通',
  stay: '住宿',
  expense: '费用',
  manual: '手动',
}
</script>

<template>
  <div v-if="trip && s" class="space-y-4">
    <div class="card grid grid-cols-2 gap-3 md:grid-cols-4">
      <div>
        <div class="text-xs text-muted">预算合计(当前版本)</div>
        <div class="text-lg font-medium">¥{{ money(s.budgetTotal) }}</div>
      </div>
      <div>
        <div class="text-xs text-muted">已付合计</div>
        <div class="text-lg font-medium">¥{{ money(s.paidTotal) }}</div>
      </div>
      <div>
        <div>
          <div class="text-xs text-muted">差额(预算−已付)</div>
          <div class="text-lg font-medium" :class="s.diff >= 0 ? 'text-brand' : 'text-danger'">
            ¥{{ money(s.diff) }}
          </div>
        </div>
      </div>
      <div>
        <div class="text-xs text-muted">待归位</div>
        {{ s.pendingTotal > 0 ? '¥' + money(s.pendingTotal) + '(' + s.pendingCount + ' 笔)' : '无' }}
      </div>
    </div>

    <div class="card">
      <div class="mb-2 text-sm font-medium">按人(预算分摊 & 已付份额)</div>
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-xs text-muted">
            <th class="py-1 pr-3">旅行者</th>
            <th class="py-1 pr-3 text-right">预算分摊</th>
            <th class="py-1 pr-3 text-right">已付份额</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in s.perPerson" :key="p.travelerId" class="border-t border-line">
            <td class="py-1.5 pr-3">{{ p.name }}</td>
            <td class="py-1.5 pr-3 text-right">¥{{ money(p.budget) }}</td>
            <td class="py-1.5 pr-3 text-right">¥{{ money(p.paidShare) }}</td>
          </tr>
          <tr v-if="s.perPerson.length === 0" class="border-t border-line">
            <td colspan="3" class="py-2 text-xs text-muted">
              无旅行者或无预算;先在「旅行」页添加旅行者并确认预算。
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="card">
      <div class="mb-2 text-sm font-medium">按日(分摊日历)</div>
      <div v-if="s.perDay.length === 0" class="text-xs text-muted">
        无分摊数据(需正式预算与日期范围)。
      </div>
      <div v-else class="flex flex-wrap gap-2">
        <div
          v-for="d in s.perDay"
          :key="d.date"
          class="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm"
        >
          <span class="text-muted text-xs">{{ d.date }}</span>
          ¥{{ money(d.budget) }}
        </div>
      </div>
    </div>

    <div class="card">
      <div class="mb-2 text-sm font-medium">按类</div>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="c in s.perCategory"
          :key="c.objType"
          class="badge"
        >
          {{ catName[c.objType] }}:预算 ¥{{ money(c.budget) }} / 已付 ¥{{ money(c.paid) }}
        </span>
      </div>
    </div>

    <div v-if="s.outOfRangeTotal > 0" class="card border-warn/50">
      <div class="text-sm font-medium text-warn">
        范围外金额 R(不进按人/按日):¥{{ money(s.outOfRangeTotal) }}
      </div>
      <div class="mt-1 space-y-0.5">
        <div v-for="(r, i) in s.outOfRangeRows" :key="i" class="text-xs text-muted">
          {{ r.date }} {{ r.name }} ¥{{ money(r.cents) }}
        </div>
      </div>
    </div>
  </div>
</template>
