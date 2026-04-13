<template>
  <app-layout />
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import AppLayout from '@/components/layout/AppLayout/index.vue'

export default defineComponent({
  name: 'App',
  components: { AppLayout },
})
</script>
