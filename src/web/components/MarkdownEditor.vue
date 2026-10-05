<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { errMessage, uploadFile } from '../api'
import { renderMarkdown } from '../markdown'

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
    rows?: number
    maxlength?: number
    disabled?: boolean
  }>(),
  { placeholder: '', rows: 8, maxlength: 20000, disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

type Tab = 'write' | 'preview' | 'split'

const tabs: { value: Tab; label: string }[] = [
  { value: 'write', label: '编辑' },
  { value: 'preview', label: '预览' },
  { value: 'split', label: '分栏' },
]

const tab = ref<Tab>('write')
const area = ref<HTMLTextAreaElement | null>(null)

// `computed` is lazy, so nothing is parsed while only the textarea is visible.
const preview = computed(() => renderMarkdown(props.modelValue))

const uploading = ref(false)
const uploadError = ref('')
const picker = ref<HTMLInputElement | null>(null)

/** Inserts text at the caret without wrapping the current selection. */
function insert(text: string): void {
  if (tab.value === 'preview') tab.value = 'split'
  const el = area.value
  if (!el) {
    update(props.modelValue + text)
    return
  }
  const start = el.selectionStart
  const end = el.selectionEnd
  update(props.modelValue.slice(0, start) + text + props.modelValue.slice(end))
  void nextTick(() => {
    el.focus()
    el.setSelectionRange(start + text.length, start + text.length)
  })
}

async function onPick(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Clear first so choosing the same file twice in a row still fires `change`.
  input.value = ''
  if (!file) return

  uploading.value = true
  uploadError.value = ''
  try {
    const { url } = await uploadFile(file)
    // The filename would otherwise be able to close the alt text and inject
    // markdown of its own — it is user input like anything else.
    const alt = file.name.replace(/[[\]()\r\n]/g, '').slice(0, 80)
    insert(`![${alt}](${url})`)
  } catch (err) {
    uploadError.value = errMessage(err, '上传失败')
  } finally {
    uploading.value = false
  }
}

function update(next: string): void {
  emit('update:modelValue', next)
}

/** Wraps the selection (or a hint) in markers, then re-selects it. */
function surround(before: string, after: string, hint: string): void {
  const el = area.value
  if (!el || props.disabled) return
  const start = el.selectionStart
  const end = el.selectionEnd
  const value = props.modelValue
  const chosen = value.slice(start, end) || hint
  update(value.slice(0, start) + before + chosen + after + value.slice(end))
  void nextTick(() => {
    el.focus()
    el.setSelectionRange(start + before.length, start + before.length + chosen.length)
  })
}

/** Prefixes every line the selection touches — lists and quotes. */
function prefixLines(prefix: string): void {
  const el = area.value
  if (!el || props.disabled) return
  const value = props.modelValue
  const start = value.lastIndexOf('\n', Math.max(0, el.selectionStart - 1)) + 1
  const found = value.indexOf('\n', el.selectionEnd)
  const stop = found === -1 ? value.length : found
  const block = value
    .slice(start, stop)
    .split('\n')
    .map((line) => prefix + line)
    .join('\n')
  update(value.slice(0, start) + block + value.slice(stop))
  void nextTick(() => {
    el.focus()
    el.setSelectionRange(start, start + block.length)
  })
}

// A method, not an inline arrow: Vue compiles templates as plain JS, so a TS
// cast like `($event.target as HTMLTextAreaElement)` there would not compile.
function onInput(event: Event): void {
  update((event.target as HTMLTextAreaElement).value)
}

function onKeydown(event: KeyboardEvent): void {
  if (!event.ctrlKey && !event.metaKey) return
  const shortcuts: Record<string, () => void> = {
    b: () => surround('**', '**', '粗体'),
    i: () => surround('*', '*', '斜体'),
    e: () => surround('`', '`', 'code'),
    k: () => surround('[', '](https://)', '链接文字'),
  }
  const action = shortcuts[event.key.toLowerCase()]
  if (!action) return
  event.preventDefault()
  action()
}

/** Public so a parent can focus the editor; switches away from preview first. */
function focus(): void {
  if (tab.value === 'preview') tab.value = 'split'
  void nextTick(() => area.value?.focus())
}

defineExpose({ focus })
</script>

<template>
  <div class="md-editor" :class="{ 'is-disabled': disabled }">
    <div class="md-toolbar">
      <button class="md-tool" type="button" title="粗体 (Ctrl+B)" :disabled="disabled" @click="surround('**', '**', '粗体')">
        <b>B</b>
      </button>
      <button class="md-tool" type="button" title="斜体 (Ctrl+I)" :disabled="disabled" @click="surround('*', '*', '斜体')">
        <i>I</i>
      </button>
      <button class="md-tool" type="button" title="标题" :disabled="disabled" @click="prefixLines('## ')">
        H
      </button>
      <button class="md-tool" type="button" title="引用" :disabled="disabled" @click="prefixLines('> ')">
        ❝
      </button>
      <button class="md-tool" type="button" title="无序列表" :disabled="disabled" @click="prefixLines('- ')">
        •
      </button>
      <button class="md-tool" type="button" title="行内代码 (Ctrl+E)" :disabled="disabled" @click="surround('`', '`', 'code')">
        &lt;/&gt;
      </button>
      <button class="md-tool" type="button" title="链接 (Ctrl+K)" :disabled="disabled" @click="surround('[', '](https://)', '链接文字')">
        🔗
      </button>
      <button
        class="md-tool"
        type="button"
        title="上传图片或 PDF"
        :disabled="disabled || uploading"
        @click="picker?.click()"
      >
        {{ uploading ? '…' : '⬆' }}
      </button>
      <input
        ref="picker"
        class="hidden-file"
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif,application/pdf"
        @change="onPick"
      />

      <span class="spacer"></span>

      <div class="md-tabs">
        <button
          v-for="item in tabs"
          :key="item.value"
          class="md-tab"
          :class="{ active: tab === item.value }"
          type="button"
          @click="tab = item.value"
        >
          {{ item.label }}
        </button>
      </div>
    </div>

    <div class="md-panes" :class="`panes-${tab}`">
      <textarea
        v-show="tab !== 'preview'"
        ref="area"
        :value="modelValue"
        :rows="rows"
        :maxlength="maxlength"
        :placeholder="placeholder"
        :disabled="disabled"
        @input="onInput"
        @keydown="onKeydown"
      ></textarea>

      <div
        v-show="tab !== 'write'"
        class="md-preview markdown-body"
        v-html="preview"
      ></div>
    </div>

    <div class="md-foot">
      <span class="faint">支持 Markdown · {{ modelValue.length }} / {{ maxlength }}</span>
      <span v-if="uploadError" class="md-error">{{ uploadError }}</span>
      <span v-else class="faint">原始 HTML 会被转义</span>
    </div>
  </div>
</template>
