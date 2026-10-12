<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errMessage, http } from '../api'
import type { DraftsResponse } from '../api'
import type { DraftRow } from '../../shared/types'
import { auth } from '../store'

const router = useRouter()

const drafts = ref<DraftRow[]>([])
const loading = ref(true)
const error = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    drafts.value = await http.get<DraftsResponse>('/drafts')
  } catch (err) {
    error.value = errMessage(err, '加载失败')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  if (!auth.user) {
    await router.replace({ path: '/login', query: { next: '/drafts' } })
    return
  }
  await load()
})

async function remove(draft: DraftRow): Promise<void> {
  if (!window.confirm(`删除草稿「${draft.title || '（无标题）'}」？此操作不可撤销。`)) return
  try {
    await http.del(`/drafts/${draft.id}`)
    drafts.value = drafts.value.filter((d) => d.id !== draft.id)
  } catch (err) {
    error.value = errMessage(err)
  }
}

const time = (iso: string) => iso.replace('T', ' ').slice(0, 16)
const preview = (body: string) => body.replace(/\s+/g, ' ').trim().slice(0, 80)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <div>
        <h1>草稿箱</h1>
        <p class="muted" style="margin: 6px 0 0">未发表的主题会保存在这里，只有你能看到。</p>
      </div>
      <span class="spacer"></span>
      <router-link to="/new" class="btn btn-primary btn-sm">新建主题</router-link>
    </div>

    <p v-if="error" class="form-error">{{ error }}</p>
    <div v-if="loading" class="empty">加载中…</div>
    <div v-else-if="!drafts.length" class="empty">还没有草稿。在发表页点「存草稿」即可保存。</div>

    <div v-else class="thread-list">
      <div v-for="draft in drafts" :key="draft.id" class="thread-row">
        <div class="thread-main">
          <div class="thread-title">
            <router-link :to="`/new?draft=${draft.id}`">
              {{ draft.title || '（无标题）' }}
            </router-link>
          </div>
          <div class="thread-sub">
            {{ draft.categoryName || '未选择版块' }} · 最后编辑 {{ time(draft.updatedAt) }}
          </div>
          <div v-if="draft.body" class="faint" style="font-size: 13px; margin-top: 4px">
            {{ preview(draft.body) }}
          </div>
        </div>

        <div class="row-actions">
          <router-link class="btn btn-sm" :to="`/new?draft=${draft.id}`">继续编辑</router-link>
          <button class="btn btn-danger btn-sm" type="button" @click="remove(draft)">删除</button>
        </div>
      </div>
    </div>
  </div>
</template>
