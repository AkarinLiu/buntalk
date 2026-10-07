<script setup lang="ts">
/**
 * Self-contained email binding card, shared by the profile page and the forced
 * binding page. Reads and writes `auth.user` directly — the bound address lives
 * on the session user, never on the public profile.
 */
import { ref } from 'vue'
import { errMessage, http } from '../api'
import type { EmailBindResponse } from '../api'
import { auth } from '../store'
import { meta } from '../meta'

const input = ref(auth.user?.email ?? '')
const code = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')

/** Mirrors a response into the session so the card and the guard re-render. */
function apply(res: { email: string; emailVerified: boolean }): void {
  if (auth.user) {
    auth.user.email = res.email
    auth.user.emailVerified = res.emailVerified
  }
  input.value = res.email
}

async function save(): Promise<void> {
  error.value = ''
  notice.value = ''
  busy.value = true
  try {
    const res = await http.post<EmailBindResponse>('/users/me/email', { email: input.value.trim() })
    apply(res)
    notice.value = res.mailConfigured ? '验证码已发送，请查收邮箱' : '邮箱已保存（未验证）——本站未配置邮件'
  } catch (err) {
    error.value = errMessage(err)
  } finally {
    busy.value = false
  }
}

async function verify(): Promise<void> {
  error.value = ''
  notice.value = ''
  busy.value = true
  try {
    apply(await http.post<EmailBindResponse>('/users/me/email/verify', { code: code.value.trim() }))
    code.value = ''
    notice.value = '邮箱已验证'
  } catch (err) {
    error.value = errMessage(err)
  } finally {
    busy.value = false
  }
}

async function unbind(): Promise<void> {
  if (!window.confirm('解绑邮箱？解绑后将无法用邮箱登录或找回密码。')) return
  error.value = ''
  notice.value = ''
  busy.value = true
  try {
    apply(await http.del<{ email: string; emailVerified: boolean }>('/users/me/email'))
    code.value = ''
    notice.value = '邮箱已解绑'
  } catch (err) {
    error.value = errMessage(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="card card-pad">
    <div class="toolbar">
      <h2>邮箱</h2>
      <span class="spacer"></span>
      <span v-if="auth.user?.email" class="pill" :class="auth.user.emailVerified ? 'pill-accent' : ''">
        {{ auth.user.emailVerified ? '已验证' : '未验证' }}
      </span>
    </div>

    <p v-if="error" class="form-error" style="margin: 0 0 12px">{{ error }}</p>
    <p v-if="notice" class="form-ok" style="margin: 0 0 12px">{{ notice }}</p>

    <p v-if="auth.user?.email" class="muted" style="margin: 4px 0 12px">
      当前邮箱：<span class="mono">{{ auth.user.email }}</span>
    </p>
    <p v-else class="muted" style="margin: 4px 0 12px">绑定邮箱后，可用它登录、找回密码。</p>

    <div class="avatar-row">
      <input v-model="input" type="email" maxlength="254" placeholder="you@example.com" />
      <button class="btn" type="button" :disabled="busy" @click="save">
        {{ auth.user?.email ? '更换' : '绑定' }}
      </button>
    </div>

    <div
      v-if="meta.mailConfigured && auth.user?.email && !auth.user.emailVerified"
      class="avatar-row"
      style="margin-top: 10px"
    >
      <input v-model="code" inputmode="numeric" maxlength="6" placeholder="6 位验证码" />
      <button class="btn btn-primary" type="button" :disabled="busy" @click="verify">验证</button>
    </div>

    <p v-if="!meta.mailConfigured" class="faint" style="margin: 12px 0 0; font-size: 13px">
      本站未配置 SMTP，邮箱只能以未验证状态保存；配置邮件后即可发送验证码。
    </p>

    <div v-if="auth.user?.email" style="margin-top: 14px; display: flex; justify-content: flex-end">
      <button class="btn btn-danger btn-sm" type="button" :disabled="busy" @click="unbind">解绑邮箱</button>
    </div>
  </section>
</template>
