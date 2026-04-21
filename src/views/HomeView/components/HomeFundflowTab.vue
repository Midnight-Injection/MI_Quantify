<template>
  <div class="home-tab-panel">
    <div v-if="loading && !data" class="home-tab-empty"><span class="spinner"></span><span>加载资金工作台...</span></div>
    <template v-else-if="data">
      <section class="summary-grid">
        <article v-for="item in data.summaryCards" :key="item.label" class="summary-card" :class="item.tone">
          <span class="summary-card__label">{{ item.label }}</span>
          <strong class="summary-card__value">{{ item.value }}</strong>
          <span class="summary-card__detail">{{ item.detail }}</span>
        </article>
      </section>

      <section class="panel-grid panel-grid--three">
        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">个股资金</span>
              <h3>主力净流入前排</h3>
            </div>
          </div>
          <div class="rank-list">
            <button
              v-for="item in data.stockFlows.inflow"
              :key="item.code"
              class="rank-row"
              @click="$emit('navigate-stock', item.code)"
            >
              <div>
                <strong>{{ item.name }}</strong>
                <span>{{ item.code }}</span>
              </div>
              <div class="rank-row__right">
                <strong class="up">{{ formatMetric(item) }}</strong>
                <span>{{ formatRatio(item) }}</span>
              </div>
            </button>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">个股风险</span>
              <h3>净流出 / 弱势样本</h3>
            </div>
          </div>
          <div class="rank-list">
            <button
              v-for="item in data.stockFlows.outflow"
              :key="item.code"
              class="rank-row"
              @click="$emit('navigate-stock', item.code)"
            >
              <div>
                <strong>{{ item.name }}</strong>
                <span>{{ item.code }}</span>
              </div>
              <div class="rank-row__right">
                <strong :class="resolveTone(item)">{{ formatMetric(item) }}</strong>
                <span>{{ formatRatio(item) }}</span>
              </div>
            </button>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">焦点跟踪</span>
              <h3>重点个股近 5 日</h3>
            </div>
          </div>
          <div v-if="data.focusStock.history.length" class="history-list">
            <article v-for="item in data.focusStock.history" :key="String(item.date)" class="history-item">
              <span>{{ item.date }}</span>
              <strong :class="Number(item.mainNetInflow || 0) >= 0 ? 'up' : 'down'">
                {{ formatAmount(Number(item.mainNetInflow || 0)) }}
              </strong>
              <span>占比 {{ Number(item.mainNetInflowPercent || 0).toFixed(2) }}%</span>
            </article>
          </div>
          <div v-else class="history-empty">当前市场没有可用的逐日资金数据，已回退为实时样本代理。</div>
        </article>
      </section>

      <section class="panel-grid panel-grid--two">
        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">行业资金 / 量能</span>
              <h3>主线行业对照</h3>
            </div>
          </div>
          <div class="board-list">
            <article v-for="item in data.boardFlows.industry" :key="item.code" class="board-row">
              <div>
                <strong>{{ item.name }}</strong>
                <span>{{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%</span>
              </div>
              <div class="board-row__right">
                <strong>{{ item.netFlowProxy ? formatAmount(item.netFlowProxy) : formatAmount(item.amount) }}</strong>
                <span>{{ item.samples?.map((sample) => sample.name).join('、') || '成交额代理' }}</span>
              </div>
            </article>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">概念资金 / 主题量价</span>
              <h3>热点主题承接</h3>
            </div>
          </div>
          <div class="board-list">
            <article v-for="item in data.boardFlows.concept" :key="item.code" class="board-row">
              <div>
                <strong>{{ item.name }}</strong>
                <span>{{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%</span>
              </div>
              <div class="board-row__right">
                <strong>{{ item.netFlowProxy ? formatAmount(item.netFlowProxy) : formatAmount(item.amount) }}</strong>
                <span>{{ item.samples?.map((sample) => sample.name).join('、') || '主题成交额代理' }}</span>
              </div>
            </article>
          </div>
        </article>
      </section>
    </template>
    <div v-else class="home-tab-empty home-tab-empty--error">资金方向暂时没有可用数据。</div>
  </div>
</template>

<script setup lang="ts">
import type { FundFlow, HomeFundflowData, StockListItem } from '@/types'
import { formatAmount } from '@/utils/format'

defineProps<{
  loading: boolean
  data: HomeFundflowData | null
}>()

defineEmits<{
  (e: 'navigate-stock', code: string): void
}>()

function isFundFlow(item: FundFlow | StockListItem): item is FundFlow {
  return typeof (item as FundFlow).mainNetInflow === 'number'
}

function formatMetric(item: FundFlow | StockListItem) {
  return isFundFlow(item) ? formatAmount(item.mainNetInflow) : formatAmount(item.amount)
}

function formatRatio(item: FundFlow | StockListItem) {
  return isFundFlow(item)
    ? `净占比 ${item.mainNetInflowPercent.toFixed(2)}%`
    : `涨跌 ${item.changePercent.toFixed(2)}%`
}

function resolveTone(item: FundFlow | StockListItem) {
  if (isFundFlow(item)) return item.mainNetInflow >= 0 ? 'up' : 'down'
  return item.changePercent >= 0 ? 'up' : 'down'
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

.panel-grid--three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.panel-grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
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
.history-item span,
.board-row span,
.rank-row span {
  font-size: 11px;
  color: $text-muted;
}

.summary-card__value,
.panel-card__head h3 {
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
  font-size: 12px;
}

.panel-card__head h3 {
  margin: 4px 0 0;
}

.rank-list,
.board-list,
.history-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
  max-height: 420px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.rank-row,
.board-row,
.history-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(247, 244, 238, 0.92);
  border: 1px solid rgba(15, 33, 57, 0.06);
  text-align: left;
}

.rank-row__right,
.board-row__right {
  text-align: right;
}

.rank-row strong,
.board-row strong,
.history-item strong {
  color: $text-primary;
}

.history-empty {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(247, 244, 238, 0.92);
  color: $text-secondary;
  line-height: 1.6;
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
  .panel-grid--three,
  .panel-grid--two {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .summary-grid,
  .panel-grid--three,
  .panel-grid--two {
    grid-template-columns: 1fr;
  }
}
</style>
