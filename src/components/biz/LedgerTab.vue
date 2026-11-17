<script setup lang="ts">
/** 记账:实付录入(归属三选一)/调整/归属操作/删除 + 审计列表 + 待归位与多付提示 */
import { computed, ref } from 'vue'
import * as ops from '../../core/domain/ops'
import { currentBudget } from '../../core/domain/budget'
import { formatCents } from '../../core/amount'
import type { PaymentType, OwnershipType } from '../../core/domain/types'

const trip = computed(() => ops.readTrip())
const cur = computed(() => (trip.value ? currentBudget(trip.value) : null))

const form = ref({
  type: 'full' as PaymentType,
  amount: '',
  date: '',
  method: '',
  note: '',
  ownership: 'none' as OwnershipType,
  lineId: '',
})

const editAmountFor = ref<string | null>(null)
const editAmountVal = ref('')
const editDateFor = ref<string | null>(null)
const editDateVal = ref('')
const attrFor = ref<string | null>(null)
const attrLineId = ref('')
const attrMode = ref<OwnershipType>('line')
const showAudit = ref(false)
const confirmDeleteFor = ref<string | null>(null)

function money(cents: number): string {
  return formatCents(cents)
}

function record(): void {
  const ok = ops.doRecordPayment({
    type: form.value.type,
    amountStr: form.value.amount,
    paymentDate: form.value.date,
    method: form.value.method,
    note: form.value.note,
    ownershipType: form.value.ownership,
    budgetLineId: form.value.ownership === 'line' ? form.value.lineId : undefined,
  })
  if (ok) {
    form.value = {
      type: form.value.type,
      amount: '',
      date: form.value.date,
      method: '',
      note: '',
      ownership: form.value.ownership,
      lineId: form.value.lineId,
    }
  }
}

function applyAttr(payId: string): void {
  ops.doSetAttribution(
    payId,
    attrMode.value,
    attrMode.value === 'line' ? attrLineId.value : undefined,
  )
  attrFor.value = null
}

function typeLabel(t: PaymentType): string {
  return t === 'full' ? '全款' : t === 'final' ? '尾款' : t === 'prepay' ? '预付款' : '其他'
}

function attrLabel(o: OwnershipType, lineId: string | undefined): string {
  if (o === 'outside') return '预算外'
  if (o === 'none') return '待归位'
  const ref = cur.value?.lines.find((l) => l.budgetLineId === lineId)
    ?? trip.value?.budgets.flatMap((v) => v.lines).find((l) => l.budgetLineId === lineId)
  return ref ? ref.name : '(行已清理)'
}
</script>

