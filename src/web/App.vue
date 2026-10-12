<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import NavBar from './components/NavBar.vue'
import SideNav from './components/SideNav.vue'
import { setup } from './setup'

// Desktop starts with the sidebar open; phones keep it closed until the menu
// button is tapped (it becomes an off-canvas drawer there).
const sidebarOpen = ref(window.innerWidth > 860)

// The first-run wizard owns the whole screen: no header, no sidebar to wander off in.
const route = useRoute()
const isSetup = computed(() => route.name === 'setup')
</script>

<template>
  <template v-if="!isSetup">
    <NavBar @toggle-menu="sidebarOpen = !sidebarOpen" />
    <div class="app-body">
      <SideNav :open="sidebarOpen" />
      <main class="app-main">
        <router-view />
      </main>
    </div>
    <footer v-if="setup.siteFooter" class="site-footer">{{ setup.siteFooter }}</footer>
  </template>
  <router-view v-else />
</template>
