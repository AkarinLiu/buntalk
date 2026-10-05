<script setup lang="ts">
import { AvatarFallback, AvatarImage, AvatarRoot } from 'reka-ui'

const props = withDefaults(
  defineProps<{
    user?: { displayName: string; avatarUrl?: string } | null
    size?: number
  }>(),
  { size: 32 },
)

const style = () => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  fontSize: `${Math.max(10, Math.round(props.size / 2.3))}px`,
})

const initial = (name: string | undefined) => (name?.trim() || '?').slice(0, 1)
</script>

<template>
  <AvatarRoot class="avatar" :style="style()">
    <AvatarImage v-if="user?.avatarUrl" :src="user.avatarUrl" alt="" />
    <AvatarFallback>{{ initial(user?.displayName) }}</AvatarFallback>
  </AvatarRoot>
</template>
