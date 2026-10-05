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
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { errMessage, http } from '../api'
import type { CategoryRow, PublicUser, Role, ThreadRow } from '../../shared/types'
import { auth } from '../store'
import UserAvatar from '../components/UserAvatar.vue'

const router = useRouter()

type UserRowWithCount = PublicUser & { postCount: number }

const loading = ref(true)
const error = ref('')

const categories = ref<CategoryRow[]>([])
const users = ref<UserRowWithCount[]>([])
const threads = ref<ThreadRow[]>([])

// Category editor + destructive confirmations (the parent owns `open` state).
const catDialogOpen = ref(false)
const catForm = ref({ id: 0, name: '', description: '', position: 0 })
const catDeleting = ref<CategoryRow | null>(null)
const threadDeleting = ref<ThreadRow | null>(null)

async function loadAll(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const [c, u, t] = await Promise.all([
      http.get<CategoryRow[]>('/categories'),
      http.get<UserRowWithCount[]>('/admin/users'),
      http.get<ThreadRow[]>('/admin/threads?limit=100'),
    ])
    categories.value = c
    users.value = u
    threads.value = t
  } catch (err) {
    error.value = errMessage(err, '加载失败')
  } finally {
    loading.value = false
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
  catForm.value = { id: 0, name: '', description: '', position: categories.value.length }
  catDialogOpen.value = true
}

function openEditCat(cat: CategoryRow): void {
  catForm.value = {
    id: cat.id,
    name: cat.name,
    description: cat.description,
    position: cat.position,
  }
  catDialogOpen.value = true
}

async function saveCat(): Promise<void> {
  const payload = {
    name: catForm.value.name.trim(),
    description: catForm.value.description.trim(),
    position: Number(catForm.value.position) || 0,
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

// -------------------------------------------------------------------- users

async function toggleBan(user: UserRowWithCount): Promise<void> {
  if (user.id === auth.user?.id) {
    error.value = '不能封禁自己'
    return
  }
  try {
    await http.patch(`/admin/users/${user.id}`, { banned: !user.banned })
    user.banned = !user.banned
  } catch (err) {
    error.value = errMessage(err)
  }
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
  flag: 'isPinned' | 'isLocked',
  value: boolean,
): Promise<void> {
  try {
    await http.patch(`/admin/threads/${thread.id}`, { [flag]: value })
    thread[flag] = value
  } catch (err) {
    error.value = errMessage(err)
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

    <div v-if="loading" class="empty">加载中…</div>

    <TabsRoot v-else default-value="categories">
      <TabsList>
        <TabsTrigger value="categories">版块</TabsTrigger>
        <TabsTrigger value="users">用户</TabsTrigger>
        <TabsTrigger value="threads">主题</TabsTrigger>
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
                <th>简介</th>
                <th>排序</th>
                <th>主题数</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="cat in categories" :key="cat.id">
                <td><b>{{ cat.name }}</b></td>
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
                </td>
                <td class="mono">{{ user.postCount }}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-ghost btn-sm" type="button" @click="toggleRole(user)">
                      {{ user.role === 'admin' ? '降为用户' : '设为管理员' }}
                    </button>
                    <button
                      class="btn btn-sm"
                      :class="user.banned ? '' : 'btn-danger'"
                      type="button"
                      @click="toggleBan(user)"
                    >
                      {{ user.banned ? '解封' : '封禁' }}
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
                  <span v-if="thread.isPinned" class="pill pill-accent">置顶</span>
                  <span v-if="thread.isLocked" class="pill pill-danger">锁定</span>
                  <span v-if="!thread.isPinned && !thread.isLocked" class="faint">正常</span>
                </td>
                <td>
                  <div class="row-actions">
                    <label class="flag-toggle">
                      <span>置顶</span>
                      <SwitchRoot
                        :model-value="thread.isPinned"
                        @update:model-value="setThreadFlag(thread, 'isPinned', $event)"
                      >
                        <SwitchThumb />
                      </SwitchRoot>
                    </label>
                    <label class="flag-toggle">
                      <span>锁定</span>
                      <SwitchRoot
                        :model-value="thread.isLocked"
                        @update:model-value="setThreadFlag(thread, 'isLocked', $event)"
                      >
                        <SwitchThumb />
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

    </TabsRoot>

    <!-- create / edit a category -->
    <DialogRoot :open="catDialogOpen" @update:open="onCatDialogChange">
      <DialogPortal>
        <DialogOverlay />
        <DialogContent>
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
        <DialogOverlay />
        <DialogContent>
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
        <DialogOverlay />
        <DialogContent>
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
  </div>
</template>
