import { createRouter, createWebHistory } from 'vue-router'
import Admin from './pages/Admin.vue'
import Auth from './pages/Auth.vue'
import BindEmail from './pages/BindEmail.vue'
import Category from './pages/Category.vue'
import Drafts from './pages/Drafts.vue'
import Home from './pages/Home.vue'
import Messages from './pages/Messages.vue'
import NewThread from './pages/NewThread.vue'
import Profile from './pages/Profile.vue'
import Reset from './pages/Reset.vue'
import Setup from './pages/Setup.vue'
import Thread from './pages/Thread.vue'
import { meta, loadMeta } from './meta'
import { checkSetup, setup } from './setup'
import { auth, groups, loadGroups, refreshSession } from './store'

// History mode needs a server that serves index.html for every unknown path —
// Hono does that in production (see src/server/app.ts), and Vite does in dev.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/c/:id', name: 'category', component: Category, props: true },
    { path: '/t/:id', name: 'thread', component: Thread, props: true },
    {
      path: '/new',
      name: 'new-thread',
      component: NewThread,
      props: (route) => ({ presetCategory: Number(route.query.category) || undefined }),
    },
    { path: '/login', name: 'login', component: Auth, props: { mode: 'login' } },
    { path: '/register', name: 'register', component: Auth, props: { mode: 'register' } },
    { path: '/reset', name: 'reset', component: Reset },
    { path: '/u/:username', name: 'profile', component: Profile, props: true },
    { path: '/messages/:id?', name: 'messages', component: Messages },
    { path: '/drafts', name: 'drafts', component: Drafts },
    { path: '/admin', name: 'admin', component: Admin },
    { path: '/setup', name: 'setup', component: Setup },
    { path: '/bind-email', name: 'bind-email', component: BindEmail },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

// First run: hold every route hostage to /setup until the install is
// initialized; afterwards lock /setup itself away. The check runs before the
// first navigation resolves, so the wrong page never paints for a frame.
router.beforeEach(async (to) => {
  if (!setup.checked) await checkSetup()
  if (setup.needed && to.name !== 'setup') return { path: '/setup' }
  if (!setup.needed && to.name === 'setup') return { path: '/' }

  if (!meta.loaded) await loadMeta()
  if (!groups.loaded) await loadGroups()

  // Forced binding: while on, an unverified account can only sit on the binding
  // page. The session is only awaited when the gate is live, so ordinary
  // installs keep painting without waiting on /auth/me.
  if (meta.requireEmail && !auth.loaded) await refreshSession()
  if (to.name === 'bind-email') {
    if (!meta.requireEmail || !auth.user || auth.user.emailVerified) return { path: '/' }
    return
  }
  if (meta.requireEmail && auth.user && !auth.user.emailVerified) return { path: '/bind-email' }

  // 私信 and 草稿箱 are members-only, so make sure the session is known first.
  const membersOnly = to.name === 'messages' || to.name === 'drafts'
  if (membersOnly && !auth.loaded) await refreshSession()
  if (membersOnly && !auth.user) return { path: '/login' }
})
