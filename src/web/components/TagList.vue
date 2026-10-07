<script setup lang="ts">
import type { TagRow } from '../../shared/types'

defineProps<{ tags?: TagRow[] }>()
</script>

<template>
  <span v-if="tags && tags.length" class="tag-list">
    <router-link v-for="tag in tags" :key="tag.id" :to="`/?tag=${tag.id}`" class="tag-pill">
      {{ tag.name }}
    </router-link>
  </span>
</template>
