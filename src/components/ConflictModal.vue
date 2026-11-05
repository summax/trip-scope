<script setup lang="ts">
import { state, resolveExternalConflict } from '../core/store'

function onReload(): void {
  void resolveExternalConflict('reload')
}

function onCopy(): void {
  void resolveExternalConflict('copy')
}

function onCancel(): void {
  void resolveExternalConflict('cancel')
}
</script>

<template>
  <div
    v-if="state.conflictFreshRaw"
    class="fixed inset-0 z-30 grid place-items-center bg-black/45 px-4"
  >
    <div class="w-full max-w-md card">
      <div class="text-base font-medium">检测到文件在磁盘上已被外部修改</div>
      <p class="mt-2 text-sm text-muted">
        写回将覆盖磁盘上的最新内容。检测为尽力检测,不承诺跨进程原子保护。
      </p>
      <ul class="mt-2 list-disc pl-5 text-sm text-muted">
        <li>以磁盘最新为准重载:丢弃当前未保存到文件的编辑(编辑仍在草稿中)</li>
        <li>以当前编辑为准另存副本:原文件保持不变,生成新 UUID 副本文件</li>
      </ul>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <button class="btn" @click="onCancel">取消</button>
        <button class="btn" @click="onCopy">以当前编辑为准另存副本</button>
        <button class="btn btn-primary" @click="onReload">以磁盘最新为准重载</button>
      </div>
    </div>
  </div>
</template>
