<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { ref, watch } from 'vue'
import { errMessage, http } from '../api'

const props = defineProps<{
  open: boolean
  targetType: 'thread' | 'post'
  targetId: number
  targetLabel?: string
}>()
const emit = defineEmits<{ close: []; submitted: [] }>()

const reason = ref('')
const error = ref('')
const submitting = ref(false)

// Reset each time the dialog opens, so a cancelled report leaves nothing behind.
watch(
  () => props.open,
  (open) => {
    if (open) {
      reason.value = ''
      error.value = ''
    }
  },
)

async function submit(): Promise<void> {
  error.value = ''
  submitting.value = true
  try {
    await http.post('/reports', {
      targetType: props.targetType,
      targetId: props.targetId,
      reason: reason.value.trim(),
    })
    emit('submitted')
    emit('close')
  } catch (err) {
    error.value = errMessage(err)
  } finally {
    submitting.value = false
  }
}

function onOpenChange(value: boolean): void {
  if (!value) emit('close')
}
</script>

<template>
  <DialogRoot :open="open" @update:open="onOpenChange">
    <DialogPortal>
      <DialogOverlay class="dialog-overlay" />
      <DialogContent class="dialog-content">
        <DialogTitle class="dialog-title">举报</DialogTitle>
        <DialogDescription class="dialog-desc">
          {{ targetLabel ? `举报「${targetLabel}」` : '请说明举报理由，管理员会尽快处理。' }}
        </DialogDescription>

        <p v-if="error" class="form-error">{{ error }}</p>

        <label class="field">
          <span>理由</span>
          <textarea
            v-model="reason"
            rows="3"
            maxlength="300"
            placeholder="这条内容哪里有问题？"
          ></textarea>
        </label>

        <div class="dialog-actions">
          <button class="btn" type="button" @click="emit('close')">取消</button>
          <button
            class="btn btn-primary"
            type="button"
            :disabled="!reason.trim() || submitting"
            @click="submit"
          >
            {{ submitting ? '提交中…' : '提交举报' }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
