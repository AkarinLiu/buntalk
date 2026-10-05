import { createRouter, createWebHistory } from 'vue-router'
import Admin from './pages/Admin.vue'
import Auth from './pages/Auth.vue'
import Category from './pages/Category.vue'
import Home from './pages/Home.vue'
import NewThread from './pages/NewThread.vue'
import Profile from './pages/Profile.vue'
import Thread from './pages/Thread.vue'

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
    { path: '/u/:username', name: 'profile', component: Profile, props: true },
    { path: '/admin', name: 'admin', component: Admin },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
