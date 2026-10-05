<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'

withDefaults(defineProps<{ open: boolean; title: string; message: string; confirmText?: string }>(), {
  confirmText: '确定删除',
})

const emit = defineEmits<{ confirm: []; cancel: [] }>()

// Reka closes on ESC and overlay click by emitting `update:open` false; the
// parent owns `open`, so both paths collapse into a single `cancel`.
function onOpenChange(value: boolean): void {
  if (!value) emit('cancel')
}
</script>

<template>
  <DialogRoot :open="open" @update:open="onOpenChange">
    <DialogPortal>
      <DialogOverlay />
      <DialogContent>
        <h2 class="dialog-title">{{ title }}</h2>
        <DialogDescription class="dialog-desc">{{ message }}</DialogDescription>
        <div class="dialog-actions">
          <button class="btn" type="button" @click="emit('cancel')">取消</button>
          <button class="btn btn-danger" type="button" @click="emit('confirm')">
            {{ confirmText }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
