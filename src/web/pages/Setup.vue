<script setup lang="ts">
/**
 * First-run wizard. Reached only while the install has no accounts (the router
 * guard enforces that); it collects everything and commits it in one request,
 * so an abandoned wizard leaves nothing half-created.
 */
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { errMessage, http } from '../api'
import type { SessionResponse } from '../api'
import { auth } from '../store'
import { setup } from '../setup'

const STEPS = ['站点信息', '管理员账号', '初始版块', '初始标签'] as const
const USERNAME_RE = /^[\p{L}\p{N}_]{2,32}$/u

const router = useRouter()

const step = ref(0)
const error = ref('')
const submitting = ref(false)

const siteName = ref(setup.siteName)
const siteDescription = ref(setup.siteDescription)

const username = ref('')
const displayName = ref('')
const password = ref('')

// One blank row to start; the list is always kept non-empty so there is a field
// to type into.
const categories = ref<string[]>([''])
const tags = ref<string[]>([''])

const adminValid = computed(
  () =>
    USERNAME_RE.test(username.value.trim()) &&
    password.value.length >= 8 &&
    displayName.value.trim().length <= 32,
)

const canNext = computed(() => (step.value === 1 ? adminValid.value : true))

// Template bindings are auto-unwrapped, so these receive the plain array (the
// ref's reactive value) — not the ref. Mutating it in place is reactive.
function addRow(list: string[]) {
  list.push('')
}

function removeRow(list: string[], index: number) {
  list.splice(index, 1)
  if (!list.length) list.push('')
}

const clean = (list: string[]) => list.map((n) => n.trim()).filter(Boolean)

async function submit(): Promise<void> {
  error.value = ''
  submitting.value = true
  try {
    const payload = {
      siteName: siteName.value.trim() || 'buntalk',
      siteDescription: siteDescription.value.trim(),
      username: username.value.trim(),
      displayName: displayName.value.trim(),
      password: password.value,
      categories: clean(categories.value),
      tags: clean(tags.value),
    }
    const { user } = await http.post<SessionResponse>('/setup', payload)
    // Unlatch the guard locally; refresh-cached it would otherwise bounce the
    // just-finished admin straight back to the wizard.
    setup.needed = false
    setup.siteName = payload.siteName
    setup.siteDescription = payload.siteDescription
    auth.user = user
    await router.push('/')
  } catch (err) {
    error.value = errMessage(err)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="setup-shell">
    <div class="card setup-card">
      <header class="setup-head">
        <span class="brand">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
          </svg>
          buntalk
        </span>
        <h1>初始化向导</h1>
        <p class="muted">第一次运行，用几步把站点搭起来。</p>
      </header>

      <ol class="steps">
        <li
          v-for="(label, i) in STEPS"
          :key="label"
          class="step-chip"
          :class="{ active: i === step, done: i < step }"
        >
          <span class="step-num">{{ i + 1 }}</span>{{ label }}
        </li>
      </ol>

      <p v-if="error" class="form-error">{{ error }}</p>

      <div v-if="step === 0">
        <label class="field">
          <span>站点名称</span>
          <input v-model="siteName" type="text" maxlength="50" placeholder="buntalk" />
        </label>
        <label class="field">
          <span>站点简介（可选）</span>
          <textarea
            v-model="siteDescription"
            maxlength="200"
            rows="3"
            style="min-height: 80px"
            placeholder="一句话介绍这个论坛"
          ></textarea>
        </label>
      </div>

      <div v-else-if="step === 1">
        <p class="muted" style="margin-bottom: 16px">这个账号会成为管理员，之后可以管理版块、用户与内容。</p>
        <label class="field">
          <span>用户名</span>
          <input
            v-model="username"
            type="text"
            autocomplete="username"
            maxlength="32"
            placeholder="字母、数字、下划线或中文"
          />
        </label>
        <label class="field">
          <span>昵称（可选）</span>
          <input v-model="displayName" type="text" maxlength="32" placeholder="默认与用户名相同" />
        </label>
        <label class="field">
          <span>密码（至少 8 位）</span>
          <input v-model="password" type="password" autocomplete="new-password" maxlength="200" />
        </label>
      </div>

      <div v-else-if="step === 2">
        <p class="muted" style="margin-bottom: 16px">创建几个初始版块，之后可在管理后台增删改。</p>
        <div v-for="(_, i) in categories" :key="i" class="name-row">
          <input v-model="categories[i]" type="text" maxlength="50" :placeholder="`版块 ${i + 1}`" />
          <button class="btn btn-ghost btn-sm" type="button" aria-label="删除" @click="removeRow(categories, i)">
            ✕
          </button>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" @click="addRow(categories)">＋ 添加版块</button>
      </div>

      <div v-else>
        <p class="muted" style="margin-bottom: 16px">标签用于给主题分类，可选。</p>
        <div v-for="(_, i) in tags" :key="i" class="name-row">
          <input v-model="tags[i]" type="text" maxlength="30" :placeholder="`标签 ${i + 1}`" />
          <button class="btn btn-ghost btn-sm" type="button" aria-label="删除" @click="removeRow(tags, i)">✕</button>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" @click="addRow(tags)">＋ 添加标签</button>
      </div>

      <footer class="setup-foot">
        <button v-if="step > 0" class="btn btn-ghost" type="button" @click="step--">上一步</button>
        <button
          v-if="step < STEPS.length - 1"
          class="btn btn-primary setup-next"
          type="button"
          :disabled="!canNext"
          @click="step++"
        >
          下一步
        </button>
        <button
          v-else
          class="btn btn-primary setup-next"
          type="button"
          :disabled="submitting || !adminValid"
          @click="submit"
        >
          {{ submitting ? '初始化中…' : '完成初始化' }}
        </button>
      </footer>
    </div>
  </div>
</template>
