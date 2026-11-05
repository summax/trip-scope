<script setup lang="ts">
import { state, newTrip, restoreFromSafe, refreshSafeDrafts } from '../core/store'
import { fmtTime } from '../core/fmt'

function onCheckDrafts(): void {
  refreshSafeDrafts()
}
</script>

<template>
  <div class="card mx-auto mt-10 max-w-xl">
    <div class="text-base font-medium">数据安全模式</div>
    <p class="mt-2 text-sm text-muted">{{ state.safeDetail }}</p>
    <p class="mt-1 text-xs text-muted">
      原文件未被写回或覆盖;可尝试从本地草稿恢复,或新建旅行。
    </p>

    <div class="mt-4 flex flex-wrap gap-2">
      <button class="btn" @click="onCheckDrafts">检查本地草稿</button>
      <button class="btn btn-primary" @click="newTrip">新建旅行</button>
    </div>

    <div v-if="state.safeDrafts.length > 0" class="mt-4 border-t border-line pt-3">
      <div class="mb-2 text-xs text-muted">候选草稿(按保存时间倒序)</div>
      <div class="space-y-1.5">
        <div
          v-for="d in state.safeDrafts"
          :key="d.id"
          class="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-1.5"
        >
          <div class="text-sm">
            {{ d.name }}
            <span class="text-xs text-muted">(保存于 {{ fmtTime(d.savedAt) }} · v{{ d.schemaVersion }})</span>
          </div>
          <button class="btn" @click="restoreFromSafe(d.id)">恢复</button>
        </div>
      </div>
    </div>
  </div>
</template>
