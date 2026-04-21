<template>
  <div class="home-tab-panel">
    <div v-if="loading && !data" class="home-tab-empty"><span class="spinner"></span><span>加载热点个股工作台...</span></div>
    <template v-else-if="data">
      <section class="summary-grid">
        <article v-for="item in data.summaryCards" :key="item.label" class="summary-card" :class="item.tone">
          <span class="summary-card__label">{{ item.label }}</span>
          <strong class="summary-card__value">{{ item.value }}</strong>
          <span class="summary-card__detail">{{ item.detail }}</span>
        </article>
      </section>

      <section class="panel-grid panel-grid--wide">
        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">热点榜单</span>
              <h3>多维度个股雷达</h3>
            </div>
          </div>
          <div class="board-tabs">
            <div class="board-block">
              <span class="board-block__title">涨幅前排</span>
              <button v-for="item in data.boards.leaders" :key="`leader-${item.code}`" class="board-row" @click="$emit('select-stock', item.code)">
                <strong>{{ item.name }}</strong>
                <span class="up">{{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%</span>
              </button>
            </div>
            <div class="board-block">
              <span class="board-block__title">成交额前排</span>
              <button v-for="item in data.boards.active" :key="`active-${item.code}`" class="board-row" @click="$emit('select-stock', item.code)">
                <strong>{{ item.name }}</strong>
                <span>{{ formatAmount(item.amount) }}</span>
              </button>
            </div>
            <div class="board-block">
              <span class="board-block__title">换手前排</span>
              <button v-for="item in data.boards.turnover" :key="`turnover-${item.code}`" class="board-row" @click="$emit('select-stock', item.code)">
                <strong>{{ item.name }}</strong>
                <span>{{ item.turnover?.toFixed(2) || '0.00' }}%</span>
              </button>
            </div>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">焦点个股</span>
              <h3>{{ focusName }}</h3>
            </div>
          </div>
          <div v-if="detailLoading" class="stock-detail-empty">正在加载个股明细...</div>
          <div v-else-if="stockDetail" class="detail-grid">
            <article class="detail-card">
              <span>最新价</span>
              <strong>{{ formatPrice(Number(stockDetail.info?.price || 0)) }}</strong>
              <small :class="Number(stockDetail.info?.changePercent || 0) >= 0 ? 'up' : 'down'">
                {{ Number(stockDetail.info?.changePercent || 0) >= 0 ? '+' : '' }}{{ Number(stockDetail.info?.changePercent || 0).toFixed(2) }}%
              </small>
            </article>
            <article class="detail-card">
              <span>成交额</span>
              <strong>{{ formatAmount(Number(stockDetail.info?.amount || 0)) }}</strong>
              <small>换手 {{ Number(stockDetail.finance?.turnover || stockDetail.info?.turnover || 0).toFixed(2) }}%</small>
            </article>
            <article class="detail-card">
              <span>估值</span>
              <strong>PE {{ Number(stockDetail.finance?.pe || 0).toFixed(2) }}</strong>
              <small>PB {{ Number(stockDetail.finance?.pb || 0).toFixed(2) }}</small>
            </article>
            <article class="detail-card">
              <span>市值</span>
              <strong>{{ formatAmount(Number(stockDetail.finance?.totalMv || 0)) }}</strong>
              <small>流通 {{ formatAmount(Number(stockDetail.finance?.circMv || 0)) }}</small>
            </article>
          </div>
          <div v-if="stockDetail?.fundflow?.length" class="mini-history">
            <article v-for="item in stockDetail.fundflow.slice(-5)" :key="String(item.date)" class="mini-history__row">
              <span>{{ item.date }}</span>
              <strong :class="Number(item.mainNetInflow || 0) >= 0 ? 'up' : 'down'">
                {{ formatAmount(Number(item.mainNetInflow || 0)) }}
              </strong>
            </article>
          </div>
          <div v-if="stockDetail?.news?.length" class="mini-news">
            <button
              v-for="item in stockDetail.news.slice(0, 4)"
              :key="item.id"
              class="mini-news__row"
              @click="$emit('navigate-stock', selectedStockCode)"
            >
              <strong>{{ item.title }}</strong>
              <span>{{ item.source || '快讯' }}</span>
            </button>
          </div>
        </article>
      </section>

      <section class="panel-grid panel-grid--two">
        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">突破样本</span>
              <h3>高弹性区</h3>
            </div>
          </div>
          <div class="chip-grid">
            <button v-for="item in data.boards.breakouts" :key="`breakout-${item.code}`" class="chip-card" @click="$emit('select-stock', item.code)">
              <strong>{{ item.name }}</strong>
              <span>{{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%</span>
            </button>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">防守样本</span>
              <h3>低波动区</h3>
            </div>
          </div>
          <div class="chip-grid">
            <button v-for="item in data.boards.defensive" :key="`defensive-${item.code}`" class="chip-card" @click="$emit('select-stock', item.code)">
              <strong>{{ item.name }}</strong>
              <span>{{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%</span>
            </button>
          </div>
        </article>
      </section>
    </template>
    <div v-else class="home-tab-empty home-tab-empty--error">热点个股暂时没有可用数据。</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { HomeStocksData, NewsItem } from '@/types'
import { formatAmount, formatPrice } from '@/utils/format'

const props = defineProps<{
  loading: boolean
  data: HomeStocksData | null
  selectedStockCode: string
  detailLoading: boolean
  stockDetail: {
    info: Record<string, any>
    finance: Record<string, any>
    fundflow: Array<Record<string, any>>
    news: NewsItem[]
  } | null
}>()

defineEmits<{
  (e: 'select-stock', code: string): void
  (e: 'navigate-stock', code: string): void
}>()

const focusName = computed(() => props.stockDetail?.info?.name || props.data?.focusStock?.info?.name || '焦点个股')
</script>

<style scoped lang="scss">
.home-tab-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.summary-grid,
.panel-grid,
.board-tabs,
.chip-grid {
  display: grid;
  gap: 14px;
  align-items: start;
}

.summary-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.panel-grid--wide {
  grid-template-columns: 1.15fr 0.85fr;
}

.panel-grid--two,
.board-tabs {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.chip-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.summary-card,
.panel-card {
  padding: 16px 18px;
  border-radius: 20px;
  border: 1px solid rgba(15, 33, 57, 0.08);
  background: rgba(255, 255, 255, 0.85);
}

.panel-card {
  display: flex;
  flex-direction: column;
}

.summary-card__label,
.panel-card__eyebrow,
.board-row span,
.chip-card span,
.detail-card span,
.detail-card small,
.mini-news__row span,
.mini-history__row span {
  font-size: 11px;
  color: $text-muted;
}

.summary-card__value,
.panel-card__head h3,
.detail-card strong {
  margin-top: 8px;
  font-family: $font-display;
  color: $text-primary;
}

.summary-card__value {
  display: block;
  font-size: 24px;
}

.summary-card__detail {
  display: block;
  margin-top: 6px;
  color: $text-secondary;
}

.panel-card__head h3 {
  margin: 4px 0 0;
}

.board-block,
.mini-history,
.mini-news {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.board-tabs {
  max-height: 448px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.board-block__title {
  font-size: 12px;
  font-weight: 600;
  color: $text-secondary;
}

.board-row,
.chip-card,
.mini-history__row,
.mini-news__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(247, 244, 238, 0.92);
  border: 1px solid rgba(15, 33, 57, 0.06);
  text-align: left;
}

.chip-card {
  flex-direction: column;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.detail-card {
  padding: 14px;
  border-radius: 16px;
  background: rgba(247, 244, 238, 0.92);
  border: 1px solid rgba(15, 33, 57, 0.06);
}

.detail-card span,
.detail-card small {
  display: block;
}

.detail-card small {
  margin-top: 6px;
}

.mini-history,
.mini-news {
  margin-top: 14px;
  max-height: 172px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.chip-grid {
  max-height: 332px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.stock-detail-empty {
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(247, 244, 238, 0.92);
  color: $text-secondary;
}

.up { color: $color-up !important; }
.down { color: $color-down !important; }

.home-tab-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 240px;
  border-radius: 22px;
  color: $text-secondary;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(15, 33, 57, 0.08);
}

.home-tab-empty--error {
  min-height: auto;
  padding: 14px 16px;
  justify-content: flex-start;
  color: $color-down;
}

@media (max-width: 1200px) {
  .summary-grid,
  .panel-grid--wide,
  .panel-grid--two,
  .board-tabs,
  .chip-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .summary-grid,
  .panel-grid--wide,
  .panel-grid--two,
  .board-tabs,
  .chip-grid,
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
