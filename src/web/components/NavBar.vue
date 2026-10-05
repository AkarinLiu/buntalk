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
import { useRouter } from 'vue-router'
import { auth, logout } from '../store'
import UserAvatar from './UserAvatar.vue'

const router = useRouter()

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
    <div class="container">
      <router-link to="/" class="brand">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
        </svg>
        bunbolt
      </router-link>

      <nav class="nav-links">
        <router-link to="/">论坛</router-link>
        <router-link v-if="auth.user?.role === 'admin'" to="/admin">管理后台</router-link>
      </nav>

      <div class="header-right">
        <!-- Avoid a flash of "登录" while the session is still loading. -->
        <span v-if="!auth.loaded" class="header-skeleton" aria-hidden="true"></span>

        <template v-else-if="auth.user">
          <router-link to="/new" class="btn btn-primary btn-sm">发帖</router-link>
          <DropdownMenuRoot>
            <DropdownMenuTrigger class="avatar-btn" aria-label="账户菜单">
              <UserAvatar :user="auth.user" :size="28" />
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{{ auth.user.displayName }}</DropdownMenuLabel>
                <DropdownMenuItem @select="goProfile">个人主页</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem @select="onLogout">退出登录</DropdownMenuItem>
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
