<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { http } from '../api'
import type { CategoriesResponse } from '../api'
import type { CategoryRow } from '../../shared/types'
import { auth } from '../store'

defineProps<{ open: boolean }>()

const categories = ref<CategoryRow[]>([])

const topCategories = computed(() => categories.value.filter((c) => c.parentId === null))
const childrenOf = (id: number) => categories.value.filter((c) => c.parentId === id)

onMounted(async () => {
  try {
    categories.value = await http.get<CategoriesResponse>('/categories')
  } catch {
    // Navigation is non-critical — an empty list just hides the 版块 section.
  }
})
</script>

<template>
  <aside class="sidenav" :class="{ open }" aria-label="侧边菜单">
    <nav class="side-nav">
      <router-link to="/" class="side-link">
        <span class="side-ico" aria-hidden="true">◆</span>论坛首页
      </router-link>
      <router-link v-if="auth.user" to="/new" class="side-link">
        <span class="side-ico" aria-hidden="true">✎</span>发表主题
      </router-link>
      <router-link v-if="auth.user" to="/messages" class="side-link">
        <span class="side-ico" aria-hidden="true">✉</span>私信
      </router-link>
      <router-link v-if="auth.user" to="/drafts" class="side-link">
        <span class="side-ico" aria-hidden="true">▤</span>草稿箱
      </router-link>
      <router-link v-if="auth.user?.role === 'admin'" to="/admin" class="side-link">
        <span class="side-ico" aria-hidden="true">⚙</span>管理后台
      </router-link>

      <div class="side-heading">版块</div>

      <template v-for="category in topCategories" :key="category.id">
        <router-link :to="`/c/${category.id}`" class="side-link">
          <span class="side-ico" aria-hidden="true">#</span>
          <span class="side-name">{{ category.name }}</span>
          <span class="side-count">{{ category.threadCount ?? 0 }}</span>
        </router-link>
        <router-link
          v-for="child in childrenOf(category.id)"
          :key="child.id"
          :to="`/c/${child.id}`"
          class="side-link side-link-child"
        >
          <span class="side-name">{{ child.name }}</span>
          <span class="side-count">{{ child.threadCount ?? 0 }}</span>
        </router-link>
      </template>

      <p v-if="!topCategories.length" class="side-empty">暂无版块</p>
    </nav>
  </aside>
</template>
