import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/views/HomeView/index.vue'),
      meta: { title: '首页' },
    },
    {
      path: '/market',
      name: 'market',
      component: () => import('@/views/MarketView/index.vue'),
      meta: { title: '股票列表' },
    },
    {
      path: '/monitor',
      name: 'monitor',
      component: () => import('@/views/MonitorView/index.vue'),
      meta: { title: '关注与监听' },
    },
    {
      path: '/stock/:code',
      name: 'stockDetail',
      component: () => import('@/views/StockDetailView/index.vue'),
      meta: { title: '股票详情' },
    },
    {
      path: '/analysis',
      name: 'analysis',
      component: () => import('@/views/AnalysisView/index.vue'),
      meta: { title: '技术分析' },
    },
    {
      path: '/ask',
      name: 'ask',
      component: () => import('@/views/AskView/index.vue'),
      meta: { title: 'AI问股' },
    },
    {
      path: '/strategy',
      name: 'strategy',
      component: () => import('@/views/StrategyView/index.vue'),
      meta: { title: '策略中心' },
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView/index.vue'),
      meta: { title: '设置' },
    },
  ],
})

router.onError((error) => {
  console.error('[Router Error]', error.message || error, error.stack || '')
})

export default router
