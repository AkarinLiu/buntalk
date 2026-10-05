import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { refreshSession } from './store'
import './style.css'

createApp(App).use(router).mount('#app')

// Not awaited: the header gates its auth controls on `auth.loaded`, so the page
// renders immediately instead of blocking first paint on a round trip.
void refreshSession()
