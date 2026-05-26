<template>
  <div v-if="mode === 'strip'" class="ai-strip">
    <div class="ai-strip__bar">
      <div class="ai-strip__left">
        <span class="ai-strip__tag">AI</span>
        <span v-if="digestLoading" class="ai-strip__loading">正在评估市场...</span>
        <strong v-else-if="digest" class="ai-strip__headline">{{ digest.headline }}</strong>
        <span v-else-if="digestError" class="ai-strip__error">{{ digestError }}</span>
        <span v-else class="ai-strip__placeholder">点击评估生成 AI 市场点评</span>
      </div>
      <div class="ai-strip__right">
        <span v-if="marketMood && digest" class="mood-badge" :class="marketMood">{{ digest.confidenceLabel || '等待评估' }}</span>
        <button
          v-if="!digestLoading"
          type="button"
          class="ai-strip__btn"
          @click.stop="$emit('request-digest')"
        >评估</button>
        <button
          v-if="digestLoading"
          type="button"
          class="ai-strip__btn ai-strip__btn--stop"
          @click.stop="$emit('cancel-digest')"
        >停止</button>
      </div>
    </div>
    <div v-if="digest" class="ai-strip__body">
      <p class="ai-strip__summary">{{ digest.summary }}</p>
      <div v-if="digest.focusThemes?.length" class="ai-strip__themes">
        <span v-for="t in digest.focusThemes" :key="t.theme" class="ai-strip__theme-tag">{{ t.theme }}</span>
      </div>
      <div v-if="digest.watchStocks?.length" class="ai-strip__stocks">
        <div v-for="s in digest.watchStocks" :key="s.code" class="ai-strip__stock" @click.stop="$emit('navigate-stock', s.code)">
          <div class="ai-strip__stock-name">
            <span>{{ s.name }}</span>
            <em :class="s.style === '短线' ? 'tag-short' : 'tag-long'">{{ s.style }}</em>
          </div>
          <div class="ai-strip__stock-prices">
            <span class="price-entry">建仓 <b>{{ s.entryPrice }}</b></span>
            <span v-if="s.stopLoss" class="price-stop">止损 <b>{{ s.stopLoss }}</b></span>
            <span class="price-exit">目标 <b>{{ s.exitPrice }}</b></span>
          </div>
          <div v-if="s.positionSize || s.t0Strategy" class="ai-strip__stock-meta">
            <span v-if="s.positionSize">{{ s.positionSize }}</span>
            <span v-if="s.timeWindow" class="time-window">{{ s.timeWindow }}</span>
          </div>
        </div>
      </div>
      <div v-if="digest.shortTermView || digest.longTermView" class="ai-strip__views">
        <div v-if="digest.shortTermView" class="ai-strip__view">
          <span class="ai-strip__view-label">短线</span>
          <span>{{ digest.shortTermView }}</span>
        </div>
        <div v-if="digest.longTermView" class="ai-strip__view">
          <span class="ai-strip__view-label">中线</span>
          <span>{{ digest.longTermView }}</span>
        </div>
      </div>
      <div v-if="digest.keyRisks?.length" class="ai-strip__risks">
        <span class="ai-strip__risks-label">风险提示</span>
        <span v-for="(r, i) in digest.keyRisks.slice(0, 2)" :key="i" class="ai-strip__risk-item">{{ r }}</span>
      </div>
    </div>
  </div>
  <div v-else class="home-tab-panel">
    <div v-if="!digest && !context" class="skel-layout">
      <section class="ai-hero">
        <div class="ai-hero__bar">
          <div class="ai-hero__left">
            <span class="ai-hero__tag">AI ASSESSMENT</span>
            <span class="skel skel--lg skel--w160" style="margin-top: 2px;"></span>
          </div>
          <div class="ai-hero__actions">
            <span class="skel skel--sm skel--w60"></span>
            <span class="skel skel--sm skel--w80"></span>
          </div>
        </div>
        <div class="skel-metric-strip">
          <div v-for="i in 6" :key="i" class="skel-metric-cell">
            <span class="skel skel--xs skel--w40"></span>
            <span class="skel skel--lg skel--w80"></span>
            <span class="skel skel--xs skel--w60"></span>
          </div>
        </div>
      </section>
      <div class="panel-split">
        <section class="panel-split__col">
          <div class="section-bar"><span class="section-bar__tag">SCENARIO</span><span class="section-bar__title">盘面三种路径</span></div>
          <div class="skel-rows">
            <div v-for="i in 3" :key="i" class="skel-block"><span class="skel skel--sm skel--w100"></span><span class="skel skel--xs skel--wfull skel--block"></span></div>
          </div>
        </section>
        <div class="panel-split__vr"></div>
        <section class="panel-split__col">
          <div class="section-bar"><span class="section-bar__tag">FACTS</span><span class="section-bar__title">本轮推理证据</span></div>
          <div class="skel-rows">
            <div v-for="i in 5" :key="i" class="skel-block"><span class="skel skel--sm skel--wfull"></span></div>
          </div>
        </section>
      </div>
      <div class="panel-split">
        <section v-for="k in 2" :key="k" class="panel-split__col">
          <div class="section-bar"><span class="skel skel--xs skel--w48"></span><span class="skel skel--sm skel--w100"></span></div>
          <div class="skel-rows">
            <div v-for="i in 6" :key="i" class="skel-row"><span class="skel skel--sm skel--w80"></span><span class="skel skel--xs skel--w48"></span></div>
          </div>
        </section>
      </div>
    </div>
    <div v-else class="ai-layout">
      <section class="ai-hero">
        <div class="ai-hero__bar">
          <div class="ai-hero__left">
            <span class="ai-hero__tag">AI ASSESSMENT</span>
            <h2 class="ai-hero__headline">{{ digest?.headline || '当前还没有生成 AI 总判断' }}</h2>
          </div>
          <div class="ai-hero__actions">
            <span class="mood-badge" :class="marketMood">
              {{ digest?.confidenceLabel || '等待评估' }}
            </span>
            <button
              v-if="!digestLoading"
              type="button"
              class="action-btn"
              @click="$emit('request-digest')"
            >重新评估</button>
            <button
              v-else
              type="button"
              class="action-btn action-btn--stop"
              @click="$emit('cancel-digest')"
            >停止评估</button>
          </div>
        </div>
        <p class="ai-hero__summary">
          {{ digest?.summary || '先看下方证据层、情景推演与候选标的，AI 未返回时也能完成人工决策。' }}
        </p>
        <div class="metric-strip">
          <div v-for="item in context?.evidenceCards || []" :key="item.label" class="metric-cell" :class="item.tone">
            <span class="metric-cell__label">{{ item.label }}</span>
            <strong class="metric-cell__value" :class="{ 'metric-cell__value--pulse': isTurnoverPulseCard(item) }">
              <template v-if="isTurnoverPulseCard(item)">
                <span>{{ formatTurnoverPulse(item.value).compact }}</span>
                <small v-if="formatTurnoverPulse(item.value).compressed">{{ formatTurnoverPulse(item.value).full }}</small>
              </template>
              <template v-else>{{ item.value }}</template>
            </strong>
            <span class="metric-cell__detail">{{ item.detail }}</span>
          </div>
        </div>
      </section>

      <div class="panel-split">
        <section class="panel-split__col">
          <div class="section-bar">
            <span class="section-bar__tag">SCENARIO</span>
            <span class="section-bar__title">盘面三种路径</span>
          </div>
          <div class="scenario-rows">
            <article v-for="item in context?.scenarioCards || []" :key="item.label" class="scenario-row">
              <span class="scenario-row__label">{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
              <p>{{ item.detail }}</p>
            </article>
          </div>
        </section>

        <div class="panel-split__vr"></div>

        <section class="panel-split__col">
          <div class="section-bar">
            <span class="section-bar__tag">FACTS</span>
            <span class="section-bar__title">本轮推理证据</span>
          </div>
          <ul class="fact-list">
            <li v-for="fact in context?.facts || []" :key="fact">{{ fact }}</li>
          </ul>
        </section>
      </div>

      <div class="panel-split">
        <section class="panel-split__col">
          <div class="section-bar">
            <span class="section-bar__tag">THEMES</span>
            <span class="section-bar__title">AI 关注主线</span>
          </div>
          <div class="theme-rows">
            <article v-for="item in context?.focusThemes || []" :key="item.code" class="theme-row">
              <div class="theme-row__left">
                <strong>{{ item.name }}</strong>
                <span>领涨 {{ item.leadingStock || '待同步' }}</span>
              </div>
              <strong :class="item.changePercent >= 0 ? 'up' : 'down'">
                {{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%
              </strong>
            </article>
          </div>
        </section>

        <div class="panel-split__vr"></div>

        <section class="panel-split__col">
          <div class="section-bar">
            <span class="section-bar__tag">CANDIDATES</span>
            <span class="section-bar__title">评估输入样本</span>
          </div>
          <div class="candidate-rows">
            <button
              v-for="item in context?.candidates || []"
              :key="item.code"
              class="candidate-row"
              @click="$emit('navigate-stock', item.code)"
            >
              <div class="candidate-row__left">
                <strong>{{ item.name }}</strong>
                <span>{{ item.code }}</span>
              </div>
              <div class="candidate-row__right">
                <strong :class="item.changePercent >= 0 ? 'up' : 'down'">
                  {{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%
                </strong>
                <span>{{ formatAmount(item.amount) }}</span>
              </div>
            </button>
          </div>
        </section>
      </div>

      <section v-if="digest?.watchStocks?.length">
        <div class="section-bar">
          <span class="section-bar__tag">EXECUTION</span>
          <span class="section-bar__title">AI 明确执行清单</span>
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

      <section v-if="digest">
        <div class="section-bar">
          <span class="section-bar__tag">NARRATIVE</span>
          <span class="section-bar__title">市场推演与推荐</span>
        </div>
        <div class="narrative-grid">
          <article class="narrative-cell">
            <span>消息面</span>
            <p>{{ digest.newsView }}</p>
          </article>
          <article class="narrative-cell">
            <span>政策面</span>
            <p>{{ digest.policyView }}</p>
          </article>
          <article class="narrative-cell">
            <span>国际面</span>
            <p>{{ digest.globalView }}</p>
          </article>
          <article class="narrative-cell">
            <span>短线关注</span>
            <p>{{ digest.shortTermView }}</p>
          </article>
          <article class="narrative-cell">
            <span>长线关注</span>
            <p>{{ digest.longTermView }}</p>
          </article>
          <article class="narrative-cell">
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
  mode?: 'strip' | 'full'
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
$panel-border: $border-light;
$row-border: rgba(29, 38, 55, 0.05);
$row-hover: rgba($color-accent, 0.04);
$text-bright: $text-primary;
$text-dim: $text-secondary;
$text-label: $text-muted;
$up: $color-up;
$down: $color-down;
$accent: $color-accent;

.home-tab-panel {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.panel-split {
  display: flex;
  border-bottom: 1px solid $panel-border;
}

.panel-split__col {
  flex: 1;
  min-width: 0;
}

.panel-split__vr {
  width: 1px;
  background: $panel-border;
  align-self: stretch;
}

.ai-hero {
  padding: 0 20px 16px;
  border-bottom: 1px solid $panel-border;
  background: linear-gradient(180deg, rgba($accent, 0.06), transparent 60%);
}

.ai-hero__bar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 0 10px;
}

.ai-hero__left {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.ai-hero__tag {
  font-family: $font-mono;
  font-size: $text-2xs;
  font-weight: $weight-bold;
  letter-spacing: 0.16em;
  color: $accent;
  text-transform: uppercase;
  opacity: 0.7;
  white-space: nowrap;
}

.ai-hero__headline {
  margin: 0;
  font-size: 16px;
  font-family: $font-display;
  color: $text-bright;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.3;
}

.ai-hero__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.mood-badge {
  padding: 5px 10px;
  border: 1px solid $panel-border;
  border-radius: 2px;
  font-size: 11px;
  font-weight: 600;
  font-family: $font-mono;
  background: transparent;
  color: $text-label;

  &.risk-on {
    border-color: rgba($up, 0.3);
    color: $up;
    background: rgba($up, 0.06);
  }

  &.risk-off {
    border-color: rgba($down, 0.3);
    color: $down;
    background: rgba($down, 0.06);
  }
}

.action-btn {
  border: 1px solid $accent;
  cursor: pointer;
  padding: 5px 12px;
  border-radius: 2px;
  background: $accent;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  font-family: $font-family;
  transition: all $transition-fast;

  &--stop {
    background: transparent;
    color: $down;
    border-color: rgba($down, 0.4);
  }
}

.ai-hero__summary {
  margin: 0;
  color: $text-dim;
  font-size: 13px;
  line-height: 1.7;
}

.metric-strip {
  display: flex;
  gap: 0;
  margin-top: 14px;
  border: 1px solid $panel-border;
  border-radius: 2px;
  overflow: hidden;
}

.metric-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px;
  border-right: 1px solid $panel-border;
  background: rgba(255, 255, 255, 0.6);

  &:last-child { border-right: none; }
}

.metric-cell__label {
  font-size: $text-2xs;
  font-family: $font-mono;
  color: $text-label;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

.metric-cell__value {
  font-size: 18px;
  font-family: $font-display;
  color: $text-bright;
  font-weight: 700;
  letter-spacing: -0.02em;

  &--pulse {
    display: inline-flex;
    align-items: flex-end;
    gap: 4px;

    small {
      font-size: $text-xs;
      color: $text-label;
      font-family: $font-mono;
    }
  }
}

.metric-cell__detail {
  font-size: 10px;
  color: $text-label;
}

.scenario-rows,
.candidate-rows,
.theme-rows {
  padding: 4px 20px;
  max-height: 380px;
  overflow: auto;
  @include no-scrollbar;
}

.scenario-row {
  padding: 8px 0;
  border-bottom: 1px solid $row-border;

  &:last-child { border-bottom: none; }

  &__label {
    font-family: $font-mono;
    font-size: $text-2xs;
    color: $text-label;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
  }

  strong {
    display: block;
    margin-top: 2px;
    font-size: 12px;
    color: $text-bright;
    font-weight: 600;
  }

  p {
    margin: 4px 0 0;
    color: $text-dim;
    font-size: 12px;
    line-height: 1.5;
  }
}

.fact-list {
  margin: 0;
  padding: 8px 20px 8px 42px;
  max-height: 380px;
  overflow: auto;
  @include no-scrollbar;

  li {
    padding: 4px 0;
    color: $text-dim;
    font-size: 12px;
    line-height: 1.7;
    border-bottom: 1px solid $row-border;
  }
}

.theme-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid $row-border;

  &:last-child { border-bottom: none; }

  &__left {
    display: flex;
    flex-direction: column;
    gap: 2px;

    strong {
      font-size: 12px;
      font-weight: 600;
      color: $text-bright;
    }

    span {
      font-size: 10px;
      color: $text-label;
    }
  }

  > strong {
    font-family: $font-mono;
    font-size: 12px;
    font-weight: 600;
  }
}

.candidate-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 7px 0;
  border-bottom: 1px solid $row-border;
  background: transparent;
  border-left: 0;
  border-right: 0;
  border-top: 0;
  text-align: left;
  cursor: pointer;
  width: 100%;
  font-family: $font-family;
  transition: background $transition-fast;

  &:hover { background: $row-hover; }

  &__left {
    display: flex;
    flex-direction: column;
    gap: 2px;

    strong {
      font-size: 12px;
      font-weight: 600;
      color: $text-bright;
    }

    span {
      font-family: $font-mono;
      font-size: $text-xs;
      color: $text-label;
    }
  }

  &__right {
    display: flex;
    align-items: baseline;
    gap: 8px;
    text-align: right;

    strong {
      font-family: $font-mono;
      font-size: 12px;
      font-weight: 600;
    }

    span {
      font-size: 10px;
      color: $text-label;
      font-family: $font-mono;
    }
  }
}

.watch-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-top: 1px solid $panel-border;

  > :nth-child(3n + 2),
  > :nth-child(3n) {
    border-left: 1px solid $panel-border;
  }
}

.watch-card {
  padding: 14px 20px;
  border-bottom: 1px solid $row-border;
  background: transparent;
  text-align: left;
  cursor: pointer;
  font-family: $font-family;
  transition: background $transition-fast;

  &:hover { background: $row-hover; }

  p {
    margin: 10px 0 0;
    color: $text-dim;
    font-size: 12px;
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
  strong,
  span,
  small {
    display: block;
  }

  strong {
    margin-top: 3px;
    font-family: $font-display;
    color: $text-bright;
    font-size: 13px;
    font-weight: 700;
  }

  small {
    margin-top: 2px;
    color: $text-label;
    font-size: 10px;
    font-family: $font-mono;
  }
}

.watch-card__style,
.watch-card__action,
.watch-card__prices span,
.watch-card__risk {
  font-size: $text-xs;
  font-family: $font-mono;
  color: $text-label;
  letter-spacing: 0.04em;
}

.watch-card__action {
  padding: 3px 8px;
  border: 1px solid rgba($accent, 0.2);
  border-radius: 2px;
  color: $accent;
  font-weight: 600;
}

.watch-card__prices {
  margin-top: 10px;

  div { flex: 1; }

  strong {
    display: block;
    margin-top: 2px;
    color: $text-bright;
    font-size: 12px;
  }
}

.watch-card__risk {
  display: block;
  margin-top: 8px;
}

.narrative-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-top: 1px solid $panel-border;

  > :nth-child(3n + 2),
  > :nth-child(3n) {
    border-left: 1px solid $panel-border;
  }
}

.narrative-cell {
  padding: 12px 20px;
  border-bottom: 1px solid $row-border;

  span {
    display: block;
    font-family: $font-mono;
    font-size: $text-2xs;
    color: $text-label;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
  }

  p {
    margin: 6px 0 0;
    color: $text-dim;
    font-size: 12px;
    line-height: 1.6;
  }
}

.up { color: $up; }
.down { color: $down; }

.home-tab-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 220px;
  color: $text-dim;
  font-size: 13px;
}

.home-tab-empty--error {
  min-height: auto;
  padding: 14px 20px;
  justify-content: flex-start;
  color: $down;
}

.skel-layout {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.skel-metric-strip {
  display: flex;
  gap: 0;
  margin-top: 14px;
  border: 1px solid $panel-border;
  border-radius: 2px;
  overflow: hidden;
}

.skel-metric-cell {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 14px;
  border-right: 1px solid $panel-border;
  background: rgba(255, 255, 255, 0.6);

  &:last-child { border-right: none; }
}

.skel-rows {
  padding: 8px 20px;
}

.skel-row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 7px 0;
  border-bottom: 1px solid $row-border;
}

.skel-block {
  padding: 8px 0;
  border-bottom: 1px solid $row-border;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

@media (max-width: 1200px) {
  .panel-split { flex-direction: column; }
  .panel-split__vr { width: auto; height: 1px; }
  .metric-strip { flex-wrap: wrap; }
  .metric-cell { min-width: 33%; border-right: none; border-bottom: 1px solid $panel-border; }
  .watch-grid,
  .narrative-grid { grid-template-columns: 1fr; }
  .watch-grid > :nth-child(3n + 2),
  .watch-grid > :nth-child(3n),
  .narrative-grid > :nth-child(3n + 2),
  .narrative-grid > :nth-child(3n) {
    border-left: none;
  }
}

/* ─── Strip Mode (collapsible focus bar) ─── */
.ai-strip {
  margin: 8px 24px 4px;
  border: 1px solid $border-light;
  border-radius: $radius-sm;
  background: linear-gradient(180deg, rgba($accent, 0.04), transparent 80%);
  overflow: hidden;
  flex-shrink: 0;
}

.ai-strip__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
}

.ai-strip__left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.ai-strip__tag {
  font-family: $font-mono;
  font-size: $text-2xs;
  font-weight: $weight-bold;
  letter-spacing: 0.12em;
  color: $accent;
  text-transform: uppercase;
  opacity: 0.7;
  flex-shrink: 0;
}

.ai-strip__headline {
  font-size: $text-sm;
  font-weight: $weight-medium;
  color: $text-primary;
  @include ellipsis;
}

.ai-strip__loading {
  font-size: $text-sm;
  color: $text-muted;
}

.ai-strip__error {
  font-size: $text-sm;
  color: $color-down;
}

.ai-strip__placeholder {
  font-size: $text-sm;
  color: $text-muted;
}

.ai-strip__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ai-strip__btn {
  border: 1px solid $accent;
  cursor: pointer;
  padding: 3px 10px;
  border-radius: 2px;
  background: $accent;
  color: #fff;
  font-size: $text-xs;
  font-weight: $weight-medium;
  font-family: $font-family;
  transition: all $transition-fast;

  &--stop {
    background: transparent;
    color: $color-down;
    border-color: rgba($color-down, 0.4);
  }
}

.ai-strip__body {
  padding: 0 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ai-strip__summary {
  margin: 0;
  font-size: $text-sm;
  color: $text-secondary;
  line-height: $leading-relaxed;
}

.ai-strip__themes {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.ai-strip__theme-tag {
  font-size: $text-2xs;
  font-weight: $weight-label;
  padding: 2px 8px;
  border-radius: 2px;
  background: rgba($accent, 0.08);
  color: $accent;
}

.ai-strip__stocks {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 6px;
}

.ai-strip__stock {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
  border-radius: $radius-xs;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba($accent, 0.06);
  cursor: pointer;
  transition: all $transition-fast;

  &:hover {
    background: rgba(255, 255, 255, 0.9);
    border-color: rgba($accent, 0.15);
  }
}

.ai-strip__stock-name {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: $text-sm;
  font-weight: $weight-medium;
  color: $text-primary;

  em {
    font-style: normal;
    font-size: $text-2xs;
    padding: 1px 4px;
    border-radius: 2px;
    font-weight: $weight-label;
  }

  .tag-short {
    background: rgba($up, 0.1);
    color: $up;
  }

  .tag-long {
    background: rgba($accent, 0.1);
    color: $accent;
  }
}

.ai-strip__stock-prices {
  display: flex;
  gap: 8px;
  font-size: $text-2xs;
  color: $text-muted;

  b {
    font-family: $font-mono;
    font-weight: $weight-medium;
    color: $text-secondary;
  }

  .price-exit b {
    color: $up;
  }

  .price-stop b {
    color: $down;
  }
}

.ai-strip__stock-meta {
  display: flex;
  gap: 6px;
  font-size: $text-2xs;
  color: $text-muted;

  .time-window {
    color: rgba($color-warning, 0.9);
  }
}

.ai-strip__views {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  border-radius: $radius-xs;
  background: rgba(0, 0, 0, 0.015);
}

.ai-strip__view {
  font-size: $text-xs;
  color: $text-secondary;
  line-height: $leading-relaxed;
  display: flex;
  gap: 6px;
}

.ai-strip__view-label {
  font-weight: $weight-medium;
  color: $text-muted;
  flex-shrink: 0;
  min-width: 24px;
}

.ai-strip__risks {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
}

.ai-strip__risks-label {
  font-size: $text-2xs;
  font-weight: $weight-label;
  color: $color-down;
  opacity: 0.7;
  flex-shrink: 0;
}

.ai-strip__risk-item {
  font-size: $text-2xs;
  color: $text-muted;

  &::before {
    content: '·';
    margin-right: 4px;
  }
}
</style>
