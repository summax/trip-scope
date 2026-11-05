<script setup lang="ts">
import { computed } from 'vue'
import {
  state,
  updateData,
  renameProject,
  addItem,
  removeItem,
  insertSpecialChars,
} from '../core/store'
import { fmtTime } from '../core/fmt'

const total = computed(() => {
  const a = state.node?.data.demo?.countA ?? 0
  const b = state.node?.data.demo?.countB ?? 0
  return a + b
})
</script>

<template>
  <div v-if="state.node" class="space-y-4">
    <!-- 状态徽标区:验证链路的关键信息 -->
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

    <!-- 项目信息 -->
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
      <p class="mt-2 text-xs text-muted">
        演示字段仅用于验证持久化链路,不是业务功能;正式的日期/交通/住宿/费用功能在后续阶段实现。
      </p>
    </div>

    <!-- 演示数据(骨架验证用) -->
    <div class="card">
      <div class="mb-3 flex items-center justify-between">
        <div class="text-sm font-medium">演示数据</div>
        <button class="btn-ghost-danger" :disabled="state.readonly" @click="insertSpecialChars">
          插入特殊字符(验证 &lt;/script&gt; 转义)
        </button>
      </div>

      <label class="mb-1 block text-xs text-muted">备注(验证特殊字符转义)</label>
      <input
        class="input"
        :value="state.node.data.demo?.note ?? ''"
        :disabled="state.readonly"
        placeholder="可输入任意字符,包括 &lt;/script&gt;、emoji、引号"
        @input="updateData((d) => { if (!d.demo) d.demo = {}; d.demo.note = ($event.target as HTMLInputElement).value })"
      />

      <div class="mt-3 grid grid-cols-2 gap-3">
        <div>
          <label class="mb-1 block text-xs text-muted">演示数量 A</label>
          <input
            class="input"
            type="number"
            :value="state.node.data.demo?.countA ?? 0"
            :disabled="state.readonly"
            @input="updateData((d) => { if (!d.demo) d.demo = {}; d.demo.countA = Number(($event.target as HTMLInputElement).value) || 0 })"
          />
        </div>
        <div>
          <label class="mb-1 block text-xs text-muted">演示数量 B</label>
          <input
            class="input"
            type="number"
            :value="state.node.data.demo?.countB ?? 0"
            :disabled="state.readonly"
            @input="updateData((d) => {
              if (!d.demo) d.demo = {}
              d.demo.countB = Number(($event.target as HTMLInputElement).value) || 0
            })"
          />
        </div>
      </div>
      <div class="mt-3 text-sm">
        A + B = <span class="font-medium text-brand">{{ total }}</span>
      </div>

      <div class="mt-4 border-t border-line pt-3">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-xs text-muted">演示条目列表(增删验证)</span>
          <button class="btn" :disabled="state.readonly" @click="addItem">+ 添加条目</button>
        </div>
        <div class="space-y-1.5">
          <div
            v-for="it in state.node.data.demo?.items ?? []"
            :key="it.id"
            class="flex items-center justify-between rounded-lg border border-line bg-surface-2 px-3 py-1.5"
          >
            <span class="text-sm">{{ it.label }} × {{ it.qty }}</span>
            <button class="btn-ghost-danger" :disabled="state.readonly" @click="removeItem(it.id)">删除</button>
          </div>
          <div v-if="(state.node.data.demo?.items ?? []).length === 0" class="text-xs text-muted">
            暂无条目,点「+ 添加条目」验证数据增删与草稿链路。
          </div>
        </div>
      </div>
    </div>
  </div>
</template>