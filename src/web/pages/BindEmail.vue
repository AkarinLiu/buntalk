<script setup lang="ts">
/**
 * Landing page for the forced-binding gate. The router funnels every other
 * route here until `auth.user.emailVerified` is true; the moment it flips, we
 * leave. The email UI itself is the shared card.
 */
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import { auth, logout } from '../store'
import EmailBindCard from '../components/EmailBindCard.vue'

const router = useRouter()

watch(
  () => auth.user?.emailVerified,
  (verified) => {
    if (verified) void router.replace('/')
  },
)

async function signOut(): Promise<void> {
  await logout()
  await router.push('/login')
}
</script>

<template>
  <div class="page" style="max-width: 460px; margin: 0 auto">
    <h1>绑定邮箱</h1>
    <p class="muted" style="margin: 8px 0 24px">
      本站要求绑定并验证邮箱后才能继续使用。请填写邮箱，再输入收到的验证码。
    </p>

    <EmailBindCard />

    <p class="muted" style="margin: 18px 0 0; text-align: center; font-size: 14px">
      <button class="btn btn-ghost btn-sm" type="button" @click="signOut">退出登录</button>
    </p>
  </div>
</template>
