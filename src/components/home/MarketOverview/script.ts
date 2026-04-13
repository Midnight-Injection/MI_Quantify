import { defineComponent, type PropType, ref, watch } from 'vue'
import type { MarketIndex } from '@/types'
import { formatPrice, formatPercent, formatVolume } from '@/utils/format'

type MarketType = 'a' | 'hk' | 'us'

export default defineComponent({
  name: 'MarketOverview',
  props: {
    indices: { type: Array as PropType<MarketIndex[]>, default: () => [] },
    lastUpdated: { type: Number, default: 0 },
    market: { type: String as PropType<MarketType>, default: 'a' },
    loading: { type: Boolean, default: false },
  },
  emits: ['refresh', 'update:market'],
  setup(props, { emit }) {
    const currentMarket = ref<MarketType>(props.market)

    const marketTabs = [
      { value: 'a' as MarketType, label: 'A股' },
      { value: 'hk' as MarketType, label: '港股' },
      { value: 'us' as MarketType, label: '美股' },
    ]

    function switchMarket(market: MarketType) {
      currentMarket.value = market
      emit('update:market', market)
    }

    watch(() => props.market, (val) => {
      currentMarket.value = val
    })

    return { currentMarket, marketTabs, formatPrice, formatPercent, formatVolume, switchMarket }
  },
})
