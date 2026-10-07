<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { http } from '../api'
import type { CategoriesResponse, ThreadsResponse } from '../api'
import type { CategoryRow, ThreadRow } from '../../shared/types'
import { auth } from '../store'
import TagList from '../components/TagList.vue'
import UserAvatar from '../components/UserAvatar.vue'

const props = defineProps<{ id: string }>()

const PAGE_SIZE = 20

const categories = ref<CategoryRow[]>([])
const category = ref<CategoryRow | null>(null)
const threads = ref<ThreadRow[]>([])
const loading = ref(true)
const error = ref('')
const hasMore = ref(false)

const parent = computed(() =>
  category.value?.parentId
    ? (categories.value.find((c) => c.id === category.value?.parentId) ?? null)
    : null,
)
const subCategories = computed(() =>
  categories.value.filter((c) => c.parentId === Number(props.id)),
)

async function load(reset: boolean): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const categoryId = Number(props.id)
    const [categoriesPage, page] = await Promise.all([
      http.get<CategoriesResponse>('/categories'),
      http.get<ThreadsResponse>(
        `/categories/${categoryId}/threads?limit=${PAGE_SIZE}&offset=${reset ? 0 : threads.value.length}`,
      ),
    ])
    categories.value = categoriesPage
    category.value = categoriesPage.find((c) => c.id === categoryId) ?? null
    threads.value = reset ? page : [...threads.value, ...page]
    hasMore.value = page.length === PAGE_SIZE
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => void load(true))
watch(
  () => props.id,
  () => void load(true),
)

const time = (iso: string) => iso.replace('T', ' ').slice(0, 16)
</script>

<template>
  <div class="page">
    <router-link :to="parent ? `/c/${parent.id}` : '/'" class="faint" style="font-size: 13.5px">
      ← 返回{{ parent ? ` ${parent.name}` : '版块' }}
    </router-link>

    <div class="toolbar" style="margin-top: 14px">
      <div>
        <h1>
          <span v-if="parent" class="faint" style="font-weight: 400">{{ parent.name }} / </span>
          {{ category?.name ?? '版块' }}
        </h1>
        <p class="muted" style="margin: 6px 0 0">{{ category?.description || '暂无简介' }}</p>
      </div>
      <span class="spacer"></span>
      <router-link
        v-if="auth.user"
        :to="`/new?category=${category?.id ?? ''}`"
        class="btn btn-primary"
      >
        发表主题
      </router-link>
    </div>

    <div v-if="subCategories.length" class="cat-list" style="margin-bottom: 22px">
      <router-link
        v-for="child in subCategories"
        :key="child.id"
        :to="`/c/${child.id}`"
        class="card cat-row"
      >
        <div class="cat-icon" aria-hidden="true">#</div>
        <div class="cat-main">
          <h3>{{ child.name }}</h3>
          <div class="cat-meta">{{ child.description || '暂无简介' }}</div>
        </div>
        <div class="count">
          <b>{{ child.threadCount ?? 0 }}</b>
          主题
        </div>
      </router-link>
    </div>

    <p v-if="error" class="form-error">{{ error }}</p>
    <div v-else-if="loading && !threads.length" class="empty">加载中…</div>

    <div v-else-if="!threads.length" class="empty">这个版块还没有主题。</div>

    <div v-else>
      <div class="thread-list">
        <div v-for="thread in threads" :key="thread.id" class="thread-row">
          <UserAvatar v-if="thread.author" :user="thread.author" :size="30" />

          <div class="thread-main">
            <div class="thread-title">
              <span v-if="thread.isGlobalPinned" class="pill pill-global">全站置顶</span>
              <span v-if="thread.isAllBoardsPinned" class="pill pill-accent">全板块置顶</span>
              <span v-if="thread.isPinned" class="pill">置顶</span>
              <span v-if="thread.isLocked" class="pill pill-danger">锁定</span>
              <router-link :to="`/t/${thread.id}`">{{ thread.title }}</router-link>
            </div>
            <div class="thread-sub">
              {{ thread.author?.displayName || '未知用户' }}
              <span class="hide-sm">· 发表于 {{ time(thread.createdAt) }} · 最新 {{ time(thread.lastPostAt) }} · {{ thread.viewCount }} 浏览</span>
            </div>
            <TagList :tags="thread.tags" />
          </div>

          <div class="count">
            <b>{{ thread.postCount ?? 0 }}</b>
            回复
          </div>
        </div>
      </div>

      <div v-if="hasMore" style="margin-top: 16px; text-align: center">
        <button class="btn" type="button" :disabled="loading" @click="load(false)">
          {{ loading ? '加载中…' : '加载更多' }}
        </button>
      </div>
    </div>
  </div>
</template>
