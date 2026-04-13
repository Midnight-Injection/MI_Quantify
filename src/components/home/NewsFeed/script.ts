import { defineComponent, type PropType, ref, computed } from 'vue'
import type { NewsItem, SentimentType } from '@/types'
import { sentimentColorClass, sentimentText } from '@/utils/color'

export default defineComponent({
  name: 'NewsFeed',
  props: {
    newsList: { type: Array as PropType<NewsItem[]>, default: () => [] },
    loading: { type: Boolean, default: false },
  },
  emits: ['refresh', 'analyze'],
  setup(props) {
    const currentPage = ref(1)
    const pageSize = 9

    const totalItems = computed(() => props.newsList.length)
    const totalPages = computed(() => Math.ceil(totalItems.value / pageSize))

    const pagedNews = computed(() => {
      const start = (currentPage.value - 1) * pageSize
      return props.newsList.slice(start, start + pageSize)
    })

    const displayedPages = computed<(number | string)[]>(() => {
      const total = totalPages.value
      const current = currentPage.value
      if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
      const pages: (number | string)[] = [1]
      if (current > 3) pages.push('...')
      for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
        pages.push(i)
      }
      if (current < total - 2) pages.push('...')
      pages.push(total)
      return pages
    })

    function isAnalyzing(_id: string) {
      return false
    }

    function sentimentClass(s: SentimentType) {
      return sentimentColorClass(s)
    }

    function sentimentLabel(s: SentimentType) {
      return sentimentText(s)
    }

    return {
      currentPage,
      totalItems,
      totalPages,
      pagedNews,
      displayedPages,
      isAnalyzing,
      sentimentClass,
      sentimentLabel,
    }
  },
})
