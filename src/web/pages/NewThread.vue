<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errMessage, http } from '../api'
import type { CategoriesResponse, IdResponse, TagsResponse } from '../api'
import type { CategoryRow, DraftRow, TagRow } from '../../shared/types'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import { auth } from '../store'

const props = defineProps<{ presetCategory?: number }>()
const route = useRoute()
const router = useRouter()

const categories = ref<CategoryRow[]>([])
const tags = ref<TagRow[]>([])
const categoryId = ref<number>(props.presetCategory ?? 0)
const selectedTags = ref<number[]>([])
const title = ref('')
const body = ref('')
const error = ref('')
const notice = ref('')
const submitting = ref(false)
const savingDraft = ref(false)
/** 0 until the draft is saved; then it is updated in place, not duplicated. */
const draftId = ref(0)

/** Top-level 版块 each followed by its 子版块, so the select reads as a tree. */
const categoryOptions = computed(() => {
  const out: CategoryRow[] = []
  for (const top of categories.value.filter((c) => c.parentId === null)) {
    out.push(top)
    out.push(...categories.value.filter((c) => c.parentId === top.id))
  }
  return out
})

onMounted(async () => {
  if (!auth.user) {
    await router.replace({ path: '/login', query: { next: '/new' } })
    return
  }
  try {
    const [cats, allTags] = await Promise.all([
      http.get<CategoriesResponse>('/categories'),
      http.get<TagsResponse>('/tags'),
    ])
    categories.value = cats
    tags.value = allTags
    if (!categoryId.value && categoryOptions.value.length) {
      categoryId.value = categoryOptions.value[0]!.id
    }

    // Opened from the draft box: `?draft=<id>` loads it into the editor.
    const draftParam = Number(route.query.draft)
    if (Number.isInteger(draftParam) && draftParam > 0) {
      const draft = await http.get<DraftRow>(`/drafts/${draftParam}`)
      draftId.value = draft.id
      title.value = draft.title
      body.value = draft.body
      if (draft.categoryId) categoryId.value = draft.categoryId
    }
  } catch (err) {
    error.value = errMessage(err, '加载失败')
  }
})

function payload() {
  return {
    categoryId: categoryId.value || null,
    title: title.value.trim(),
    body: body.value.trim(),
  }
}

async function saveDraft(): Promise<void> {
  error.value = ''
  notice.value = ''
  const draft = payload()
  if (!draft.title && !draft.body) {
    error.value = '草稿不能为空'
    return
  }
  savingDraft.value = true
  try {
    if (draftId.value) await http.patch(`/drafts/${draftId.value}`, draft)
    else draftId.value = (await http.post<IdResponse>('/drafts', draft)).id
    notice.value = '草稿已保存'
  } catch (err) {
    error.value = errMessage(err)
  } finally {
    savingDraft.value = false
  }
}

async function submit(): Promise<void> {
  error.value = ''
  submitting.value = true
  try {
    const { id } = await http.post<IdResponse>('/threads', {
      ...payload(),
      tagIds: selectedTags.value,
      // Publishing consumes the draft server-side.
      draftId: draftId.value || undefined,
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
    <p v-if="notice" class="form-ok">{{ notice }}</p>

    <form class="card card-pad" @submit.prevent="submit">
      <label class="field">
        <span>版块</span>
        <select v-model.number="categoryId" required>
          <option v-for="category in categoryOptions" :key="category.id" :value="category.id">
            {{ category.parentId ? `— ${category.name}` : category.name }}
          </option>
        </select>
      </label>

      <div v-if="tags.length" class="field">
        <span>标签（可选，最多 10 个）</span>
        <div class="tag-picker">
          <label v-for="tag in tags" :key="tag.id" class="tag-choice">
            <input v-model="selectedTags" type="checkbox" :value="tag.id" />
            {{ tag.name }}
          </label>
        </div>
      </div>

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
        <button class="btn" type="button" :disabled="savingDraft" @click="saveDraft">
          {{ savingDraft ? '保存中…' : draftId ? '更新草稿' : '存草稿' }}
        </button>
        <button class="btn btn-primary" type="submit" :disabled="submitting">
          {{ submitting ? '提交中…' : '发表主题' }}
        </button>
      </div>
    </form>
  </div>
</template>
