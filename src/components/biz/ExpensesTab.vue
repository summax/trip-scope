<script setup lang="ts">
/** 自由费用:CRUD,金额为实付净额(整数分) */
import { computed, ref } from 'vue'
import * as ops from '../../core/domain/ops'

const trip = computed(() => ops.readTrip())
const form = ref({ title: '', date: '', amount: '', note: '' })

function add(): void {
  const ok = ops.addExpense(form.value.title.trim(), form.value.date, form.value.amount, form.value.note)
  if (ok) form.value = { title: '', date: '', amount: '', note: '' }
}
</script>

<template>
  <div v-if="trip" class="space-y-4">
    <div class="card">
      <div class="mb-3 text-sm font-medium">添加费用</div>
      <div class="flex flex-wrap gap-2">
        <input v-model="form.title" class="input flex-1 min-w-40" placeholder="费用名称(如:索道票)" />
        <input v-model="form.date" class="input w-38" type="date" />
        <input v-model="form.amount" class="input w-30" placeholder="实付金额(元)" />
        <input v-model="form.note" class="input w-40" placeholder="备注" />
        <button class="btn btn-primary" :disabled="!form.title.trim() || !form.amount" @click="add">
          添加
        </button>
      </div>
    </div>

    <div class="card">
      <div class="mb-2 text-sm font-medium">费用清单({{ trip.expenses.length }})</div>
      <div class="space-y-2">
        <div
          v-for="e in trip.expenses"
          :key="e.id"
          class="flex flex-wrap items-center gap-2"
        >
          <input
            class="input flex-1 min-w-30"
            :value="e.title"
            @input="ops.updateExpenseField(e.id, 'title', ($event.target as HTMLInputElement).value)"
          />
          <input
            class="input w-38"
            type="date"
            :value="e.date"
            @change="ops.updateExpenseField(e.id, 'date', ($event.target as HTMLInputElement).value)"
          />
          <input
            class="input w-28"
            :value="(e.amountCents / 100).toFixed(2)"
            @change="ops.setExpenseAmount(e.id, ($event.target as HTMLInputElement).value)"
          />
          <button class="btn-ghost-danger" @click="ops.removeExpense(e.id)">删除</button>
        </div>
        <div v-if="trip.expenses.length === 0" class="text-xs text-muted">
          尚无费用。费用会作为预算行进入正式预算(来源对象),也会进按人/按日分摊。
        </div>
      </div>
    </div>
  </div>
</template>
