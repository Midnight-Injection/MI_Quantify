import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { NewsItem, SentimentType } from '@/types'
import { useSidecar } from '@/composables/useSidecar'
import { useAiChat } from '@/composables/useAiChat'
import { useSettingsStore } from './settings'

export const useNewsStore = defineStore('news', () => {
  const newsList = ref<NewsItem[]>([])
  const loading = ref(false)
  const lastUpdated = ref<number>(0)
  const analyzingIds = ref<Set<string>>(new Set())

  async function fetchNews() {
    loading.value = true
    try {
      const { get } = useSidecar()
      const res = await get<{ data: NewsItem[] }>('/api/news/financial?limit=80')
      newsList.value = res.data
      lastUpdated.value = Date.now()
    } catch (e) {
      console.error('Failed to fetch news:', e)
    } finally {
      loading.value = false
    }
  }

  async function fetchStockNews(code: string) {
    loading.value = true
    try {
      const { get } = useSidecar()
      const res = await get<{ data: NewsItem[] }>(`/api/news/stock/${code}?limit=20`)
      newsList.value = res.data
      lastUpdated.value = Date.now()
    } catch (e) {
      console.error('Failed to fetch stock news:', e)
    } finally {
      loading.value = false
    }
  }

  async function analyzeSentiment(newsId: string): Promise<SentimentType | null> {
    const news = newsList.value.find((n) => n.id === newsId)
    if (!news) return null

    analyzingIds.value.add(newsId)

    try {
      const settingsStore = useSettingsStore()
      const provider = settingsStore.activeProvider
      if (!provider) {
        console.warn('No active AI provider configured')
        return null
      }

      const { chat } = useAiChat()
      const messages = [
        { role: 'system' as const, content: '你是一位专业的金融新闻情绪分析师。' },
        { role: 'user' as const, content: `请分析以下金融新闻的情绪倾向，只回复一个词：positive（正面）、negative（负面）或 neutral（中性）。\n\n标题：${news.title}\n内容：${news.content.slice(0, 500)}` },
      ]

      const result = await chat(provider, messages)

      let sentiment: SentimentType = 'neutral'
      const lower = result.toLowerCase()
      if (lower.includes('positive') || lower.includes('正面')) {
        sentiment = 'positive'
      } else if (lower.includes('negative') || lower.includes('负面')) {
        sentiment = 'negative'
      }

      news.sentiment = sentiment
      return sentiment
    } catch (e) {
      console.error('Failed to analyze sentiment:', e)
      return null
    } finally {
      analyzingIds.value.delete(newsId)
    }
  }

  function isAnalyzing(id: string) {
    return analyzingIds.value.has(id)
  }

  return {
    newsList,
    loading,
    lastUpdated,
    fetchNews,
    fetchStockNews,
    analyzeSentiment,
    isAnalyzing,
  }
})
