<script setup lang="ts">
/** 住宿:住宿单/房间项/套餐候选/计价模式/房间分配(整段粒度) */
import { computed, ref } from 'vue'
import * as ops from '../../core/domain/ops'
import { candidateAmount } from '../../core/domain/pricing'

const trip = computed(() => ops.readTrip())

const newStay = ref({ title: '', checkIn: '', checkOut: '' })
const openRoomFor = ref<string | null>(null)
const newRoom = ref({ title: '', count: 1, capacity: 2 })
const openPkgFor = ref<string | null>(null)
const newPkg = ref({ label: '', total: '' })
const openCandForRoom = ref<string | null>(null)
const newRoomCand = ref({ label: '', price: '' })

function addRoomCand(roomId: string): void {
  if (!newRoomCand.value.label.trim()) return
  const ok = ops.addCandidate({
    kind: 'room',
    subjectId: roomId,
    label: newRoomCand.value.label.trim(),
    adultStr: newRoomCand.value.price,
  })
  if (ok) {
    openCandForRoom.value = null
    newRoomCand.value = { label: '', price: '' }
  }
}

const modeOf = (stayId: string): 'rooms' | 'package' =>
  (trip.value?.combination.stayModes[stayId] ?? 'rooms') as 'rooms' | 'package'

function addStay(): void {
  if (!newStay.value.title.trim() || !newStay.value.checkIn) return
  ops.addStay(
    newStay.value.title.trim(),
    newStay.value.checkIn,
    newStay.value.checkOut || newStay.value.checkIn,
  )
  newStay.value = { title: '', checkIn: '', checkOut: '' }
}

function addRoomFor(stayId: string): void {
  if (!newRoom.value.title.trim()) return
  ops.addRoomItem(stayId, newRoom.value.title.trim(), newRoom.value.count, newRoom.value.capacity)
  openRoomFor.value = null
  newRoom.value = { title: '', count: 1, capacity: 2 }
}

function addPkgFor(stayId: string): void {
  if (!newPkg.value.label.trim()) return
  const ok = ops.addCandidate({
    kind: 'package',
    subjectId: stayId,
    label: newPkg.value.label.trim(),
    adultStr: newPkg.value.total,
  })
  if (ok) {
    openPkgFor.value = null
    newPkg.value = { label: '', total: '' }
  }
}
</script>

