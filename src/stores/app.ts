import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  const sidebarCollapsed = ref(false)
  const currentRoute = ref('home')
  const loading = ref(false)

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function setCurrentRoute(name: string) {
    currentRoute.value = name
  }

  function setLoading(val: boolean) {
    loading.value = val
  }

  return {
    sidebarCollapsed,
    currentRoute,
    loading,
    toggleSidebar,
    setCurrentRoute,
    setLoading,
  }
})
