<script setup lang="ts">
import { X, RotateCcw, Trash2, FolderOpen } from 'lucide-vue-next'
import {
  state,
  closeDraftsPanel,
  restoreFromPanel,
  deleteFromPanel,
} from '../core/store'
import { fmtTime } from '../core/fmt'
</script>

<template>
  <div
    v-if="state.draftsPanelOpen"
    class="fixed inset-0 z-30 grid place-items-center bg-black/45 px-4"
  >
    <div class="w-full max-w-lg card">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <FolderOpen :size="18" class="text-brand" />
          <span class="text-base font-medium">草稿箱</span>
        </div>
        <button class="btn" title="关闭草稿箱" @click="closeDraftsPanel">
          <X :size="16" />
          <span class="hidden sm:inline">关闭</span>
        </button>
      </div>

      <p class="mt-2 text-xs text-muted">
        含未落盘草稿(在空白工具中创建、从未保存过文件的旅行)。恢复会切换当前上下文,恢复前经过数据准入。
      </p>

      <div v-if="state.draftsPanelList.length > 0" class="mt-3 space-y-1.5">
        <div
          v-for="d in state.draftsPanelList"
          :key="d.id"
          class="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-1.5"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm">{{ d.name }}</span>
              <span
                v-if="d.baseUpdatedAt === null && d.id !== '__blank__'"
                class="badge shrink-0 border-warn/50 text-warn"
              >未落盘</span>
              <span v-if="d.id === '__blank__'" class="badge shrink-0">空白草稿</span>
              <span
                v-if="d.schemaVersion > 1"
                class="badge shrink-0 border-info/50 text-info"
              >v{{ d.schemaVersion }}</span>
              <span
                v-if="d.schemaVersion < 1"
                class="badge shrink-0 border-danger/50 text-danger"
              >版本异常</span>
            </div>
            <div class="text-xs text-muted">保存于 {{ fmtTime(d.savedAt) }}</div>
          </div>
          <div class="flex shrink-0 gap-1.5">
            <button class="btn" @click="restoreFromPanel(d.id)">
              <RotateCcw :size="14" />
              恢复
            </button>
            <button class="btn-ghost-danger" @click="deleteFromPanel(d.id)">
              <Trash2 :size="14" />
              <span class="hidden sm:inline">删除</span>
            </button>
          </div>
        </div>
      </div>

      <div v-else class="mt-4 text-sm text-muted">
        草稿箱为空。编辑旅行时自动产生草稿;在空白工具新建而未保存文件的旅行会标记为「未落盘」。
      </div>
    </div>
  </div>
</template>