<template>
  <div v-if="trip" class="space-y-4">
    <div class="card">
      <div class="mb-2 text-sm font-medium">录入支付(填入即最终实际金额)</div>
      <div class="grid grid-cols-2 gap-2 md:grid-cols-3">
        <select v-model="form.type" class="input">
          <option value="prepay">预付款</option>
          <option value="final">尾款</option>
          <option value="full">全款</option>
          <option value="other">其他</option>
        </select>
        <input v-model="form.date" class="input" type="date" placeholder="支付日期" />
        <input v-model="form.amount" class="input" placeholder="金额(元,如 128.5)" />
        <input v-model="form.method" class="input" placeholder="支付方式(微信/信用卡…)" />
        <input v-model="form.note" class="input" placeholder="备注" />
        <select v-model="form.ownership" class="input">
          <option value="line">归预算行</option>
          <option value="outside">预算外</option>
          <option value="none">待归位</option>
        </select>
        <select
          v-if="form.ownership === 'line'"
          v-model="form.lineId"
          class="input col-span-2 md:col-span-3"
        >
          <option value="">选择预算行…</option>
          <option v-for="l in cur?.lines ?? []" :key="l.budgetLineId" :value="l.budgetLineId">
            {{ l.name }}(¥{{ money(l.amountCents) }})
          </option>
        </select>
      </div>
      <div class="mt-2 flex gap-2">
        <button
          class="btn btn-primary"
          :disabled="!form.amount || !form.date || (form.ownership === 'line' && !form.lineId)"
          @click="record"
        >
          录入
        </button>
      </div>
    </div>

    <div
      v-if="trip.payments.filter((p) => p.attributionState === 'pending').length > 0"
      class="card border-warn/50"
    >
      <div class="text-sm font-medium text-warn">
        待归位({{ trip.payments.filter((p) => p.attributionState === 'pending').length }})
      </div>
      <p class="mt-1 text-xs text-muted">
        这些支付已付出但归属未定,计入已付总额,不进行级已付;请尽快归位或标记预算外。
      </p>
    </div>

    <div class="card">
      <div class="mb-2 text-sm font-medium">支付记录({{ trip.payments.length }})</div>
      <div class="space-y-2">
        <div
          v-for="p in [...trip.payments].reverse()"
          :key="p.paymentId"
          class="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">¥{{ money(p.amountCents) }}</span>
            <span class="badge">{{ typeLabel(p.type) }}</span>
            <span class="text-xs text-muted">{{ p.paymentDate }}</span>
            <span v-if="p.method" class="text-xs text-muted">{{ p.method }}</span>
            <span
              class="badge"
              :class="p.attributionState === 'pending' ? 'text-warn' : ''"
            >
              {{ attrLabel(p.ownershipType, p.budgetLineId) }}
            </span>
            <div class="ml-auto flex gap-1">
              <button class="btn text-xs" @click="editAmountFor = p.paymentId; editAmountVal = (p.amountCents / 100).toFixed(2)">改金额</button>
              <button class="btn text-xs" @click="editDateFor = p.paymentId; editDateVal = p.paymentDate">改日期</button>
              <button class="btn text-xs" @click="attrFor = p.paymentId">归属</button>
              <button class="btn-ghost-danger" @click="confirmDeleteFor = p.paymentId">删除</button>
            </div>
          </div>
          <p v-if="p.note" class="mt-1 text-xs text-muted">{{ p.note }}</p>
          <div
            v-if="p.cleanups && p.cleanups.length > 0"
            class="mt-1 text-xs text-muted"
          >
            清理快照:{{ p.cleanups.map((c) => `V${c.versionNo}「${c.lineName}」行 ¥${(c.lineAmountCents / 100).toFixed(2)}`).join(';') }}
          </div>
        </div>
        <div v-if="trip.payments.length === 0" class="text-xs text-muted">尚无支付记录。</div>
      </div>
    </div>

    <div v-if="editAmountFor" class="card">
      <div class="text-sm font-medium">修改支付金额</div>
      <div class="mt-2 flex gap-2">
        <input v-model="editAmountVal" class="input w-40" placeholder="新金额(元)" />
        <button class="btn btn-primary text-xs" @click="ops.doAdjustAmount(editAmountFor, editAmountVal); editAmountFor = null">保存</button>
        <button class="btn text-xs" @click="editAmountFor = null">取消</button>
      </div>
    </div>

    <div v-if="editDateFor" class="card">
      <div class="text-sm font-medium">修改支付日期</div>
      <div class="mt-2 flex gap-2">
        <input v-model="editDateVal" class="input w-40" type="date" />
        <button class="btn btn-primary text-xs" @click="ops.doAdjustDate(editDateFor, editDateVal); editDateFor = null">保存</button>
        <button class="btn text-xs" @click="editDateFor = null">取消</button>
      </div>
    </div>

    <div v-if="attrFor" class="card">
      <div class="text-sm font-medium">设置归属</div>
      <div class="mt-2 flex flex-wrap gap-2 items-center">
        <select v-model="attrMode" class="input w-32">
          <option value="line">预算行</option>
          <option value="outside">预算外</option>
          <option value="none">待归位</option>
        </select>
        <select v-if="attrMode === 'line'" v-model="attrLineId" class="input flex-1 min-w-40">
          <option value="">选择预算行…</option>
          <option v-for="l in cur?.lines ?? []" :key="l.budgetLineId" :value="l.budgetLineId">
            {{ l.name }}
          </option>
        </select>
        <button class="btn btn-primary text-xs" @click="applyAttr(attrFor)">保存</button>
        <button class="btn text-xs" @click="attrFor = null">取消</button>
      </div>
    </div>

    <div v-if="confirmDeleteFor" class="card border-danger/50">
      <div class="text-sm">删除该支付记录?此操作可撤销(撤销栈)。</div>
      <div class="mt-2 flex gap-2">
        <button class="btn btn-primary text-xs" @click="ops.doDeletePayment(confirmDeleteFor); confirmDeleteFor = null">确认删除</button>
        <button class="btn text-xs" @click="confirmDeleteFor = null">取消</button>
      </div>
    </div>

    <div class="card">
      <button class="text-sm font-medium" @click="showAudit = !showAudit">
        审计记录({{ trip.auditLog.length }}){{ showAudit ? ' ▲' : ' ▼' }}
      </button>
      <div v-if="showAudit" class="mt-2 space-y-1">
        <div
          v-for="a in [...trip.auditLog].reverse()"
          :key="a.id"
          class="text-xs text-muted border-t border-line py-1"
        >
          [{{ a.type }}] {{ a.detail }}
        </div>
        <div v-if="trip.auditLog.length === 0" class="text-xs text-muted">暂无审计记录。</div>
      </div>
    </div>
  </div>
</template>
