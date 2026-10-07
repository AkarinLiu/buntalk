<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  SwitchRoot,
  SwitchThumb,
  TabsContent,
  TabsList,
  TabsRoot,
  TabsTrigger,
} from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { errMessage, http } from '../api'
import type { ReportsResponse, TagsResponse } from '../api'
import type { AdminUser, CategoryRow, ReportRow, Role, TagRow, ThreadRow } from '../../shared/types'
import { auth } from '../store'
import BanDialog from '../components/BanDialog.vue'
import UserAvatar from '../components/UserAvatar.vue'

const router = useRouter()

type UserRowWithCount = AdminUser

const loading = ref(true)
const loaded = ref(false)
const activeTab = ref('categories')
const error = ref('')

const categories = ref<CategoryRow[]>([])
const users = ref<UserRowWithCount[]>([])
const threads = ref<ThreadRow[]>([])
const tags = ref<TagRow[]>([])
const newTagName = ref('')

const reports = ref<ReportRow[]>([])
const reportFilter = ref<'open' | 'all'>('open')
const banTarget = ref<{ id: number; displayName: string } | null>(null)
const banReasonHint = ref('')

const mail = ref<{ configured: boolean; from: string }>({ configured: false, from: '' })
const mailTo = ref('')
const mailNotice = ref('')
const mailError = ref('')
const sendingTest = ref(false)

const openReportCount = computed(() => reports.value.filter((r) => r.status === 'open').length)
const visibleReports = computed(() =>
  reportFilter.value === 'open' ? reports.value.filter((r) => r.status === 'open') : reports.value,
)

// Category editor + destructive confirmations (the parent owns `open` state).
const catDialogOpen = ref(false)
const catForm = ref<{ id: number; name: string; description: string; position: number; parentId: number | null }>(
  { id: 0, name: '', description: '', position: 0, parentId: null },
)
const catDeleting = ref<CategoryRow | null>(null)
const threadDeleting = ref<ThreadRow | null>(null)

async function loadAll(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [c, u, t, g, r, m] = await Promise.all([
      http.get<CategoryRow[]>('/categories'),
      http.get<UserRowWithCount[]>('/admin/users'),
      http.get<ThreadRow[]>('/admin/threads?limit=100'),
      http.get<TagsResponse>('/tags'),
      http.get<ReportsResponse>('/admin/reports'),
      http.get<{ configured: boolean; from: string }>('/admin/mail'),
    ])
    categories.value = c
    users.value = u
    threads.value = t
    tags.value = g
    reports.value = r
    mail.value = m
  } catch (err) {
    error.value = errMessage(err, '加载失败')
  } finally {
    loading.value = false
    // Only the very first load gates the tabs; later reloads must not unmount
    // them, or the active 举报/用户 页签 jumps back to 版块.
    loaded.value = true
  }
}

/**
 * The session resolves after mount, so `onMounted` would still see
 * `auth.user === null`. Gate on `auth.loaded` instead so the admin-only fetch
 * only runs once the role is actually known.
 */
watch(
  () => auth.loaded,
  (loaded) => {
    if (!loaded) return
    if (auth.user?.role !== 'admin') {
      void router.replace('/')
      return
    }
    void loadAll()
  },
  { immediate: true },
)

// -------------------------------------------------------------- categories

function openCreateCat(): void {
  catForm.value = { id: 0, name: '', description: '', position: categories.value.length, parentId: null }
  catDialogOpen.value = true
}

function openEditCat(cat: CategoryRow): void {
  catForm.value = {
    id: cat.id,
    name: cat.name,
    description: cat.description,
    position: cat.position,
    parentId: cat.parentId,
  }
  catDialogOpen.value = true
}

/** Candidate parents for the current edit: top-level 版块, never itself. */
const parentOptions = computed(() =>
  categories.value.filter((c) => c.parentId === null && c.id !== catForm.value.id),
)
/** A 版块 with sub-forums has to stay top-level (single-level nesting). */
const catHasChildren = computed(() => categories.value.some((c) => c.parentId === catForm.value.id))

