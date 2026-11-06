<script setup lang="ts">
import { state, confirmUpgradeWrite, cancelUpgradeWrite, upgradeCopyInstead } from '../core/store'
import { SUPPORTED_SCHEMA_VERSION } from '../core/schema'
</script>

<template>
  <div
    v-if="state.upgradeConfirmOpen"
    class="fixed inset-0 z-30 grid place-items-center bg-black/45 px-4"
  >
    <div class="w-full max-w-md card">
      <div class="text-base font-medium">本次保存将整体升级原文件</div>
      <p class="mt-2 text-sm text-muted">
        原文件是 v{{ state.upgradeFromVersion }},当前应用支持 v{{ SUPPORTED_SCHEMA_VERSION }}。
        「保存到文件」会用当前版本应用<b>完整替换</b>磁盘上的原文件——应用代码与数据一并升级,
        而不是仅在旧文件里替换数据。
      </p>
      <ul class="mt-2 list-disc pl-5 text-sm text-muted">
        <li>升级后,旧版本应用打开此文件只能只读查看(仍可导出 JSON)</li>
        <li>想保留 v{{ state.upgradeFromVersion }} 原样,可先「另存为副本」</li>
        <li>取消则本次不保存,下次点「保存到文件」会再次询问</li>
      </ul>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <button class="btn" @click="cancelUpgradeWrite">取消</button>
        <button class="btn" @click="upgradeCopyInstead">另存为副本(保留原文件)</button>
        <button class="btn btn-primary" @click="confirmUpgradeWrite">确认升级并保存</button>
      </div>
    </div>
  </div>
</template>
