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
import type { ReportReasonsResponse } from '../api'
import type { ReportReasonRow } from '../../shared/types'

const props = defineProps<{
  open: boolean
  targetType: 'thread' | 'post'
  targetId: number
  targetLabel?: string
}>()
const emit = defineEmits<{ close: []; submitted: [] }>()

const reasons = ref<ReportReasonRow[]>([])
const reason = ref('')
const error = ref('')
const submitting = ref(false)

// Reset each time the dialog opens, so a cancelled report leaves nothing behind.
// The reason list is fetched here rather than cached globally: it is tiny and
// admins can change it at any moment.
watch(
  () => props.open,
  async (open) => {
    if (!open) return
    reason.value = ''
    error.value = ''
    try {
      reasons.value = await http.get<ReportReasonsResponse>('/report-reasons')
    } catch {
      reasons.value = []
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
      reason: reason.value,
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
          {{ targetLabel ? `举报「${targetLabel}」` : '请选择举报理由，管理员会尽快处理。' }}
        </DialogDescription>

        <p v-if="error" class="form-error">{{ error }}</p>

        <label class="field">
          <span>理由</span>
          <select v-model="reason" :disabled="!reasons.length">
            <option value="" disabled>请选择举报理由</option>
            <option v-for="item in reasons" :key="item.id" :value="item.label">
              {{ item.label }}
            </option>
          </select>
          <span v-if="!reasons.length" class="faint" style="font-size: 12px">
            管理员尚未配置举报理由。
          </span>
        </label>

        <div class="dialog-actions">
          <button class="btn" type="button" @click="emit('close')">取消</button>
          <button
            class="btn btn-primary"
            type="button"
            :disabled="!reason || submitting"
            @click="submit"
          >
            {{ submitting ? '提交中…' : '提交举报' }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
