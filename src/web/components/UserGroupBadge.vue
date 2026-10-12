<script setup lang="ts">
import type { UserGroupRow } from '../../shared/types'

defineProps<{ group: UserGroupRow | null | undefined }>()
</script>

<template>
  <span
    v-if="group"
    class="group-badge"
    :style="{ color: group.color, borderColor: group.color }"
  >
    {{ group.name }}
  </span>
</template>