async function saveCat(): Promise<void> {
  const payload = {
    name: catForm.value.name.trim(),
    description: catForm.value.description.trim(),
    position: Number(catForm.value.position) || 0,
    parentId: catForm.value.parentId,
  }
  try {
    if (catForm.value.id) {
      await http.patch(`/admin/categories/${catForm.value.id}`, payload)
    } else {
      await http.post('/admin/categories', payload)
    }
    catDialogOpen.value = false
    await loadAll()
  } catch (err) {
    error.value = errMessage(err)
  }
}

async function confirmDeleteCat(): Promise<void> {
  const cat = catDeleting.value
  catDeleting.value = null
  if (!cat) return
  try {
    await http.del(`/admin/categories/${cat.id}`)
    await loadAll()
  } catch (err) {
    error.value = errMessage(err)
  }
}

// -------------------------------------------------------------------- tags

async function createTag(): Promise<void> {
  const name = newTagName.value.trim()
  if (!name) return
  try {
    await http.post('/admin/tags', { name })
    newTagName.value = ''
    await loadAll()
  } catch (err) {
    error.value = errMessage(err)
  }
}

async function deleteTag(tag: TagRow): Promise<void> {
  try {
    await http.del(`/admin/tags/${tag.id}`)
    tags.value = tags.value.filter((t) => t.id !== tag.id)
  } catch (err) {
    error.value = errMessage(err)
  }
}

// ----------------------------------------------------------------- reports

async function resolveReport(report: ReportRow, action: 'accept' | 'reject'): Promise<void> {
  try {
    await http.post(`/admin/reports/${report.id}/resolve`, { action })
    await loadAll()
  } catch (err) {
    error.value = errMessage(err)
  }
}

function banReportAuthor(report: ReportRow): void {
  if (report.targetAuthor) openBan(report.targetAuthor, report.reason)
}

// -------------------------------------------------------------------- mail

async function sendTestMail(): Promise<void> {
  mailNotice.value = ''
  mailError.value = ''
  sendingTest.value = true
  try {
    await http.post('/admin/mail-test', { to: mailTo.value.trim() })
    mailNotice.value = '测试邮件已发送，请查收。'
  } catch (err) {
    mailError.value = errMessage(err)
  } finally {
    sendingTest.value = false
  }
}

// -------------------------------------------------------------------- users

function openBan(user: { id: number; displayName: string }, reason = ''): void {
  banTarget.value = user
  banReasonHint.value = reason
}

async function unban(user: UserRowWithCount): Promise<void> {
  try {
    await http.patch(`/admin/users/${user.id}`, { banned: false })
    user.banned = false
    user.banReason = ''
    user.bannedUntil = null
  } catch (err) {
    error.value = errMessage(err)
  }
}

/** Credit moves in fixed steps; a drop can tip the account into an auto-ban. */
async function adjustCredit(user: UserRowWithCount, delta: number): Promise<void> {
  try {
    await http.patch(`/admin/users/${user.id}`, { creditDelta: delta })
    await loadAll()
  } catch (err) {
    error.value = errMessage(err)
  }
}

function onBanned(): void {
  const id = banTarget.value?.id
  banTarget.value = null
  // Flip the row immediately so the status updates even before the reload lands.
  const row = users.value.find((u) => u.id === id)
  if (row) row.banned = true
  void loadAll()
}

async function toggleRole(user: UserRowWithCount): Promise<void> {
  if (user.id === auth.user?.id) {
    error.value = '不能修改自己的角色'
    return
  }
  const role: Role = user.role === 'admin' ? 'user' : 'admin'
  try {
    await http.patch(`/admin/users/${user.id}`, { role })
    user.role = role
  } catch (err) {
    error.value = errMessage(err)
  }
}

// ------------------------------------------------------------------ threads

async function setThreadFlag(
  thread: ThreadRow,
  flag: 'isPinned' | 'isGlobalPinned' | 'isAllBoardsPinned' | 'isLocked',
  value: boolean,
): Promise<void> {
  try {
    await http.patch(`/admin/threads/${thread.id}`, { [flag]: value })
    thread[flag] = value
  } catch (err) {
    error.value = errMessage(err)
    // A rejected global pin (cap reached) leaves the switch out of sync.
    await loadAll()
  }
}

