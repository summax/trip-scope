<script setup lang="ts">
import { state, newTrip } from '../core/store'
</script>

<template>
  <div class="card mx-auto mt-10 max-w-xl text-center">
    <div class="text-base font-medium">这不是 TripScope 旅行文件</div>
    <p class="mt-2 text-sm text-muted">{{ state.foreignDetail }}</p>
    <p class="mt-1 text-sm text-muted">
      请通过「新建旅行」开始,或检查文件来源。
    </p>
    <div class="mt-4 flex justify-center gap-2">
      <button class="btn btn-primary" @click="newTrip">新建旅行</button>
    </div>
  </div>
</template>