<template>
  <div v-if="trip" class="space-y-4">
    <div class="card">
      <div class="mb-3 text-sm font-medium">添加住宿</div>
      <div class="flex flex-wrap gap-2">
        <input v-model="newStay.title" class="input flex-1 min-w-40" placeholder="住宿名称(如:大理古城客栈)" />
        <input v-model="newStay.checkIn" class="input w-38" type="date" />
        <input v-model="newStay.checkOut" class="input w-38" type="date" />
        <button class="btn btn-primary" :disabled="!newStay.title.trim()" @click="addStay">
          添加住宿
        </button>
      </div>
      <p class="mt-1 text-xs text-muted">退房日不计费(半开区间);退房日等于入住日算 0 晚。</p>
    </div>

    <div v-for="stay in trip.stays" :key="stay.id" class="card">
      <div class="flex flex-wrap items-center gap-2">
        <input
          class="input flex-1 min-w-40"
          :value="stay.title"
          @input="ops.updateStayField(stay.id, 'title', ($event.target as HTMLInputElement).value)"
        />
        <input
          class="input w-38"
          type="date"
          :value="stay.checkIn"
          @change="ops.updateStayField(stay.id, 'checkIn', ($event.target as HTMLInputElement).value)"
        />
        <input
          class="input w-38"
          type="date"
          :value="stay.checkOut"
          @change="ops.updateStayField(stay.id, 'checkOut', ($event.target as HTMLInputElement).value)"
        />
        <select
          class="input w-32"
          :value="stay.shareMode ?? 'byNight'"
          @change="ops.updateStayField(stay.id, 'shareMode', ($event.target as HTMLSelectElement).value)"
        >
          <option value="byNight">按晚分摊</option>
          <option value="whole">整体记入住日</option>
        </select>
        <button class="btn-ghost-danger" @click="ops.removeStay(stay.id)">删除住宿</button>
      </div>

      <div class="mt-3 flex items-center gap-3 text-sm">
        <span class="text-muted">计价模式:</span>
        <label class="flex items-center gap-1">
          <input
            type="radio"
            :name="'mode-' + stay.id"
            :checked="(trip.combination.stayModes[stay.id] ?? 'rooms') === 'rooms'"
            @change="ops.setStayMode(stay.id, 'rooms')"
          />
          逐房间
        </label>
        <label class="flex items-center gap-1">
          <input
            type="radio"
            :name="'mode-' + stay.id"
            :checked="(trip.combination.stayModes[stay.id] ?? 'rooms') === 'package'"
            @change="ops.setStayMode(stay.id, 'package')"
          />
          整段套餐
        </label>
        <span class="text-xs text-muted">
          {{ (trip.combination.stayModes[stay.id] ?? 'rooms') === 'rooms' ? '按房间计价' : '套餐一口价生效' }}
        </span>
      </div>

      <div class="mt-3 space-y-2">
        <div
          v-for="item in trip.roomItems.filter((r) => r.stayId === stay.id)"
          :key="item.id"
          class="rounded-lg border border-line bg-surface-2 px-3 py-2"
        >
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <input
              class="input flex-1 min-w-30"
              :value="item.title"
              @input="ops.updateRoomField(item.id, 'title', ($event.target as HTMLInputElement).value)"
            />
            <label class="text-xs text-muted">间数</label>
            <input
              class="input w-16"
              type="number"
              :value="item.count"
              @change="ops.updateRoomField(item.id, 'count', ($event.target as HTMLInputElement).value)"
            />
            <label class="text-xs text-muted">容量</label>
            <input
              class="input w-16"
              type="number"
              :value="item.capacity"
              @change="ops.updateRoomField(item.id, 'capacity', ($event.target as HTMLInputElement).value)"
            />
            <button class="btn-ghost-danger" @click="ops.removeRoomItem(item.id)">删房间</button>
          </div>

          <div class="mt-2 space-y-1">
            <div
              v-for="c in trip.candidates.filter((x) => x.subjectId === item.id)"
              :key="c.id"
              class="flex flex-wrap items-center gap-2 text-sm"
            >
              <label class="flex items-center gap-1.5">
                <input
                  type="radio"
                  :name="'sel-' + item.id"
                  :checked="trip.combination.selections[item.id] === c.id"
                  @change="ops.selectCandidate(item.id, c.id)"
                />
                {{ c.label }}
              </label>
              <span class="text-xs text-muted">¥{{ (c.adultCents / 100).toFixed(2) }}/间晚</span>
              <span class="badge">
                合计 ¥{{ (candidateAmount(c, trip) / 100).toFixed(2) }}
              </span>
              <button class="btn-ghost-danger" @click="ops.removeCandidate(c.id)">删</button>
            </div>
            <button class="btn text-xs" @click="openCandForRoom = item.id">+ 房价候选</button>
            <div v-if="openCandForRoom === item.id" class="flex gap-2 mt-1">
              <input v-model="newRoomCand.label" class="input flex-1" placeholder="候选名" />
              <input v-model="newRoomCand.price" class="input w-32" placeholder="每间每晚(元)" />
              <button class="btn btn-primary" @click="addRoomCand(item.id)">保存</button>
            </div>
          </div>

          <div class="mt-2 text-xs text-muted">分配(整段):</div>
          <div class="mt-1 flex flex-wrap gap-2">
            <label
              v-for="t in trip.travelers"
              :key="t.id"
              class="flex items-center gap-1 text-sm"
            >
              <input
                type="checkbox"
                :checked="trip.assignments[stay.id]?.[item.id]?.includes(t.id) ?? false"
                @change="ops.toggleRoomAssignment(stay.id, item.id, t.id)"
              />
              {{ t.name }}
            </label>
            <span v-if="trip.travelers.length === 0" class="text-xs text-muted">
              先在「旅行」页添加旅行者
            </span>
          </div>
        </div>
      </div>

      <div class="mt-2">
        <button class="btn text-xs" @click="openRoomFor = stay.id; newRoom = { title: '', count: 1, capacity: 2 }">
          + 房间项
        </button>
        <div v-if="openRoomFor === stay.id" class="mt-2 flex flex-wrap gap-2">
          <input v-model="newRoom.title" class="input flex-1" placeholder="房间名(如:标准间)" />
          <input v-model="newRoom.count" class="input w-16" type="number" placeholder="间数" />
          <input v-model="newRoom.capacity" class="input w-16" type="number" placeholder="容量" />
          <button class="btn btn-primary" @click="addRoomFor(stay.id)">保存房间</button>
        </div>
      </div>

      <div class="mt-3 space-y-1">
        <div
          v-for="p in trip.candidates.filter((x) => x.kind === 'package' && x.subjectId === stay.id)"
          :key="p.id"
          class="flex flex-wrap items-center gap-2 text-sm"
        >
          <label class="flex items-center gap-1.5">
            <input
              type="radio"
              :name="'pkg-' + stay.id"
              :checked="trip.combination.selections[stay.id] === p.id"
              @change="ops.selectCandidate(stay.id, p.id)"
            />
            {{ p.label }}
          </label>
          <span class="text-xs text-muted">¥{{ ((p.totalCents ?? 0) / 100).toFixed(2) }} 一口价</span>
          <span v-if="modeOf(stay.id) === 'rooms'" class="badge text-warn">已选但未生效</span>
          <button class="btn-ghost-danger" @click="ops.removeCandidate(p.id)">删</button>
        </div>
        <button class="btn text-xs" @click="openPkgFor = stay.id; newPkg = { label: '', total: '' }">
          + 套餐候选
        </button>
        <div v-if="openPkgFor === stay.id" class="flex gap-2 mt-1">
          <input v-model="newPkg.label" class="input flex-1" placeholder="套餐名" />
          <input v-model="newPkg.total" class="input w-32" placeholder="一口价(元)" />
          <button class="btn btn-primary" @click="addPkgFor(stay.id)">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