async function confirmDeleteThread(): Promise<void> {
  const thread = threadDeleting.value
  threadDeleting.value = null
  if (!thread) return
  try {
    await http.del(`/threads/${thread.id}`)
    threads.value = threads.value.filter((t) => t.id !== thread.id)
  } catch (err) {
    error.value = errMessage(err)
  }
}

// Named handlers: Vue compiles templates as plain JS, so a TS annotation in an
// inline arrow would not survive compilation.
const onCatDialogChange = (value: boolean): void => {
  catDialogOpen.value = value
}
const onCatDeleteChange = (value: boolean): void => {
  if (!value) catDeleting.value = null
}
const onThreadDeleteChange = (value: boolean): void => {
  if (!value) threadDeleting.value = null
}

const time = (iso: string) => iso.replace('T', ' ').slice(0, 16)
const parentName = (cat: CategoryRow): string =>
  cat.parentId ? (categories.value.find((c) => c.id === cat.parentId)?.name ?? '—') : '—'
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <div>
        <h1>管理后台</h1>
        <p class="muted" style="margin: 6px 0 0">版块、账号与主题的集中管理。</p>
      </div>
      <span class="spacer"></span>
      <button class="btn" type="button" :disabled="loading" @click="loadAll">刷新</button>
    </div>

    <p v-if="error" class="form-error">{{ error }}</p>

    <div v-if="!loaded" class="empty">加载中…</div>

    <TabsRoot v-else v-model="activeTab">
      <TabsList class="tabs-list">
        <TabsTrigger class="tabs-trigger" value="categories">版块</TabsTrigger>
        <TabsTrigger class="tabs-trigger" value="users">用户</TabsTrigger>
        <TabsTrigger class="tabs-trigger" value="threads">主题</TabsTrigger>
        <TabsTrigger class="tabs-trigger" value="tags">标签</TabsTrigger>
        <TabsTrigger class="tabs-trigger" value="reports">
          举报{{ openReportCount ? ' (' + openReportCount + ')' : '' }}
        </TabsTrigger>
        <TabsTrigger class="tabs-trigger" value="mail">邮件</TabsTrigger>
      </TabsList>

      <TabsContent value="categories">
        <div class="toolbar">
          <span class="muted" style="font-size: 14px">{{ categories.length }} 个版块</span>
          <span class="spacer"></span>
          <button class="btn btn-primary btn-sm" type="button" @click="openCreateCat">
            新建版块
          </button>
        </div>

        <div v-if="!categories.length" class="empty">还没有版块，先创建一个。</div>

        <div v-else class="card" style="overflow: hidden">
          <table class="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>父版块</th>
                <th>简介</th>
                <th>排序</th>
                <th>主题数</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="cat in categories" :key="cat.id">
                <td><b>{{ cat.name }}</b></td>
                <td class="muted">{{ parentName(cat) }}</td>
                <td class="muted">{{ cat.description || '—' }}</td>
                <td class="mono faint">{{ cat.position }}</td>
                <td class="mono">{{ cat.threadCount ?? 0 }}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-ghost btn-sm" type="button" @click="openEditCat(cat)">
                      编辑
                    </button>
                    <button class="btn btn-danger btn-sm" type="button" @click="catDeleting = cat">
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </TabsContent>

      <TabsContent value="users">
        <div class="toolbar">
          <span class="muted" style="font-size: 14px">{{ users.length }} 个账号</span>
        </div>

        <div v-if="!users.length" class="empty">还没有用户。</div>

        <div v-else class="card" style="overflow: hidden">
          <table class="table">
            <thead>
              <tr>
                <th>用户</th>
                <th>角色</th>
                <th>状态</th>
                <th>信用分</th>
                <th>回复</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in users" :key="user.id">
                <td>
                  <div style="display: flex; align-items: center; gap: 10px">
                    <UserAvatar :user="user" :size="26" />
                    <router-link :to="`/u/${user.username}`">
                      <b>{{ user.displayName }}</b>
                    </router-link>
                    <span class="faint" style="font-size: 13px">@{{ user.username }}</span>
                  </div>
                </td>
                <td>
                  <span :class="user.role === 'admin' ? 'pill pill-accent' : 'pill'">
                    {{ user.role === 'admin' ? '管理员' : '用户' }}
                  </span>
                </td>
                <td>
                  <span :class="user.banned ? 'pill pill-danger' : 'pill'">
                    {{ user.banned ? '已封禁' : '正常' }}
                  </span>
                  <div v-if="user.banned" class="faint" style="font-size: 12px; margin-top: 4px">
                    {{ user.banReason || '—' }}
                    {{ user.bannedUntil ? `· 至 ${time(user.bannedUntil)}` : '· 永久' }}
                  </div>
                </td>
                <td class="mono">{{ user.credit }}</td>
                <td class="mono">{{ user.postCount }}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-ghost btn-sm" type="button" @click="toggleRole(user)">
                      {{ user.role === 'admin' ? '降为用户' : '设为管理员' }}
                    </button>
                    <button class="btn btn-sm" type="button" @click="adjustCredit(user, -10)">
                      信用 -10
                    </button>
                    <button class="btn btn-sm" type="button" @click="adjustCredit(user, 10)">
                      信用 +10
                    </button>
                    <button v-if="user.banned" class="btn btn-sm" type="button" @click="unban(user)">
                      解封
                    </button>
                    <button
                      v-else
                      class="btn btn-danger btn-sm"
                      type="button"
                      :disabled="user.id === auth.user?.id"
                      @click="openBan(user)"
                    >
                      封禁
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </TabsContent>

      <TabsContent value="threads">
        <div class="toolbar">
          <span class="muted" style="font-size: 14px">最近 {{ threads.length }} 个主题</span>
        </div>

        <div v-if="!threads.length" class="empty">还没有主题。</div>

        <div v-else class="card" style="overflow: hidden">
          <table class="table">
            <thead>
              <tr>
                <th>标题</th>
                <th>作者</th>
                <th>回复</th>
                <th>状态</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="thread in threads" :key="thread.id">
                <td style="max-width: 320px">
                  <router-link :to="`/t/${thread.id}`"><b>{{ thread.title }}</b></router-link>
                  <div class="faint" style="font-size: 12.5px">
                    最新 {{ time(thread.lastPostAt) }}
                  </div>
                </td>
                <td class="muted">{{ thread.author?.displayName || '—' }}</td>
                <td class="mono">{{ thread.postCount ?? 0 }}</td>
                <td>
                  <span v-if="thread.isGlobalPinned" class="pill pill-global">全站置顶</span>
                  <span v-if="thread.isAllBoardsPinned" class="pill pill-accent">全板块置顶</span>
                  <span v-if="thread.isPinned" class="pill">置顶</span>
                  <span v-if="thread.isLocked" class="pill pill-danger">锁定</span>
                  <span
                    v-if="!thread.isGlobalPinned && !thread.isAllBoardsPinned && !thread.isPinned && !thread.isLocked"
                    class="faint"
                  >
                    正常
                  </span>
                </td>
                <td>
                  <div class="row-actions">
                    <label class="flag-toggle">
                      <span>全站</span>
                      <SwitchRoot
                        class="switch-root"
                        :model-value="thread.isGlobalPinned"
                        @update:model-value="setThreadFlag(thread, 'isGlobalPinned', $event)"
                      >
                        <SwitchThumb class="switch-thumb" />
                      </SwitchRoot>
                    </label>
                    <label class="flag-toggle">
                      <span>全板块</span>
                      <SwitchRoot
                        class="switch-root"
                        :model-value="thread.isAllBoardsPinned"
                        @update:model-value="setThreadFlag(thread, 'isAllBoardsPinned', $event)"
                      >
                        <SwitchThumb class="switch-thumb" />
                      </SwitchRoot>
                    </label>
                    <label class="flag-toggle">
                      <span>置顶</span>
                      <SwitchRoot class="switch-root"
                        :model-value="thread.isPinned"
                        @update:model-value="setThreadFlag(thread, 'isPinned', $event)"
                      >
                        <SwitchThumb class="switch-thumb" />
                      </SwitchRoot>
                    </label>
                    <label class="flag-toggle">
                      <span>锁定</span>
                      <SwitchRoot class="switch-root"
                        :model-value="thread.isLocked"
                        @update:model-value="setThreadFlag(thread, 'isLocked', $event)"
                      >
                        <SwitchThumb class="switch-thumb" />
                      </SwitchRoot>
                    </label>
                    <button
                      class="btn btn-danger btn-sm"
                      type="button"
                      @click="threadDeleting = thread"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </TabsContent>

      <TabsContent value="tags">
        <div class="toolbar">
          <span class="muted" style="font-size: 14px">{{ tags.length }} 个标签</span>
          <span class="spacer"></span>
          <form class="tag-create" @submit.prevent="createTag">
            <input v-model="newTagName" type="text" maxlength="30" placeholder="新标签名" />
            <button class="btn btn-primary btn-sm" type="submit">添加</button>
          </form>
        </div>

        <div v-if="!tags.length" class="empty">还没有标签，先添加一个。</div>

        <div v-else class="card" style="overflow: hidden">
          <table class="table">
            <thead>
              <tr>
                <th>名称</th>
                <th>主题数</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="tag in tags" :key="tag.id">
                <td><span class="tag-pill">{{ tag.name }}</span></td>
                <td class="mono">{{ tag.threadCount ?? 0 }}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-danger btn-sm" type="button" @click="deleteTag(tag)">
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </TabsContent>

      <TabsContent value="reports">
        <div class="toolbar">
          <div class="md-tabs">
            <button
              class="md-tab"
              :class="{ active: reportFilter === 'open' }"
              type="button"
              @click="reportFilter = 'open'"
            >
              待处理 ({{ openReportCount }})
            </button>
            <button
              class="md-tab"
              :class="{ active: reportFilter === 'all' }"
              type="button"
              @click="reportFilter = 'all'"
            >
              全部
            </button>
          </div>
        </div>

        <div v-if="!visibleReports.length" class="empty">没有举报。</div>

        <div v-else class="card" style="overflow: hidden">
          <table class="table">
            <thead>
              <tr>
                <th>对象</th>
                <th>被举报人</th>
                <th>举报人</th>
                <th>理由</th>
                <th>状态</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="report in visibleReports" :key="report.id">
                <td style="max-width: 280px">
                  <router-link v-if="report.targetThreadId" :to="`/t/${report.targetThreadId}`">
                    <b>{{ report.targetLabel }}</b>
                  </router-link>
                  <span v-else class="muted">{{ report.targetLabel }}</span>
                  <div class="faint" style="font-size: 12px">
                    {{ report.targetType === 'thread' ? '主题' : '回复' }} · {{ time(report.createdAt) }}
                  </div>
                </td>
                <td class="muted">
                  <router-link v-if="report.targetAuthor" :to="`/u/${report.targetAuthor.username}`">
                    {{ report.targetAuthor.displayName }}
                  </router-link>
                  <span v-else class="faint">—</span>
                </td>
                <td class="muted">
                  <router-link v-if="report.reporter" :to="`/u/${report.reporter.username}`">
                    {{ report.reporter.displayName }}
                  </router-link>
                </td>
                <td class="muted" style="max-width: 260px">{{ report.reason }}</td>
                <td>
                  <span v-if="report.status === 'accepted'" class="pill pill-danger">已采纳</span>
                  <span v-else-if="report.status === 'rejected'" class="pill">已驳回</span>
                  <span v-else class="pill pill-accent">待处理</span>
                </td>
                <td>
                  <div v-if="report.status === 'open'" class="row-actions">
                    <button class="btn btn-sm" type="button" @click="resolveReport(report, 'accept')">
                      采纳
                    </button>
                    <button class="btn btn-ghost btn-sm" type="button" @click="resolveReport(report, 'reject')">
                      驳回
                    </button>
                    <button
                      v-if="report.targetAuthor"
                      class="btn btn-danger btn-sm"
                      type="button"
                      @click="banReportAuthor(report)"
                    >
                      封禁
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </TabsContent>

      <TabsContent value="mail">
        <div class="card card-pad" style="max-width: 560px">
          <h3>SMTP 发信</h3>
          <p class="muted" style="margin: 8px 0 16px; font-size: 14px">
            配置 <span class="mono">SMTP_HOST</span>、<span class="mono">SMTP_PORT</span>、
            <span class="mono">SMTP_USER</span>、<span class="mono">SMTP_PASS</span>、
            <span class="mono">SMTP_FROM</span> 后重启服务即可。
            当前状态：
            <b>{{ mail.configured ? '已配置' : '未配置' }}</b>
            <span v-if="mail.configured" class="faint">（发件人 {{ mail.from }}）</span>
          </p>

          <p v-if="mailNotice" class="form-ok">{{ mailNotice }}</p>
          <p v-if="mailError" class="form-error">{{ mailError }}</p>

          <form class="toolbar" style="margin: 0" @submit.prevent="sendTestMail">
            <input
              v-model="mailTo"
              type="email"
              placeholder="收件邮箱"
              style="max-width: 260px"
            />
            <button
              class="btn btn-primary"
              type="submit"
              :disabled="sendingTest || !mailTo.trim() || !mail.configured"
            >
              {{ sendingTest ? '发送中…' : '发送测试邮件' }}
            </button>
          </form>
          <p v-if="!mail.configured" class="faint" style="font-size: 12.5px; margin-top: 10px">
            未配置 SMTP 时无法发送测试邮件。
          </p>
        </div>
      </TabsContent>

    </TabsRoot>

    <!-- create / edit a category -->
    <DialogRoot :open="catDialogOpen" @update:open="onCatDialogChange">
      <DialogPortal>
        <DialogOverlay class="dialog-overlay" />
        <DialogContent class="dialog-content">
          <DialogTitle class="dialog-title">
            {{ catForm.id ? '编辑版块' : '新建版块' }}
          </DialogTitle>
          <DialogDescription class="dialog-desc">
            版块是主题的一级分类，排序号越小越靠前。
          </DialogDescription>

          <form @submit.prevent="saveCat">
            <label class="field">
              <span>名称</span>
              <input v-model="catForm.name" type="text" maxlength="50" required />
            </label>
            <label class="field">
              <span>父版块</span>
              <select v-model.number="catForm.parentId" :disabled="catHasChildren">
                <option :value="null">无（顶级版块）</option>
                <option v-for="opt in parentOptions" :key="opt.id" :value="opt.id">
                  {{ opt.name }}
                </option>
              </select>
              <span v-if="catHasChildren" class="faint" style="font-size: 12px">
                该版块下有子版块，不能移动到其他版块下。
              </span>
            </label>
            <label class="field">
              <span>简介</span>
              <textarea v-model="catForm.description" rows="2" maxlength="500"></textarea>
            </label>
            <label class="field">
              <span>排序</span>
              <input v-model.number="catForm.position" type="number" min="0" />
            </label>
            <div class="dialog-actions">
              <button class="btn" type="button" @click="catDialogOpen = false">取消</button>
              <button class="btn btn-primary" type="submit">保存</button>
            </div>
          </form>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <!-- delete a category -->
    <DialogRoot :open="catDeleting !== null" @update:open="onCatDeleteChange">
      <DialogPortal>
        <DialogOverlay class="dialog-overlay" />
        <DialogContent class="dialog-content">
          <DialogTitle class="dialog-title">删除版块</DialogTitle>
          <DialogDescription class="dialog-desc">
            将删除「{{ catDeleting?.name }}」及其下所有主题与回复，此操作不可撤销。
          </DialogDescription>
          <div class="dialog-actions">
            <button class="btn" type="button" @click="catDeleting = null">取消</button>
            <button class="btn btn-danger" type="button" @click="confirmDeleteCat">
              确定删除
            </button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <!-- delete a thread -->
    <DialogRoot :open="threadDeleting !== null" @update:open="onThreadDeleteChange">
      <DialogPortal>
        <DialogOverlay class="dialog-overlay" />
        <DialogContent class="dialog-content">
          <DialogTitle class="dialog-title">删除主题</DialogTitle>
          <DialogDescription class="dialog-desc">
            将删除「{{ threadDeleting?.title }}」及其全部回复，此操作不可撤销。
          </DialogDescription>
          <div class="dialog-actions">
            <button class="btn" type="button" @click="threadDeleting = null">取消</button>
            <button class="btn btn-danger" type="button" @click="confirmDeleteThread">
              确定删除
            </button>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <BanDialog
      :open="banTarget !== null"
      :user-id="banTarget?.id ?? 0"
      :display-name="banTarget?.displayName ?? ''"
      :default-reason="banReasonHint"
      @close="banTarget = null"
      @done="onBanned"
    />
  </div>
</template>
