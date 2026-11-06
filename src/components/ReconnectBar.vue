<script setup lang="ts">
import { state, reconnectLastFile, dismissReconnect } from '../core/store'
</script>

<template>
  <div
    v-if="state.reconnectOffer"
    class="border-b border-line bg-surface-2/70 px-4 py-2"
  >
    <div class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 text-sm">
      <span class="text-muted">
        上次会话在编辑「{{ state.reconnectOffer.fileName }}」——刷新后写回通道已断开
      </span>
      <span class="flex gap-2">
        <button class="btn btn-primary" @click="reconnectLastFile">重新连接</button>
        <button class="btn" @click="dismissReconnect">忽略</button>
      </span>
    </div>
  </div>
</template>
