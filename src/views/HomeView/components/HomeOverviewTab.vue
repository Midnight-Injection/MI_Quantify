<template>
  <div class="home-tab-panel">
    <div v-if="loading && !data" class="home-tab-empty"><span class="spinner"></span><span>加载盘面总览...</span></div>
    <template v-else-if="data">
      <section class="summary-grid">
        <article v-for="item in data.summaryCards" :key="item.label" class="summary-card" :class="item.tone">
          <span class="summary-card__label">{{ item.label }}</span>
          <strong class="summary-card__value" :class="{ 'summary-card__value--pulse': isTurnoverPulseCard(item) }">
            <template v-if="isTurnoverPulseCard(item)">
              <span>{{ formatTurnoverPulse(item.value).compact }}</span>
              <small v-if="formatTurnoverPulse(item.value).compressed">{{ formatTurnoverPulse(item.value).full }}</small>
            </template>
            <template v-else>
              {{ item.value }}<small v-if="item.detail === '亿'">{{ item.detail }}</small>
            </template>
          </strong>
          <span class="summary-card__detail">{{ isTurnoverPulseCard(item) ? data.breadth.sourceLabel : item.detail === '亿' ? data.breadth.sourceLabel : item.detail }}</span>
        </article>
      </section>

      <section class="panel-grid panel-grid--wide">
        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">指数矩阵</span>
              <h3>核心指数与风格锚</h3>
            </div>
            <span class="panel-card__meta">{{ formatTime(data.updatedAt) }}</span>
          </div>
          <div class="index-grid">
            <article v-for="item in data.indices" :key="item.code" class="index-card" :class="item.changePercent >= 0 ? 'up' : 'down'">
              <span>{{ item.name }}</span>
              <strong>{{ formatPrice(item.price) }}</strong>
              <span>{{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%</span>
            </article>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">市场热力图</span>
              <h3>主线热区</h3>
            </div>
          </div>
          <div class="heatmap-grid">
            <button
              v-for="item in data.heatmap"
              :key="item.code"
              class="heatmap-cell"
              :class="item.changePercent >= 0 ? 'up' : 'down'"
              @click="$emit('select-sector', item.code)"
            >
              <strong>{{ item.label }}</strong>
              <span>{{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%</span>
              <small>{{ item.detail }}</small>
            </button>
          </div>
        </article>
      </section>

      <section class="panel-grid panel-grid--three">
        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">风格轮动</span>
              <h3>强弱矩阵</h3>
            </div>
          </div>
          <div class="style-list">
            <article v-for="item in data.styleMatrix" :key="item.label" class="style-item" :class="item.tone">
              <strong>{{ item.label }}</strong>
              <span>{{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%</span>
              <small>{{ item.leader }} · {{ item.detail }}</small>
            </article>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">领涨 / 领跌</span>
              <h3>异动对照</h3>
            </div>
          </div>
          <div class="mover-list">
            <div class="mover-group">
              <span class="mover-group__title">涨幅前排</span>
              <button v-for="item in data.movers.gainers" :key="item.code" class="mover-row" @click="$emit('navigate-stock', item.code)">
                <strong>{{ item.name }}</strong>
                <span class="up">{{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%</span>
              </button>
            </div>
            <div class="mover-group">
              <span class="mover-group__title">跌幅前排</span>
              <button v-for="item in data.movers.losers" :key="item.code" class="mover-row" @click="$emit('navigate-stock', item.code)">
                <strong>{{ item.name }}</strong>
                <span class="down">{{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%</span>
              </button>
            </div>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">量能聚焦</span>
              <h3>成交与换手</h3>
            </div>
          </div>
          <div class="mover-list">
            <div class="mover-group">
              <span class="mover-group__title">成交额前排</span>
              <button v-for="item in data.movers.active" :key="item.code" class="mover-row" @click="$emit('navigate-stock', item.code)">
                <strong>{{ item.name }}</strong>
                <span>{{ formatAmount(item.amount) }}</span>
              </button>
            </div>
            <div class="mover-group">
              <span class="mover-group__title">换手率前排</span>
              <button v-for="item in data.movers.turnover" :key="item.code" class="mover-row" @click="$emit('navigate-stock', item.code)">
                <strong>{{ item.name }}</strong>
                <span>{{ item.turnover?.toFixed(2) || '0.00' }}%</span>
              </button>
            </div>
          </div>
        </article>
      </section>
    </template>
    <div v-else class="home-tab-empty home-tab-empty--error">盘面总览暂时没有可用数据。</div>
  </div>
</template>

<script setup lang="ts">
import type { HomeMetricCard, HomeOverviewData } from '@/types'
import { formatAmount, formatPrice, formatTurnoverPulse } from '@/utils/format'

defineProps<{
  loading: boolean
  data: HomeOverviewData | null
}>()

defineEmits<{
  (e: 'navigate-stock', code: string): void
  (e: 'select-sector', code: string): void
}>()

function formatTime(timestamp: number) {
  if (!timestamp) return '--'
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
}

function isTurnoverPulseCard(card: HomeMetricCard) {
  return card.label === '成交脉冲'
}
</script>

<style scoped lang="scss">
.home-tab-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.summary-grid,
.panel-grid {
  display: grid;
  gap: 14px;
  align-items: start;
}

.summary-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.panel-grid--wide {
  grid-template-columns: 1.15fr 0.85fr;
}

.panel-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.summary-card,
.panel-card {
  padding: 16px 18px;
  border-radius: 20px;
  border: 1px solid rgba(15, 33, 57, 0.08);
  background: rgba(255, 255, 255, 0.85);
  box-shadow: 0 16px 42px rgba(19, 34, 55, 0.05);
}

.panel-card {
  display: flex;
  flex-direction: column;
}

.summary-card__label,
.panel-card__eyebrow,
.panel-card__meta,
.index-card span,
.style-item small,
.mover-group__title {
  font-size: 11px;
  color: $text-muted;
}

.summary-card__value,
.panel-card__head h3,
.index-card strong {
  margin-top: 8px;
  font-family: $font-display;
  color: $text-primary;
}

.summary-card__value {
  display: block;
  font-size: 28px;

  small {
    font-size: 12px;
    margin-left: 4px;
    font-family: $font-mono;
    color: $text-muted;
  }
}

.summary-card__value--pulse {
  display: inline-flex;
  align-items: flex-end;
  gap: 6px;

  small {
    transform: translateY(4px);
  }
}

.summary-card__detail {
  display: block;
  margin-top: 6px;
  color: $text-secondary;
  font-size: 12px;
}

.panel-card__head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;

  h3 {
    margin: 4px 0 0;
  }
}

.index-grid,
.heatmap-grid {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.index-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  max-height: 332px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.heatmap-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  max-height: 332px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.index-card,
.heatmap-cell,
.style-item {
  padding: 12px;
  border-radius: 16px;
  border: 1px solid rgba(15, 33, 57, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(244, 241, 235, 0.88));
}

.heatmap-cell {
  text-align: left;
  min-height: 88px;

  strong {
    display: block;
    color: $text-primary;
  }

  span,
  small {
    display: block;
    margin-top: 6px;
  }
}

.style-list,
.mover-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
  max-height: 382px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.style-item span {
  display: block;
  margin-top: 6px;
}

.mover-list {
  gap: 14px;
}

.mover-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mover-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(247, 244, 238, 0.92);
  border: 1px solid rgba(15, 33, 57, 0.06);
  text-align: left;

  strong {
    color: $text-primary;
  }
}

.up { color: $color-up; }
.down { color: $color-down; }

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
  .panel-grid--three,
  .index-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .panel-grid--wide {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .heatmap-grid,
  .summary-grid,
  .panel-grid--three,
  .index-grid {
    grid-template-columns: 1fr;
  }
}
</style>
