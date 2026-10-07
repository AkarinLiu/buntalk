<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'reka-ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { errMessage, http } from '../api'
import type { LikeResponse, ThreadDetailResponse } from '../api'
import type { PostRow, ThreadRow } from '../../shared/types'
import ConfirmDialog from '../components/ConfirmDialog.vue'
import MarkdownEditor from '../components/MarkdownEditor.vue'
import PostItem from '../components/PostItem.vue'
import ReportDialog from '../components/ReportDialog.vue'
import TagList from '../components/TagList.vue'
import { buildPostTree } from '../postTree'
import { auth } from '../store'

const props = defineProps<{ id: string }>()
const router = useRouter()

const thread = ref<ThreadRow | null>(null)
const posts = ref<PostRow[]>([])
const loading = ref(true)
const error = ref('')
const notice = ref('')

const replyBody = ref('')
const replyTarget = ref<number | null>(null)
// Component ref: MarkdownEditor exposes `focus()` rather than being a textarea.
const replyBox = ref<{ focus: () => void } | null>(null)

const confirmPostId = ref<number | null>(null)
const confirmThreadDelete = ref(false)

const reportTarget = ref<{ type: 'thread' | 'post'; id: number; label?: string } | null>(null)
const reportNotice = ref('')

const isAdmin = computed(() => auth.user?.role === 'admin')
const tree = computed(() => buildPostTree(posts.value))
/** The opening post — the default target for a reply to the thread itself. */
const opId = computed(() => posts.value.find((p) => p.parentId === null)?.id ?? null)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const data = await http.get<ThreadDetailResponse>(`/threads/${Number(props.id)}`)
    thread.value = data.thread
    posts.value = data.posts
  } catch (err) {
    error.value = errMessage(err, '主题不存在或已被删除')
  } finally {
    loading.value = false
  }
}

onMounted(() => void load().then(recordView))
watch(
  () => props.id,
  () => void load().then(recordView),
)

/**
 * View beacon: fires once per page open, after the detail load so the shown
 * count is the post-increment one. Reloads after a reply/delete skip it.
 */
async function recordView(): Promise<void> {
  try {
    const { viewCount } = await http.post<{ viewCount: number }>(
      `/threads/${Number(props.id)}/view`,
    )
    if (thread.value) thread.value.viewCount = viewCount
  } catch {
    // a failed beacon is not worth surfacing to the reader
  }
}

async function onLike(postId: number): Promise<void> {
  if (!auth.user) return
  try {
    const result = await http.post<LikeResponse>(`/posts/${postId}/like`)
    const target = posts.value.find((p) => p.id === postId)
    if (target) {
      target.likedByMe = result.liked
      target.likeCount = result.likeCount
    }
  } catch (err) {
    notice.value = errMessage(err)
  }
}

function startReply(postId: number): void {
  replyTarget.value = postId
  void replyBox.value?.focus()
}

async function submitReply(): Promise<void> {
  const body = replyBody.value.trim()
  const parentId = replyTarget.value ?? opId.value
  if (!body || !parentId) return
  try {
    await http.post(`/threads/${props.id}/posts`, { parentId, body })
    replyBody.value = ''
    replyTarget.value = null
    await load()
    notice.value = ''
  } catch (err) {
    notice.value = errMessage(err)
  }
}

async function deleteConfirmedPost(): Promise<void> {
  const postId = confirmPostId.value
  confirmPostId.value = null
  if (!postId) return
  try {
    await http.del(`/posts/${postId}`)
    if (replyTarget.value === postId) replyTarget.value = null
    await load()
  } catch (err) {
    notice.value = errMessage(err)
  }
}

async function deleteThread(): Promise<void> {
  confirmThreadDelete.value = false
  try {
    await http.del(`/threads/${props.id}`)
    await router.push(`/c/${thread.value?.categoryId ?? ''}`)
  } catch (err) {
    notice.value = errMessage(err)
  }
}

async function setFlag(flag: 'isPinned' | 'isGlobalPinned' | 'isAllBoardsPinned' | 'isLocked', value: boolean): Promise<void> {
  if (!thread.value) return
  try {
    await http.patch(`/admin/threads/${thread.value.id}`, { [flag]: value })
    thread.value[flag] = value
  } catch (err) {
    notice.value = errMessage(err)
  }
}

// Handlers for the template: Vue compiles templates as plain JS, so a TS
// annotation on an inline arrow (`(v: boolean) => ...`) would not survive, and
// keeping these named makes the ref assignment explicit rather than relying on
// template auto-unwrapping.
const onPinned = (value: boolean): void => void setFlag('isPinned', value)
const onGlobalPinned = (value: boolean): void => void setFlag('isGlobalPinned', value)
const onAllBoardsPinned = (value: boolean): void => void setFlag('isAllBoardsPinned', value)
const onLocked = (value: boolean): void => void setFlag('isLocked', value)
const askDeletePost = (postId: number): void => {
  confirmPostId.value = postId
}

function askReportPost(postId: number): void {
  const post = posts.value.find((p) => p.id === postId)
  reportTarget.value = { type: 'post', id: postId, label: post?.body.slice(0, 40) }
}

function onReported(): void {
  reportNotice.value = '举报已提交，管理员会尽快处理。'
}

