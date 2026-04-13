import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import pinia from './stores'
import { useSettingsStore } from './stores/settings'
import './assets/styles/main.scss'

const app = createApp(App)
app.use(pinia)

const settingsStore = useSettingsStore()
settingsStore.loadSettings()

app.use(router).mount('#app')
