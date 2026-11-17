<script setup lang="ts">
import { state, renameProject } from '../core/store'
import WorkSpace from './biz/WorkSpace.vue'
import { fmtTime } from '../core/fmt'
</script>

<template>
  <div v-if="state.node" class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <span class="badge">
        {{ state.openMode === 'handle' ? '句柄模式(可写回原文件)' : '嵌入模式(保存=下载副本)' }}
      </span>
      <span class="badge" :class="state.readonly ? 'border-danger/40 text-danger' : ''">
        {{ state.readonly ? '只读' : '可编辑' }} · 数据版本 v{{ state.node.schemaVersion }}
      </span>
      <span class="badge">旅行 ID:{{ state.node.project.id.slice(0, 8) }}</span>
      <span class="badge">文件版本:{{ fmtTime(state.fileUpdatedAt) }}</span>
      <span class="badge">内容版本:{{ fmtTime(state.node.updatedAt) }}</span>
    </div>

    <div class="card">
      <div class="mb-1 text-sm font-medium">项目信息</div>
      <label class="mb-1 block text-xs text-muted">项目名</label>
      <input
        class="input"
        :value="state.node.project.name"
        :disabled="state.readonly"
        placeholder="如:2027 国庆云南旅行"
        @input="renameProject(($event.target as HTMLInputElement).value)"
      />
    </div>

    <WorkSpace />
  </div>
</template>
