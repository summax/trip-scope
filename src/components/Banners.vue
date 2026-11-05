<script setup lang="ts">
import { computed } from 'vue'
import { state, restoreDraft, discardDraft } from '../core/store'
import { fmtTime } from '../core/fmt'

const hasBanners = computed(
  () =>
    state.draftBanner !== null ||
    state.storageError !== null ||
    state.readonlyReason !== '' ||
    (state.screen === 'trip' && state.snapshotIssues.length > 0),
)
</script>

<template>
  <div v-if="hasBanners" class="mx-auto w-full max-w-5xl px-4 pt-3 space-y-2">
    <!-- 草稿冲突:内容与文件不一致,由用户选择恢复或丢弃,绝不静默覆盖 -->
    <div
      v-if="state.draftBanner"
      class="flex flex-col gap-2 rounded-xl border border-warn/50 bg-warn/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="text-sm">
        <span class="font-medium">检测到较新的本地草稿</span>
        <span class="text-muted">
          (保存于 {{ fmtTime(state.draftBanner.entry.savedAt) }} ·
          {{ state.draftBanner.basedOnCurrent ? '包含尚未保存到文件的编辑' : '基于较旧版本文件,且内容不同' }})
        </span>
      </div>
      <div class="flex shrink-0 gap-2">
        <button class="btn btn-primary" @click="restoreDraft">恢复草稿</button>
        <button class="btn" @click="discardDraft">丢弃草稿</button>
      </div>
    </div>

    <!-- 存储写失败:引导文件保存 / JSON 导出 -->
    <div
      v-if="state.storageError"
      class="rounded-xl border border-danger/50 bg-danger/10 px-4 py-3 text-sm"
    >
      <span class="font-medium">本地草稿保存失败</span>
      <span class="text-muted">
        ({{ state.storageError }})—— 请尽快使用「保存」或「导出 JSON」。
      </span>
    </div>

    <!-- 只读模式:未知更高 schemaVersion 或迁移失败 -->
    <div v-if="state.readonlyReason" class="rounded-xl border border-info/50 bg-info/10 px-4 py-3 text-sm">
      <span class="font-medium">只读模式</span>
      <span class="text-muted">({{ state.readonlyReason }})</span>
    </div>

    <!-- 快照自校验未通过:副本生成受限 -->
    <div
      v-if="state.screen === 'trip' && state.snapshotIssues.length > 0"
      class="rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm"
    >
      <span class="font-medium">副本生成能力受限</span>
      <span class="text-muted">(快照自校验未通过:{{ state.snapshotIssues.join(';') }})—— 建议使用「导出 JSON」。</span>
    </div>
  </div>

  <!-- 操作结果 toast(setToast 由异步流程调用,需独立于横幅区渲染) -->
  <div
    v-if="state.toast"
    class="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full border border-line bg-surface px-4 py-2 text-sm shadow-lg"
  >
    {{ state.toast }}
  </div>
</template>
