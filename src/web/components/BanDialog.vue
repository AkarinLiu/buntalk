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
  userId: number
  displayName: string
  defaultReason?: string
}>()
const emit = defineEmits<{ close: []; done: [] }>()

const reason = ref('')
/** Days until auto-unban; 0 means permanent. */
const days = ref(0)
const error = ref('')
const submitting = ref(false)

watch(
  () => props.open,
  (open) => {
    if (open) {
      reason.value = props.defaultReason ?? ''
      days.value = 0
      error.value = ''
    }
  },
)

async function submit(): Promise<void> {
  error.value = ''
  submitting.value = true
  try {
    const bannedUntil = days.value > 0 ? new Date(Date.now() + days.value * 86400000).toISOString() : null
    await http.patch(`/admin/users/${props.userId}`, {
      banned: true,
      banReason: reason.value.trim(),
      bannedUntil,
    })
    emit('done')
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
        <DialogTitle class="dialog-title">封禁 {{ displayName }}</DialogTitle>
        <DialogDescription class="dialog-desc">填写封禁原因，可选临时封禁时长。</DialogDescription>

        <p v-if="error" class="form-error">{{ error }}</p>

        <label class="field">
          <span>原因</span>
          <input v-model="reason" type="text" maxlength="200" placeholder="例如：发布广告" />
        </label>

        <label class="field">
          <span>时长</span>
          <select v-model.number="days">
            <option :value="0">永久</option>
            <option :value="1">1 天</option>
            <option :value="7">7 天</option>
            <option :value="30">30 天</option>
            <option :value="365">365 天</option>
          </select>
        </label>

        <div class="dialog-actions">
          <button class="btn" type="button" @click="emit('close')">取消</button>
          <button
            class="btn btn-danger"
            type="button"
            :disabled="submitting"
            @click="submit"
          >
            {{ submitting ? '提交中…' : '确认封禁' }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
