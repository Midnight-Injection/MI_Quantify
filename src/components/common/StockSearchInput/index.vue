<template>
  <div ref="rootRef" class="stock-search-input">
    <div class="search-shell" :class="{ open: isOpen }">
      <input
        :value="modelValue"
        :placeholder="placeholder"
        :disabled="disabled"
        class="input search-input"
        @input="handleInput"
        @focus="handleFocus"
        @keydown.enter.prevent="handleEnter"
      />
      <div v-if="loading" class="search-status">
        <span class="search-spinner"></span>
        <span>匹配中...</span>
      </div>
    </div>

    <div v-if="isOpen && results.length" class="search-dropdown">
      <button
        v-for="item in results"
        :key="item.code"
        class="search-option"
        type="button"
        @mousedown.prevent="selectItem(item)"
      >
        <div class="option-main">
          <strong>{{ item.name }}</strong>
          <span>{{ item.code }}</span>
        </div>
        <div class="option-side">
          <strong :class="item.change >= 0 ? 'up' : 'down'">{{ formatPrice(item.price) }}</strong>
          <span :class="item.changePercent >= 0 ? 'up' : 'down'">{{ formatPercent(item.changePercent) }}%</span>
        </div>
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, onBeforeUnmount, ref, type PropType } from 'vue'
import { useMarketStore } from '@/stores/market'
import type { StockQuote } from '@/types'
import { formatPercent, formatPrice } from '@/utils/format'
import { normalizeSecurityCode } from '@/utils/security'

export default defineComponent({
  name: 'StockSearchInput',
  props: {
    modelValue: {
      type: String,
      required: true,
    },
    placeholder: {
      type: String,
      default: '输入股票名称或代码',
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    fillMode: {
      type: String as PropType<'code' | 'label'>,
      default: 'code',
    },
  },
  emits: ['update:modelValue', 'select', 'enter'],
  setup(props, { emit }) {
    const marketStore = useMarketStore()
    const rootRef = ref<HTMLElement | null>(null)
    const results = ref<StockQuote[]>([])
    const loading = ref(false)
    const isOpen = ref(false)
    let searchTimer: ReturnType<typeof setTimeout> | null = null

    function clearPendingTimer() {
      if (searchTimer) {
        clearTimeout(searchTimer)
        searchTimer = null
      }
    }

    function closeDropdown() {
      isOpen.value = false
      loading.value = false
      results.value = []
    }

    async function searchStocks(keyword: string) {
      const trimmed = keyword.trim()
      if (!trimmed) {
        closeDropdown()
        return
      }

      loading.value = true
      const matched = await marketStore.searchStock(trimmed)
      results.value = matched.slice(0, 8)
      loading.value = false
      isOpen.value = !!results.value.length
    }

    function handleInput(event: Event) {
      const value = (event.target as HTMLInputElement).value
      emit('update:modelValue', value)
      clearPendingTimer()

      if (!value.trim()) {
        closeDropdown()
        return
      }

      searchTimer = setTimeout(() => {
        void searchStocks(value)
      }, 220)
    }

    function handleFocus() {
      if (results.value.length) {
        isOpen.value = true
      }
    }

    function selectItem(item: StockQuote) {
      const nextValue = props.fillMode === 'label' ? `${item.name} ${normalizeSecurityCode(item.code)}` : normalizeSecurityCode(item.code)
      emit('update:modelValue', nextValue)
      emit('select', item)
      closeDropdown()
    }

    function handleEnter() {
      if (results.value.length) {
        selectItem(results.value[0])
        return
      }
      emit('enter', props.modelValue.trim())
      closeDropdown()
    }

    function handleDocumentClick(event: MouseEvent) {
      if (!rootRef.value) return
      if (event.target instanceof Node && rootRef.value.contains(event.target)) return
      closeDropdown()
    }

    document.addEventListener('mousedown', handleDocumentClick)

    onBeforeUnmount(() => {
      clearPendingTimer()
      document.removeEventListener('mousedown', handleDocumentClick)
    })

    return {
      rootRef,
      results,
      loading,
      isOpen,
      formatPrice,
      formatPercent,
      handleInput,
      handleFocus,
      handleEnter,
      selectItem,
    }
  },
})
</script>

<style lang="scss" scoped>
.stock-search-input {
  position: relative;
  min-width: 0;
}

.search-shell {
  position: relative;

  &.open .search-input {
    border-color: rgba(9, 93, 149, 0.24);
    box-shadow: 0 0 0 4px rgba(9, 93, 149, 0.06);
  }
}

.search-input {
  width: 100%;
  padding-right: 92px;
}

.search-status {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: $text-muted;
  pointer-events: none;
}

.search-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(15, 33, 57, 0.1);
  border-top-color: $color-accent;
  border-radius: 50%;
  animation: stock-search-spin 0.8s linear infinite;
}

.search-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  z-index: 40;
  max-height: 320px;
  overflow-y: auto;
  border-radius: 18px;
  border: 1px solid rgba(15, 33, 57, 0.08);
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 24px 40px rgba(18, 30, 49, 0.1);
  @include custom-scrollbar;
}

.search-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border: none;
  border-bottom: 1px solid rgba(15, 33, 57, 0.06);
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background $transition-fast;

  &:last-child {
    border-bottom: none;
  }

  &:hover {
    background: rgba(9, 93, 149, 0.05);
  }
}

.option-main,
.option-side {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.option-main {
  min-width: 0;

  strong {
    color: $text-primary;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  span {
    color: $text-muted;
    font-size: 11px;
    font-family: $font-mono;
  }
}

.option-side {
  flex-shrink: 0;
  align-items: flex-end;

  strong,
  span {
    font-size: 12px;
    font-family: $font-mono;
  }
}

.up {
  color: $color-up;
}

.down {
  color: $color-down;
}

@keyframes stock-search-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
