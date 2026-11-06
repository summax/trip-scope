<script setup lang="ts">
import { computed, ref } from 'vue'
import { Compass, FolderOpen, Save, CopyPlus, Download, Upload, FilePlus2, Archive, Sun, Moon } from 'lucide-vue-next'
import { state, save, saveAsCopy, openHandleFile, newTrip, doExportJson, toggleTheme, importFile, openDraftsPanel } from '../core/store'

const fileInput = ref<HTMLInputElement | null>(null)
const canSave = computed(() => state.screen === 'trip' && !state.readonly && state.node !== null)
const saveLabel = computed(() => (state.openMode === 'handle' ? '保存到文件' : '保存(下载副本)'))

function onImportClick(): void {
  fileInput.value?.click()
}

function onFileChosen(e: Event): void {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  if (f) void importFile(f)
  input.value = ''
}
</script>

<template>
  <header class="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
    <div class="mx-auto flex max-w-5xl flex-wrap items-center gap-1.5 px-4 py-2.5">
      <div class="mr-2 flex items-center gap-2">
        <div class="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
          <Compass :size="18" />
        </div>
        <div class="leading-tight">
          <div class="text-sm font-bold">TripScope</div>
          <div class="text-[10px] text-muted">旅行费用计划 · 骨架验证版</div>
        </div>
      </div>

      <div class="flex flex-1 flex-wrap items-center justify-end gap-1.5">
        <button class="btn" :disabled="!state.pickerSupported" title="打开旅行文件(句柄模式)" @click="openHandleFile">
          <FolderOpen :size="15" />
          <span class="hidden sm:inline">打开文件</span>
          <span class="sm:hidden">打开</span>
        </button>
        <button class="btn btn-primary" :disabled="!canSave" @click="save()">
          <Save :size="15" />
          {{ saveLabel }}
        </button>
        <button class="btn" :disabled="!canSave" @click="saveAsCopy">
          <CopyPlus :size="15" />
          <span class="hidden sm:inline">另存为副本</span>
          <span class="sm:hidden">副本</span>
        </button>
        <button class="btn" :disabled="!state.node || state.screen !== 'trip'" @click="doExportJson">
          <Download :size="15" />
          <span class="hidden sm:inline">导出 JSON</span>
          <span class="sm:hidden">导出</span>
        </button>
        <button class="btn" @click="onImportClick">
          <Upload :size="15" />
          <span class="hidden sm:inline">导入</span>
          <span class="sm:hidden">导入</span>
        </button>
        <button class="btn" @click="newTrip">
          <FilePlus2 :size="15" />
          <span class="hidden sm:inline">新建旅行</span>
          <span class="sm:hidden">新建</span>
        </button>
        <button class="btn" title="草稿箱:查看/恢复/删除全部本地草稿" @click="openDraftsPanel">
          <Archive :size="15" />
          <span class="hidden sm:inline">草稿箱</span>
          <span class="sm:hidden">草稿</span>
        </button>
        <button class="btn" title="切换主题" @click="toggleTheme">
          <Sun v-if="state.theme === 'dark'" :size="15" />
          <Moon v-else :size="15" />
        </button>
        <input ref="fileInput" type="file" accept=".json,.html,.htm" class="hidden" @change="onFileChosen" />
      </div>
    </div>
  </header>
</template>
