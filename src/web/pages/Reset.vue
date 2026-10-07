<script setup lang="ts">
/**
 * Password reset via a mailed code. Three steps in one page: request a code,
 * enter it with a new password, done. The code is only ever issued to a
 * verified address (see `POST /auth/forgot-password`).
 */
import { ref } from 'vue'
import { errMessage, http } from '../api'
import type { ResetStartResponse } from '../api'

const step = ref<'start' | 'reset' | 'done'>('start')
const email = ref('')
const code = ref('')
const password = ref('')
const error = ref('')
const notice = ref('')
const busy = ref(false)

async function requestCode(): Promise<void> {
  error.value = ''
  notice.value = ''
  busy.value = true
  try {
    const res = await http.post<ResetStartResponse>('/auth/forgot-password', { email: email.value.trim() })
    if (!res.mailConfigured) {
      error.value = '本站未配置邮件，无法通过邮箱重置密码，请联系管理员。'
      return
    }
    step.value = 'reset'
    notice.value = '若该邮箱已绑定并验证，验证码已发送，15 分钟内有效。'
  } catch (err) {
    error.value = errMessage(err)
  } finally {
    busy.value = false
  }
}

async function submitReset(): Promise<void> {
  error.value = ''
  notice.value = ''
  busy.value = true
  try {
    await http.post('/auth/reset-password', {
      email: email.value.trim(),
      code: code.value.trim(),
      password: password.value,
    })
    step.value = 'done'
  } catch (err) {
    error.value = errMessage(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page" style="max-width: 420px; margin: 0 auto">
    <h1>重置密码</h1>
    <p class="muted" style="margin: 8px 0 24px">用绑定并验证过的邮箱接收验证码来重设密码。</p>

    <p v-if="error" class="form-error">{{ error }}</p>
    <p v-if="notice" class="form-ok">{{ notice }}</p>

    <form v-if="step === 'start'" class="card card-pad" @submit.prevent="requestCode">
      <label class="field">
        <span>邮箱</span>
        <input v-model="email" type="email" maxlength="254" required placeholder="you@example.com" />
      </label>
      <button class="btn btn-primary" type="submit" style="width: 100%" :disabled="busy">
        {{ busy ? '请稍候…' : '发送验证码' }}
      </button>
    </form>

    <form v-else-if="step === 'reset'" class="card card-pad" @submit.prevent="submitReset">
      <label class="field">
        <span>验证码</span>
        <input v-model="code" inputmode="numeric" maxlength="6" required placeholder="6 位验证码" />
      </label>
      <label class="field">
        <span>新密码（至少 8 位）</span>
        <input
          v-model="password"
          type="password"
          autocomplete="new-password"
          minlength="8"
          maxlength="200"
          required
        />
      </label>
      <button class="btn btn-primary" type="submit" style="width: 100%" :disabled="busy">
        {{ busy ? '提交中…' : '重置密码' }}
      </button>
    </form>

    <div v-else class="card card-pad">
      <p class="muted" style="margin: 0 0 16px">密码已重置，请用新密码登录。</p>
      <router-link to="/login" class="btn btn-primary" style="width: 100%">去登录</router-link>
    </div>

    <p class="muted" style="margin: 16px 0 0; font-size: 14px; text-align: center">
      <router-link to="/login">返回登录</router-link>
    </p>
  </div>
</template>
