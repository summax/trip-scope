<script setup lang="ts">
import { state } from './core/store'
import TopBar from './components/TopBar.vue'
import Banners from './components/Banners.vue'
import TripScreen from './components/TripScreen.vue'
import ForeignScreen from './components/ForeignScreen.vue'
import SafeScreen from './components/SafeScreen.vue'
import ConflictModal from './components/ConflictModal.vue'
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-bg text-ink">
    <TopBar />
    <Banners />
    <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
      <TripScreen v-if="state.screen === 'trip' && state.node" />
      <ForeignScreen v-else-if="state.screen === 'foreign'" />
      <SafeScreen v-else-if="state.screen === 'safe'" />
    </main>
    <footer
      class="border-t border-line py-4 text-center text-xs text-muted"
    >
      TripScope v{{ state.appVersion }} · 一个文件,一次旅行 · 离线运行 · 文件分享 · 独立编辑
      <span v-if="!state.pickerSupported" class="ml-1">
        (当前浏览器无文件写回能力,保存将下载副本)
      </span>
    </footer>
    <ConflictModal />
  </div>
</template>
