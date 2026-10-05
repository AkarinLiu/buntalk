<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errMessage, http } from '../api'
import type { CategoriesResponse, IdResponse } from '../api'
import type { CategoryRow } from '../../shared/types'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import { auth } from '../store'

const props = defineProps<{ presetCategory?: number }>()
const router = useRouter()

const categories = ref<CategoryRow[]>([])
const categoryId = ref<number>(props.presetCategory ?? 0)
const title = ref('')
const body = ref('')
const error = ref('')
const submitting = ref(false)

onMounted(async () => {
  if (!auth.user) {
    await router.replace({ path: '/login', query: { next: '/new' } })
    return
  }
  try {
    categories.value = await http.get<CategoriesResponse>('/categories')
    if (!categoryId.value && categories.value.length) {
      categoryId.value = categories.value[0]!.id
    }
  } catch (err) {
    error.value = errMessage(err, '加载版块失败')
  }
})

async function submit(): Promise<void> {
  error.value = ''
  submitting.value = true
  try {
    const { id } = await http.post<IdResponse>('/threads', {
      categoryId: categoryId.value,
      title: title.value.trim(),
      body: body.value.trim(),
    })
    await router.push(`/t/${id}`)
  } catch (err) {
    error.value = errMessage(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page" style="max-width: 720px">
    <h1>发表主题</h1>
    <p class="muted" style="margin: 8px 0 24px">
      标题让人一眼看懂问题，正文写清背景——别人复现得越快，你的帖回得越快。
    </p>

    <p v-if="error" class="form-error">{{ error }}</p>

    <form class="card card-pad" @submit.prevent="submit">
      <label class="field">
        <span>版块</span>
        <select v-model.number="categoryId" required>
          <option v-for="category in categories" :key="category.id" :value="category.id">
            {{ category.name }}
          </option>
        </select>
      </label>

      <label class="field">
        <span>标题</span>
        <input
          v-model="title"
          type="text"
          maxlength="200"
          required
          placeholder="一句话说清你的问题"
        />
      </label>

      <div class="field">
        <span>正文</span>
        <MarkdownEditor
          v-model="body"
          :rows="12"
          placeholder="发生了什么？你期待的结果是什么？"
        />
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 10px">
        <router-link to="/" class="btn">取消</router-link>
        <button class="btn btn-primary" type="submit" :disabled="submitting">
          {{ submitting ? '提交中…' : '发表主题' }}
        </button>
      </div>
    </form>
  </div>
</template>
