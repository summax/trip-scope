<script setup lang="ts">
/** 交通区段:区段 CRUD + 交通候选 + 组合选择(同屏对比的取数源) */
import { computed, ref } from 'vue'
import * as ops from '../../core/domain/ops'
import { candidateAmount } from '../../core/domain/pricing'
import { todayStr } from '../../core/domain/pricing'

const trip = computed(() => ops.readTrip())

interface NewLeg {
  title: string
  date: string
}
const newLeg = ref<NewLeg>({ title: '', date: '' })

interface NewCand {
  label: string
  depart: string
  arrive: string
  adult: string
  childOverride: string
  validUntil: string
  refundText: string
}
const newCand = ref<NewCand>({
  label: '',
  depart: '',
  arrive: '',
  adult: '',
  childOverride: '',
  validUntil: '',
  refundText: '',
})
const openCandFor = ref<string | null>(null)

function addLeg(): void {
  if (!newLeg.value.title.trim()) return
  ops.addLeg(newLeg.value.title.trim(), newLeg.value.date)
  newLeg.value = { title: '', date: '' }
}

function addCandidateFor(legId: string): void {
  if (!newCand.value.label.trim()) return
  const ok = ops.addCandidate({
    kind: 'traffic',
    subjectId: legId,
    label: newCand.value.label.trim(),
    depart: newCand.value.depart,
    arrive: newCand.value.arrive,
    adultStr: newCand.value.adult,
    validUntil: newCand.value.validUntil,
    refundPolicyText: newCand.value.refundText,
  })
  if (ok) {
    resetCandForm()
  }
}

function resetCandForm(): void {
  newCand.value = {
    label: '',
    depart: '',
    arrive: '',
    adult: '',
    childOverride: '',
    validUntil: '',
    refundText: '',
  }
}
</script>

<template>
  <div v-if="trip" class="space-y-4">
    <div class="card">
      <div class="mb-3 text-sm font-medium">添加交通区段</div>
      <div class="flex flex-wrap gap-2">
        <input
          v-model="newLeg.title"
          class="input flex-1 min-w-40"
          placeholder="区段名称(如:昆明 → 大理 高铁)"
        />
        <input v-model="newLeg.date" class="input w-40" type="date" />
        <button class="btn btn-primary" :disabled="!newLeg.title.trim()" @click="addLeg">
          添加区段
        </button>
      </div>
    </div>

    <div v-for="leg in trip.legs" :key="leg.id" class="card">
      <div class="flex flex-wrap items-center gap-2">
        <input
          class="input flex-1 min-w-40"
          :value="leg.title"
          @input="ops.updateLegField(leg.id, 'title', ($event.target as HTMLInputElement).value)"
        />
        <input
          class="input w-38"
          type="date"
          :value="leg.date"
          @change="ops.updateLegField(leg.id, 'date', ($event.target as HTMLInputElement).value)"
        />
        <button class="btn-ghost-danger" @click="ops.removeLeg(leg.id)">删除区段</button>
      </div>

      <div class="mt-3 space-y-2">
        <div
          v-for="c in trip.candidates.filter((x) => x.subjectId === leg.id)"
          :key="c.id"
          class="rounded-lg border border-line bg-surface-2 px-3 py-2"
        >
          <div class="flex flex-wrap items-center gap-2">
            <label class="flex items-center gap-1.5 text-sm">
              <input
                type="radio"
                :name="'sel-' + leg.id"
                :checked="trip.combination.selections[leg.id] === c.id"
                @change="ops.selectCandidate(leg.id, c.id)"
              />
              <span class="font-medium">{{ c.label }}</span>
            </label>
            <span v-if="c.depart || c.arrive" class="text-xs text-muted">
              {{ c.depart }} → {{ c.arrive }}
            </span>
            <span class="badge">¥{{ (candidateAmount(c, trip) / 100).toFixed(2) }}</span>
            <span v-if="c.validUntil && c.validUntil < todayStr()" class="badge text-warn">
              报价已过期
            </span>
            <span
              v-if="trip.combination.selections[leg.id] === c.id"
              class="badge text-brand"
            >
              已选
            </span>
            <button class="btn-ghost-danger ml-auto" @click="ops.removeCandidate(c.id)">
              删除
            </button>
          </div>
          <p v-if="c.refundPolicyText" class="mt-1 text-xs text-muted">
            退改:{{ c.refundPolicyText }}
          </p>
        </div>
      </div>

      <div v-if="openCandFor === leg.id" class="mt-3 rounded-lg border border-line p-3">
        <div class="grid grid-cols-2 gap-2">
          <input v-model="newCand.label" class="input" placeholder="候选名(如:G1421 二等座)" />
          <input v-model="newCand.adult" class="input" placeholder="成人基准价(元)" />
          <input v-model="newCand.depart" class="input" placeholder="出发时刻(如 08:30)" />
          <input v-model="newCand.arrive" class="input" placeholder="到达时刻" />
          <input v-model="newCand.validUntil" class="input" type="date" placeholder="报价有效期" />
          <input v-model="newCand.refundText" class="input" placeholder="退改规则(文本)" />
        </div>
        <div class="mt-2 flex gap-2">
          <button class="btn btn-primary" @click="addCandidateFor(leg.id)">保存候选</button>
          <button class="btn" @click="openCandFor = null">取消</button>
        </div>
      </div>
      <button v-else class="btn mt-3" @click="openCandFor = leg.id; resetCandForm()">
        + 添加候选
      </button>
    </div>
  </div>
</template>