const time = (iso: string) => iso.replace('T', ' ').slice(0, 16)
</script>

<template>
  <div class="page">
    <router-link :to="`/c/${thread?.categoryId ?? ''}`" class="faint" style="font-size: 13.5px">
      ← 返回版块
    </router-link>

    <p v-if="error" class="form-error" style="margin-top: 16px">{{ error }}</p>
    <div v-else-if="loading && !thread" class="empty" style="margin-top: 16px">加载中…</div>

    <template v-else-if="thread">
      <div class="toolbar" style="margin-top: 16px; align-items: flex-start">
        <div style="min-width: 0">
          <h1 style="font-size: 26px">{{ thread.title }}</h1>
          <div class="thread-sub" style="margin-top: 8px">
            <span v-if="thread.isGlobalPinned" class="pill pill-global">全站置顶</span>
            <span v-if="thread.isAllBoardsPinned" class="pill pill-accent">全板块置顶</span>
            <span v-if="thread.isPinned" class="pill">置顶</span>
            <span v-if="thread.isLocked" class="pill pill-danger">锁定</span>
            {{ thread.author?.displayName }} · {{ time(thread.createdAt) }} ·
            {{ thread.postCount ?? 0 }} 条回复 · {{ thread.viewCount }} 浏览
          </div>
          <TagList :tags="thread.tags" style="margin-top: 10px" />
        </div>
        <span class="spacer"></span>

        <button
          v-if="auth.user && auth.user.id !== thread.authorId"
          class="btn btn-ghost btn-sm"
          type="button"
          @click="reportTarget = { type: 'thread', id: thread.id, label: thread.title }"
        >
          举报主题
        </button>

        <template v-if="isAdmin">
          <label class="flag-toggle">
            <span>全站置顶</span>
            <SwitchRoot
              class="switch-root"
              :model-value="thread.isGlobalPinned"
              @update:model-value="onGlobalPinned"
            >
              <SwitchThumb class="switch-thumb" />
            </SwitchRoot>
          </label>
          <label class="flag-toggle">
            <span>全板块置顶</span>
            <SwitchRoot
              class="switch-root"
              :model-value="thread.isAllBoardsPinned"
              @update:model-value="onAllBoardsPinned"
            >
              <SwitchThumb class="switch-thumb" />
            </SwitchRoot>
          </label>
          <label class="flag-toggle">
            <span>置顶</span>
            <SwitchRoot class="switch-root" :model-value="thread.isPinned" @update:model-value="onPinned">
              <SwitchThumb class="switch-thumb" />
            </SwitchRoot>
          </label>
          <label class="flag-toggle">
            <span>锁定</span>
            <SwitchRoot class="switch-root" :model-value="thread.isLocked" @update:model-value="onLocked">
              <SwitchThumb class="switch-thumb" />
            </SwitchRoot>
          </label>
          <button class="btn btn-danger btn-sm" type="button" @click="confirmThreadDelete = true">
            删除主题
          </button>
        </template>
      </div>

      <p v-if="notice" class="form-error">{{ notice }}</p>
      <p v-if="reportNotice" class="form-ok">{{ reportNotice }}</p>

      <div class="card" style="overflow: hidden">
        <PostItem
          v-for="node in tree"
          :key="node.post.id"
          :node="node"
          @like="onLike"
          @reply="startReply"
          @remove="askDeletePost"
          @report="askReportPost"
        />
      </div>

      <section v-if="auth.user" class="card card-pad" style="margin-top: 20px">
        <div class="toolbar" style="margin-bottom: 12px">
          <h3>{{ replyTarget ? `回复 #${replyTarget}` : '回复主题' }}</h3>
          <span class="spacer"></span>
          <button
            v-if="replyTarget"
            class="btn btn-ghost btn-sm"
            type="button"
            @click="replyTarget = null"
          >
            改为回复主题
          </button>
        </div>
        <MarkdownEditor
          ref="replyBox"
          v-model="replyBody"
          :rows="5"
          :disabled="!!thread.isLocked && !isAdmin"
          placeholder="写下你的回复…"
        />
        <div style="display: flex; justify-content: flex-end; margin-top: 12px">
          <button
            class="btn btn-primary"
            type="button"
            :disabled="!replyBody.trim() || !!thread.isLocked && !isAdmin"
            @click="submitReply"
          >
            发表回复
          </button>
        </div>
      </section>

      <div v-else class="empty" style="margin-top: 20px">
        <router-link to="/login" class="btn">登录后参与讨论</router-link>
      </div>
    </template>

    <ConfirmDialog
      :open="confirmPostId !== null"
      title="删除回复"
      message="将删除该回复及其下的所有子回复，此操作不可撤销。"
      @cancel="confirmPostId = null"
      @confirm="deleteConfirmedPost"
    />

    <ConfirmDialog
      :open="confirmThreadDelete"
      title="删除主题"
      message="将删除整个主题及其全部回复，此操作不可撤销。"
      @cancel="confirmThreadDelete = false"
      @confirm="deleteThread"
    />

    <ReportDialog
      :open="reportTarget !== null"
      :target-type="reportTarget?.type ?? 'post'"
      :target-id="reportTarget?.id ?? 0"
      :target-label="reportTarget?.label"
      @close="reportTarget = null"
      @submitted="onReported"
    />
  </div>
</template>
