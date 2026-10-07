<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui'
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { auth, logout } from '../store'
import { setup } from '../setup'
import UserAvatar from './UserAvatar.vue'

const emit = defineEmits<{ toggleMenu: [] }>()

const router = useRouter()
const route = useRoute()
const q = ref(typeof route.query.q === 'string' ? route.query.q : '')

function onSearch(): void {
  const term = q.value.trim()
  void router.push(term ? { path: '/', query: { q: term } } : { path: '/' })
}

// Kept in script rather than an inline template expression: Vue templates are
// compiled as plain JS, so a TS non-null assertion (`auth.user!`) would not
// survive compilation.
function goProfile(): void {
  if (auth.user) void router.push(`/u/${auth.user.username}`)
}

async function onLogout(): Promise<void> {
  await logout()
  await router.push('/')
}
</script>

<template>
  <header class="site-header">
    <div class="header-inner">
      <button class="icon-btn" type="button" aria-label="切换侧边菜单" @click="emit('toggleMenu')">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <router-link to="/" class="brand">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
        </svg>
        {{ setup.siteName }}
      </router-link>

      <form class="header-search" role="search" @submit.prevent="onSearch">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input v-model="q" type="search" placeholder="搜索主题…" aria-label="搜索主题" />
      </form>

      <div class="header-right">
        <!-- Avoid a flash of "登录" while the session is still loading. -->
        <span v-if="!auth.loaded" class="header-skeleton" aria-hidden="true"></span>

        <template v-else-if="auth.user">
          <DropdownMenuRoot>
            <DropdownMenuTrigger class="avatar-btn" aria-label="账户菜单">
              <UserAvatar :user="auth.user" :size="30" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="menu-content" align="end">
                <DropdownMenuLabel class="menu-label">{{ auth.user.displayName }}</DropdownMenuLabel>
                <DropdownMenuItem class="menu-item" @select="goProfile">个人主页</DropdownMenuItem>
                <DropdownMenuSeparator class="menu-sep" />
                <DropdownMenuItem class="menu-item" @select="onLogout">退出登录</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </template>

        <template v-else>
          <router-link to="/login" class="btn btn-ghost btn-sm">登录</router-link>
          <router-link to="/register" class="btn btn-primary btn-sm">注册</router-link>
        </template>
      </div>
    </div>
  </header>
</template>
