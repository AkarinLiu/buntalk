<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { errMessage, http, uploadFile } from '../api'
import type { ProfileResponse, ThreadsResponse } from '../api'
import type { PublicUser, ThreadRow } from '../../shared/types'
import { auth } from '../store'
import UserAvatar from '../components/UserAvatar.vue'

const props = defineProps<{ username: string }>()

const user = ref<PublicUser | null>(null)
const threadCount = ref(0)
const postCount = ref(0)
const threads = ref<ThreadRow[]>([])
const loading = ref(true)
const error = ref('')
const notice = ref('')

const editing = ref(false)
const displayName = ref('')
const bio = ref('')
const avatarUrl = ref('')
const avatarPicker = ref<HTMLInputElement | null>(null)
const uploadingAvatar = ref(false)

function isSelf(): boolean {
  return !!auth.user && !!user.value && auth.user.id === user.value.id
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    const profile = await http.get<ProfileResponse>(`/users/${encodeURIComponent(props.username)}`)
    user.value = profile.user
    threadCount.value = profile.threadCount
    postCount.value = profile.postCount
    displayName.value = profile.user.displayName
    bio.value = profile.user.bio
    avatarUrl.value = profile.user.avatarUrl
    editing.value = false
    threads.value = await http.get<ThreadsResponse>(
      `/users/${encodeURIComponent(props.username)}/threads`,
    )
  } catch (err) {
    error.value = errMessage(err, '用户不存在')
  } finally {
    loading.value = false
  }
}

onMounted(() => void load())
watch(
  () => props.username,
  () => void load(),
)

async function saveProfile(): Promise<void> {
  error.value = ''
  try {
    const { user: updated } = await http.patch<{ user: PublicUser }>('/users/me', {
      displayName: displayName.value.trim(),
      bio: bio.value.trim(),
      avatarUrl: avatarUrl.value.trim(),
    })
    auth.user = updated
    user.value = updated
    editing.value = false
    notice.value = '资料已更新'
  } catch (err) {
    error.value = errMessage(err)
  }
}

async function onAvatarPick(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  uploadingAvatar.value = true
  error.value = ''
  try {
    const { url } = await uploadFile(file)
    // Only fills the field; the form still has to be saved, so an accidental
    // pick is undoable.
    avatarUrl.value = url
  } catch (err) {
    error.value = errMessage(err, '上传失败')
  } finally {
    uploadingAvatar.value = false
  }
}

async function togglePinned(thread: ThreadRow): Promise<void> {
  try {
    await http.patch(`/admin/threads/${thread.id}`, { isPinned: !thread.isPinned })
    thread.isPinned = !thread.isPinned
  } catch (err) {
    notice.value = errMessage(err)
  }
}

async function removeThread(thread: ThreadRow): Promise<void> {
  if (!window.confirm(`删除主题「${thread.title}」及其全部回复？此操作不可撤销。`)) return
  try {
    await http.del(`/threads/${thread.id}`)
    threads.value = threads.value.filter((t) => t.id !== thread.id)
    threadCount.value = Math.max(0, threadCount.value - 1)
  } catch (err) {
    notice.value = errMessage(err)
  }
}

const time = (iso: string) => iso.replace('T', ' ').slice(0, 16)
const joined = (iso: string) => iso.slice(0, 10)
</script>

<template>
  <div class="page">
    <p v-if="error" class="form-error">{{ error }}</p>
    <div v-else-if="loading" class="empty">加载中…</div>

    <template v-else-if="user">
      <p v-if="notice" class="form-ok">{{ notice }}</p>

      <section class="card card-pad profile-head">
        <UserAvatar :user="user" :size="64" />

        <div class="profile-id">
          <h1 style="font-size: 24px">{{ user.displayName }}</h1>
          <div class="muted" style="margin-top: 4px">
            @{{ user.username }}
            <span v-if="user.role === 'admin'" class="pill pill-accent" style="margin-left: 6px">
              管理员
            </span>
          </div>
          <p v-if="user.bio" class="profile-bio">{{ user.bio }}</p>
          <p v-else class="faint" style="margin: 10px 0 0; font-size: 14px">这个人很懒，什么都没写。</p>
          <div class="faint" style="margin-top: 8px; font-size: 13px">
            加入于 {{ joined(user.createdAt) }}
          </div>
        </div>

        <div class="profile-stats">
          <div>
            <b>{{ threadCount }}</b>
            <span>主题</span>
          </div>
          <div>
            <b>{{ postCount }}</b>
            <span>回复</span>
          </div>
          <div v-if="isSelf()">
            <button class="btn btn-sm" type="button" @click="editing = !editing">
              {{ editing ? '取消编辑' : '编辑资料' }}
            </button>
          </div>
        </div>
      </section>

      <form
        v-if="editing && isSelf()"
        class="card card-pad"
        style="margin-top: 16px"
        @submit.prevent="saveProfile"
      >
        <label class="field">
          <span>昵称</span>
          <input v-model="displayName" type="text" maxlength="32" required />
        </label>
        <label class="field">
          <span>简介</span>
          <textarea v-model="bio" rows="3" maxlength="500" placeholder="介绍一下自己"></textarea>
        </label>
        <div class="field">
          <span>头像</span>
          <div class="avatar-row">
            <input
              v-model="avatarUrl"
              type="url"
              maxlength="512"
              placeholder="https://… 或上传一张"
            />
            <button
              class="btn btn-sm"
              type="button"
              :disabled="uploadingAvatar"
              @click="avatarPicker?.click()"
            >
              {{ uploadingAvatar ? '上传中…' : '上传' }}
            </button>
            <input
              ref="avatarPicker"
              class="hidden-file"
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
              @change="onAvatarPick"
            />
          </div>
        </div>
        <div style="display: flex; justify-content: flex-end">
          <button class="btn btn-primary" type="submit">保存</button>
        </div>
      </form>

      <section style="margin-top: 28px">
        <div class="toolbar">
          <h2>{{ isSelf() ? '我发表的主题' : 'TA 发表的主题' }}</h2>
        </div>

        <div v-if="!threads.length" class="empty">还没有发表过主题。</div>

        <div v-else class="thread-list">
          <div v-for="thread in threads" :key="thread.id" class="thread-row">
            <div class="thread-main">
              <div class="thread-title">
                <span v-if="thread.isPinned" class="pill pill-accent">置顶</span>
                <span v-if="thread.isLocked" class="pill pill-danger">锁定</span>
                <router-link :to="`/t/${thread.id}`">{{ thread.title }}</router-link>
              </div>
              <div class="thread-sub">最新活动 {{ time(thread.lastPostAt) }}</div>
            </div>

            <div class="count">
              <b>{{ thread.postCount ?? 0 }}</b>
              回复
            </div>

            <div v-if="auth.user?.role === 'admin'" class="row-actions">
              <button class="btn btn-ghost btn-sm" type="button" @click="togglePinned(thread)">
                {{ thread.isPinned ? '取消置顶' : '置顶' }}
              </button>
              <button class="btn btn-danger btn-sm" type="button" @click="removeThread(thread)">
                删除
              </button>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
