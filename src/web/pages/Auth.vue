<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { errMessage, http } from '../api'
import type { SessionResponse } from '../api'
import { auth } from '../store'

const props = defineProps<{ mode: 'login' | 'register' }>()
const route = useRoute()
const router = useRouter()

const isRegister = computed(() => props.mode === 'register')

const username = ref('')
const displayName = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)

// Switching between /login and /register keeps what was typed — retyping a
// username because the user decided to register instead is pure friction.
watch(
  () => props.mode,
  () => {
    error.value = ''
  },
)

async function submit(): Promise<void> {
  error.value = ''
  submitting.value = true
  try {
    const payload =
      props.mode === 'register'
        ? { username: username.value.trim(), password: password.value, displayName: displayName.value.trim() }
        : { username: username.value.trim(), password: password.value }

    const { user } = await http.post<SessionResponse>(
      props.mode === 'register' ? '/auth/register' : '/auth/login',
      payload,
    )
    auth.user = user

    const next = typeof route.query.next === 'string' ? route.query.next : '/'
    await router.push(next)
  } catch (err) {
    error.value = errMessage(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="page" style="max-width: 420px; margin: 0 auto">
    <h1>{{ isRegister ? '注册' : '登录' }}</h1>
    <p class="muted" style="margin: 8px 0 24px">
      {{ isRegister ? '第一个注册的账号会成为管理员。' : '欢迎回来。' }}
    </p>

    <p v-if="error" class="form-error">{{ error }}</p>

    <form class="card card-pad" @submit.prevent="submit">
      <label class="field">
        <span>用户名</span>
        <input
          v-model="username"
          type="text"
          autocomplete="username"
          maxlength="32"
          required
          placeholder="字母、数字、下划线或中文"
        />
      </label>

      <label v-if="isRegister" class="field">
        <span>昵称（可选）</span>
        <input v-model="displayName" type="text" maxlength="32" placeholder="默认与用户名相同" />
      </label>

      <label class="field">
        <span>密码{{ isRegister ? '（至少 8 位）' : '' }}</span>
        <input
          v-model="password"
          type="password"
          :autocomplete="isRegister ? 'new-password' : 'current-password'"
          :minlength="isRegister ? 8 : undefined"
          maxlength="200"
          required
        />
      </label>

      <button class="btn btn-primary" type="submit" style="width: 100%" :disabled="submitting">
        {{ submitting ? '请稍候…' : isRegister ? '创建账号' : '登录' }}
      </button>

      <p class="muted" style="margin: 16px 0 0; font-size: 14px; text-align: center">
        <template v-if="isRegister">
          已有账号？<router-link to="/login">去登录</router-link>
        </template>
        <template v-else>
          还没有账号？<router-link to="/register">去注册</router-link>
        </template>
      </p>
    </form>
  </div>
</template>
