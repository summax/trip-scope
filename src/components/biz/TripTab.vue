<script setup lang="ts">
/** 旅行基础:日期/旅行者/票档(成人档恒 100%) */
import { computed, ref } from 'vue'
import * as ops from '../../core/domain/ops'

const trip = computed(() => ops.readTrip())

const newTravelerName = ref('')
const newTravelerTier = ref('')
const newTierName = ref('')
const newTierRatio = ref('')

function addTraveler(): void {
  const name = newTravelerName.value.trim()
  const tierId = newTravelerTier.value || trip.value?.tiers[0]?.id
  if (!name || !trip.value || !tierId) return
  ops.addTraveler(name, tierId)
  newTravelerName.value = ''
}

function addTier(): void {
  const name = newTierName.value.trim()
  const ratio = Number(newTierRatio.value)
  if (!name || !Number.isFinite(ratio) || ratio <= 0 || ratio > 100) {
    return
  }
  ops.addTier(name, Math.round(ratio))
  newTierName.value = ''
  newTierRatio.value = ''
}

function fmtRatio(p: number): string {
  return p + '%'
}
</script>

<template>
  <div v-if="trip" class="space-y-4">
    <div class="card">
      <div class="mb-3 text-sm font-medium">旅行日期</div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="mb-1 block text-xs text-muted">开始日期</label>
          <input
            class="input"
            type="date"
            :value="trip.info.startDate"
            @change="ops.setTripDates(($event.target as HTMLInputElement).value, trip!.info.endDate)"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-muted">结束日期</label>
          <input
            class="input"
            type="date"
            :value="trip.info.endDate"
            @change="ops.setTripDates(trip!.info.startDate, ($event.target as HTMLInputElement).value)"
          />
        </div>
      </div>
      <p v-if="!trip.info.startDate" class="mt-2 text-xs text-muted">
        先设定日期范围;范围外的金额会在汇总中单列(不进按人/按日)。
      </p>
    </div>

    <div class="card">
      <div class="mb-3 text-sm font-medium">票档(成人档恒为基准价 100%)</div>
      <div class="space-y-2">
        <div
          v-for="tier in trip.tiers"
          :key="tier.id"
          class="flex items-center gap-2"
        >
          <span class="w-16 text-sm">{{ tier.name }}</span>
          <input
            class="input flex-1"
            type="number"
            min="1"
            max="100"
            :value="tier.ratioPercent"
            :disabled="tier.ratioPercent === 100"
            @change="ops.setTierRatio(tier.id, Number(($event.target as HTMLInputElement).value))"
          />
          <span class="text-xs text-muted">{{ fmtRatio(tier.ratioPercent) }}</span>
          <button
            v-if="tier.ratioPercent !== 100"
            class="btn-ghost-danger"
            @click="ops.removeTier(tier.id)"
          >
            删除
          </button>
        </div>
      </div>
      <div class="mt-3 flex gap-2">
        <input v-model="newTierName" class="input flex-1" placeholder="票档名(如:儿童)" />
        <input v-model="newTierRatio" class="input w-24" type="number" placeholder="比例%" />
        <button class="btn" @click="addTier">添加票档</button>
      </div>
    </div>

    <div class="card">
      <div class="mb-3 text-sm font-medium">旅行者(挂票档)</div>
      <div class="space-y-2">
        <div
          v-for="t in trip.travelers"
          :key="t.id"
          class="flex items-center gap-2"
        >
          <input
            class="input flex-1"
            :value="t.name"
            @input="ops.setTravelerName(t.id, ($event.target as HTMLInputElement).value)"
          />
          <select
            class="input w-28"
            :value="t.tierId"
            @change="ops.setTravelerTier(t.id, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="tier in trip!.tiers" :key="tier.id" :value="tier.id">
              {{ tier.name }}
            </option>
          </select>
          <button class="btn-ghost-danger" @click="ops.removeTraveler(t.id)">删除</button>
        </div>
        <div v-if="trip.travelers.length === 0" class="text-xs text-muted">
          尚无旅行者,先添加。
        </div>
      </div>
      <div class="mt-3 flex gap-2">
        <input v-model="newTravelerName" class="input flex-1" placeholder="姓名" />
        <select v-model="newTravelerTier" class="input w-28">
          <option value="">默认第一档</option>
          <option v-for="tier in trip.tiers" :key="tier.id" :value="tier.id">
            {{ tier.name }}
          </option>
        </select>
        <button class="btn" :disabled="!newTravelerName.trim()" @click="addTraveler">
          添加旅行者
        </button>
      </div>
    </div>
  </div>
</template>
