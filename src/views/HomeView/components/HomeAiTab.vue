<template>
  <div class="home-tab-panel">
    <div v-if="digestLoading && !digest && !context" class="home-tab-empty">
      <span class="spinner"></span>
      <span>AI评估中，正在整理盘面证据与实时样本...</span>
    </div>
    <div v-else class="home-ai">
      <section class="panel-card panel-card--hero">
        <div class="panel-card__head">
          <div>
            <span class="panel-card__eyebrow">AI 评估工作台</span>
            <h2>{{ digest?.headline || '当前还没有生成 AI 总判断' }}</h2>
          </div>
          <div class="panel-card__actions">
            <span class="pill-badge" :class="marketMood">
              {{ digest?.confidenceLabel || '等待评估' }}
            </span>
            <button
              v-if="!digestLoading"
              type="button"
              class="hero-action-btn"
              @click="$emit('request-digest')"
            >重新评估</button>
            <button
              v-else
              type="button"
              class="hero-action-btn hero-action-btn--stop"
              @click="$emit('cancel-digest')"
            >停止评估</button>
          </div>
        </div>
        <p class="panel-card__summary">
          {{ digest?.summary || '先看下方证据层、情景推演与候选标的，AI 未返回时也能完成人工决策。' }}
        </p>
        <div class="hero-grid">
          <article v-for="item in context?.evidenceCards || []" :key="item.label" class="metric-card" :class="item.tone">
            <span class="metric-card__label">{{ item.label }}</span>
            <strong class="metric-card__value" :class="{ 'metric-card__value--pulse': isTurnoverPulseCard(item) }">
              <template v-if="isTurnoverPulseCard(item)">
                <span>{{ formatTurnoverPulse(item.value).compact }}</span>
                <small v-if="formatTurnoverPulse(item.value).compressed">{{ formatTurnoverPulse(item.value).full }}</small>
              </template>
              <template v-else>{{ item.value }}</template>
            </strong>
            <span class="metric-card__detail">{{ item.detail }}</span>
          </article>
        </div>
      </section>

      <section class="panel-grid panel-grid--two">
        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">情景推演</span>
              <h3>盘面三种路径</h3>
            </div>
          </div>
          <div class="scenario-list">
            <article v-for="item in context?.scenarioCards || []" :key="item.label" class="scenario-item">
              <span class="scenario-item__label">{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
              <p>{{ item.detail }}</p>
            </article>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">事实摘要</span>
              <h3>本轮推理证据</h3>
            </div>
          </div>
          <ul class="fact-list">
            <li v-for="fact in context?.facts || []" :key="fact">{{ fact }}</li>
          </ul>
        </article>
      </section>

      <section class="panel-grid panel-grid--two">
        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">主题焦点</span>
              <h3>AI 关注主线</h3>
            </div>
          </div>
          <div class="theme-grid">
            <article v-for="item in context?.focusThemes || []" :key="item.code" class="theme-card">
              <span class="theme-card__name">{{ item.name }}</span>
              <strong :class="item.changePercent >= 0 ? 'up' : 'down'">
                {{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%
              </strong>
              <span class="theme-card__meta">领涨 {{ item.leadingStock || '待同步' }}</span>
            </article>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">候选标的</span>
              <h3>评估输入样本</h3>
            </div>
          </div>
          <div class="candidate-list">
            <button
              v-for="item in context?.candidates || []"
              :key="item.code"
              class="candidate-item"
              @click="$emit('navigate-stock', item.code)"
            >
              <div>
                <strong>{{ item.name }}</strong>
                <span>{{ item.code }}</span>
              </div>
              <div class="candidate-item__right">
                <strong :class="item.changePercent >= 0 ? 'up' : 'down'">
                  {{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%
                </strong>
                <span>{{ formatAmount(item.amount) }}</span>
              </div>
            </button>
          </div>
        </article>
      </section>

      <section v-if="digest?.watchStocks?.length" class="panel-card">
        <div class="panel-card__head">
          <div>
            <span class="panel-card__eyebrow">具体操作</span>
            <h3>AI 明确执行清单</h3>
          </div>
        </div>
        <div class="watch-grid">
          <button
            v-for="item in digest.watchStocks"
            :key="`${item.style}-${item.code}`"
            type="button"
            class="watch-card"
            @click="$emit('navigate-stock', item.code)"
          >
            <div class="watch-card__head">
              <div>
                <span class="watch-card__style">{{ item.style }}</span>
                <strong>{{ item.name }}</strong>
                <small>{{ item.code }}</small>
              </div>
              <span class="watch-card__action">{{ resolveWatchAction(item.style) }}</span>
            </div>
            <div class="watch-card__prices">
              <div>
                <span>关注区间</span>
                <strong>{{ item.entryPrice }}</strong>
              </div>
              <div>
                <span>退出条件</span>
                <strong>{{ item.exitPrice }}</strong>
              </div>
            </div>
            <p>{{ item.reason }}</p>
            <small class="watch-card__risk">风险：{{ item.riskTip }}</small>
          </button>
        </div>
      </section>

      <section v-if="digest" class="panel-card">
        <div class="panel-card__head">
          <div>
            <span class="panel-card__eyebrow">AI 叙事输出</span>
            <h3>市场推演与推荐</h3>
          </div>
        </div>
        <div class="narrative-grid">
          <article class="narrative-card">
            <span>消息面</span>
            <p>{{ digest.newsView }}</p>
          </article>
          <article class="narrative-card">
            <span>政策面</span>
            <p>{{ digest.policyView }}</p>
          </article>
          <article class="narrative-card">
            <span>国际面</span>
            <p>{{ digest.globalView }}</p>
          </article>
          <article class="narrative-card">
            <span>短线关注</span>
            <p>{{ digest.shortTermView }}</p>
          </article>
          <article class="narrative-card">
            <span>长线关注</span>
            <p>{{ digest.longTermView }}</p>
          </article>
          <article class="narrative-card">
            <span>未来预期</span>
            <p>{{ digest.futureOutlook }}</p>
          </article>
        </div>
      </section>

      <div v-if="digestError" class="home-tab-empty home-tab-empty--error">{{ digestError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AiInsightDigest, HomeAiContextData, HomeMetricCard } from '@/types'
import { formatAmount, formatTurnoverPulse } from '@/utils/format'

defineProps<{
  digest: AiInsightDigest | null
  digestLoading: boolean
  digestError: string
  context: HomeAiContextData | null
  marketMood: string
  canRequestDigest?: boolean
}>()

defineEmits<{
  (e: 'navigate-stock', code: string): void
  (e: 'request-digest'): void
  (e: 'cancel-digest'): void
}>()

function isTurnoverPulseCard(card: HomeMetricCard) {
  return card.label === '成交脉冲'
}

function resolveWatchAction(style: '短线' | '长线') {
  return style === '短线' ? '逢回踩试仓' : '分批布局'
}
</script>

<style scoped lang="scss">
.home-tab-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-grid {
  display: grid;
  gap: 16px;
  align-items: start;
}

.panel-grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.panel-card {
  padding: 18px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(247, 245, 240, 0.88));
  border: 1px solid rgba(15, 33, 57, 0.08);
  box-shadow: 0 18px 45px rgba(19, 34, 55, 0.05);
  display: flex;
  flex-direction: column;
}

.panel-card--hero {
  background:
    radial-gradient(circle at top left, rgba(9, 93, 149, 0.12), transparent 32%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.95), rgba(246, 244, 238, 0.9));
}

.panel-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;

  h2,
  h3 {
    margin: 4px 0 0;
    font-family: $font-display;
    color: $text-primary;
  }
}

.panel-card__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.panel-card__eyebrow {
  font-size: 11px;
  color: $text-muted;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.panel-card__summary {
  margin: 14px 0 0;
  color: $text-secondary;
  line-height: 1.7;
}

.hero-action-btn {
  border: 0;
  cursor: pointer;
  padding: 8px 12px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(9, 93, 149, 0.92), rgba(30, 115, 171, 0.88));
  color: #fff;
  font-size: 12px;
  font-weight: 600;

  &--stop {
    background: rgba($color-down, 0.9);
  }
}

.pill-badge {
  padding: 8px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: rgba($color-accent, 0.08);
  color: $color-accent;

  &.risk-on {
    background: rgba($color-up, 0.12);
    color: $color-up;
  }

  &.risk-off {
    background: rgba($color-down, 0.12);
    color: $color-down;
  }
}

.hero-grid,
.theme-grid,
.narrative-grid {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.hero-grid {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.theme-grid,
.narrative-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.metric-card,
.theme-card,
.scenario-item,
.narrative-card {
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(15, 33, 57, 0.08);
  background: rgba(255, 255, 255, 0.72);
}

.metric-card__label,
.theme-card__meta,
.narrative-card span,
.scenario-item__label {
  display: block;
  font-size: 11px;
  color: $text-muted;
}

.metric-card__value,
.theme-card strong {
  display: block;
  margin-top: 6px;
  font-size: 20px;
  font-family: $font-display;
}

.metric-card__value--pulse {
  display: inline-flex;
  align-items: flex-end;
  gap: 6px;

  small {
    font-size: 11px;
    line-height: 1;
    color: $text-muted;
    font-family: $font-mono;
    transform: translateY(4px);
  }
}

.metric-card__detail {
  display: block;
  margin-top: 6px;
  color: $text-secondary;
  line-height: 1.5;
  font-size: 12px;
}

.scenario-list,
.fact-list,
.candidate-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
  max-height: 380px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.scenario-item strong,
.theme-card__name,
.candidate-item strong {
  color: $text-primary;
}

.scenario-item p,
.narrative-card p {
  margin: 8px 0 0;
  color: $text-secondary;
  line-height: 1.6;
}

.fact-list {
  margin: 14px 0 0;
  padding-left: 18px;

  li {
    color: $text-secondary;
    line-height: 1.7;
  }
}

.candidate-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(15, 33, 57, 0.08);
  background: rgba(255, 255, 255, 0.7);
  text-align: left;

  span {
    display: block;
    font-size: 11px;
    color: $text-muted;
  }
}

.candidate-item__right {
  text-align: right;
}

.watch-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
  max-height: 458px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.watch-card {
  border: 1px solid rgba(15, 33, 57, 0.08);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.76);
  padding: 14px;
  text-align: left;
  cursor: pointer;

  p {
    margin: 12px 0 0;
    color: $text-secondary;
    line-height: 1.6;
  }
}

.watch-card__head,
.watch-card__prices {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.watch-card__head {
  align-items: flex-start;

  strong,
  span,
  small {
    display: block;
  }

  strong {
    margin-top: 4px;
    font-family: $font-display;
    color: $text-primary;
  }

  small {
    margin-top: 4px;
    color: $text-muted;
    font-size: 11px;
  }
}

.watch-card__style,
.watch-card__action,
.watch-card__prices span,
.watch-card__risk {
  font-size: 11px;
  color: $text-muted;
}

.watch-card__action {
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba($color-accent, 0.08);
  color: $color-accent;
  font-weight: 600;
}

.watch-card__prices {
  margin-top: 12px;

  div {
    flex: 1;
  }

  strong {
    display: block;
    margin-top: 4px;
    color: $text-primary;
  }
}

.watch-card__risk {
  display: block;
  margin-top: 10px;
}

.up { color: $color-up; }
.down { color: $color-down; }

.home-tab-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 220px;
  border-radius: 22px;
  color: $text-secondary;
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(15, 33, 57, 0.08);
}

.home-tab-empty--error {
  min-height: auto;
  padding: 14px 16px;
  justify-content: flex-start;
  color: $color-down;
}

@media (max-width: 1200px) {
  .hero-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .watch-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 900px) {
  .panel-grid--two,
  .theme-grid,
  .narrative-grid {
    grid-template-columns: 1fr;
  }

  .hero-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
