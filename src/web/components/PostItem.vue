<script setup lang="ts">
import { computed } from 'vue'
import type { PostNode } from '../postTree'
import { renderMarkdown } from '../markdown'
import { auth } from '../store'
import UserAvatar from './UserAvatar.vue'

const props = defineProps<{ node: PostNode }>()

const emit = defineEmits<{
  like: [postId: number]
  remove: [postId: number]
  reply: [postId: number]
}>()

const post = computed(() => props.node.post)

const canManage = computed(() => {
  const user = auth.user
  return !!user && (user.role === 'admin' || user.id === props.node.post.authorId)
})

const likes = computed(() => post.value.likeCount ?? 0)
const liked = computed(() => post.value.likedByMe ?? false)
const body = computed(() => renderMarkdown(post.value.body))

const time = (iso: string) => iso.replace('T', ' ').slice(0, 16)
</script>

<template>
  <article class="post">
    <router-link
      v-if="post.author"
      :to="`/u/${post.author.username}`"
      class="post-avatar"
      :aria-label="post.author.displayName"
    >
      <UserAvatar :user="post.author" :size="34" />
    </router-link>

    <div class="post-body">
      <div class="post-head">
        <router-link v-if="post.author" :to="`/u/${post.author.username}`" class="name">
          {{ post.author.displayName }}
        </router-link>
        <span v-if="post.author?.role === 'admin'" class="pill pill-accent">管理员</span>
        <span class="faint mono">{{ time(post.createdAt) }}</span>
      </div>

      <div class="markdown-body" v-html="body"></div>

      <div class="post-actions">
        <button
          class="like-btn"
          type="button"
          :aria-pressed="liked"
          :disabled="!auth.user"
          :title="auth.user ? '点赞' : '登录后可点赞'"
          @click="emit('like', post.id)"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path
              d="M12 21s-7.5-4.7-10-9.3C.4 8.4 2.3 4.5 6 4.5c2 0 3.4 1.1 4 2.2.6-1.1 2-2.2 4-2.2 3.7 0 5.6 3.9 4 7.2C19.5 16.3 12 21 12 21z"
            />
          </svg>
          {{ likes }}
        </button>

        <button class="btn btn-ghost btn-sm" type="button" :disabled="!auth.user" @click="emit('reply', post.id)">
          回复
        </button>

        <button
          v-if="canManage"
          class="btn btn-danger btn-sm"
          type="button"
          @click="emit('remove', post.id)"
        >
          删除
        </button>
      </div>

      <div v-if="node.children.length" class="post-children">
        <PostItem
          v-for="child in node.children"
          :key="child.post.id"
          :node="child"
          @like="(id) => emit('like', id)"
          @remove="(id) => emit('remove', id)"
          @reply="(id) => emit('reply', id)"
        />
      </div>
    </div>
  </article>
</template>
