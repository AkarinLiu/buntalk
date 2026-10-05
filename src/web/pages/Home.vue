<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { http } from '../api'
import type { CategoriesResponse } from '../api'
import type { CategoryRow } from '../../shared/types'
import { auth } from '../store'

const categories = ref<CategoryRow[]>([])
const loading = ref(true)
const error = ref('')

onMounted(async () => {
  try {
    categories.value = await http.get<CategoriesResponse>('/categories')
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="page">
    <section class="hero">
      <h1>论坛，<span class="hero-accent">快得像 Bun</span></h1>
      <p class="lead">
        bunbolt 是一个跑在 Bun + Hono 上的论坛框架，同一套代码支持 MySQL、PostgreSQL 和 SQLite。
      </p>
      <div class="terminal">
        <span class="prompt">$</span>
        <span>bun run dev</span>
      </div>
    </section>

    <section>
      <div class="toolbar">
        <h2>版块</h2>
        <span class="spacer"></span>
        <span class="muted" style="font-size: 13.5px">
          共 {{ categories.length }} 个版块
        </span>
      </div>

      <p v-if="error" class="form-error">{{ error }}</p>
      <div v-else-if="loading" class="empty">加载中…</div>

      <div v-else-if="!categories.length" class="empty">
        <p style="margin-bottom: 14px">还没有版块。</p>
        <router-link v-if="auth.user?.role === 'admin'" to="/admin" class="btn btn-primary">
          去后台创建第一个版块
        </router-link>
        <span v-else class="faint">管理员创建版块后即可发帖。</span>
      </div>

      <div v-else class="cat-list">
        <router-link
          v-for="category in categories"
          :key="category.id"
          :to="`/c/${category.id}`"
          class="card cat-row"
        >
          <div class="cat-icon" aria-hidden="true">#</div>
          <div class="cat-main">
            <h3>{{ category.name }}</h3>
            <div class="cat-meta">{{ category.description || '暂无简介' }}</div>
          </div>
          <div class="count">
            <b>{{ category.threadCount ?? 0 }}</b>
            主题
          </div>
        </router-link>
      </div>
    </section>
  </div>
</template>
