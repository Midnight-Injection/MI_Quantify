<template>
  <div class="home-tab-panel">
    <div v-if="loading && !data" class="home-tab-empty"><span class="spinner"></span><span>加载板块工作台...</span></div>
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
              <span class="panel-card__eyebrow">板块热力图</span>
              <h3>主线热区与切换</h3>
            </div>
          </div>
          <div class="heatmap-grid">
            <button
              v-for="item in data.heatmap"
              :key="item.code"
              class="heatmap-cell"
              :class="[item.changePercent >= 0 ? 'up' : 'down', { active: item.code === selectedSectorCode }]"
              @click="$emit('select-sector', item.code)"
            >
              <strong>{{ item.label }}</strong>
              <span>{{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%</span>
              <small>{{ item.detail }}</small>
            </button>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">板块排行</span>
              <h3>行业 / 主题前排</h3>
            </div>
          </div>
          <div class="leader-list">
            <button
              v-for="item in data.leaders"
              :key="item.code"
              class="leader-row"
              @click="$emit('select-sector', item.code)"
            >
              <div>
                <strong>{{ item.name }}</strong>
                <span>{{ item.leadingStock || '待同步' }}</span>
              </div>
              <div class="leader-row__right">
                <strong :class="item.changePercent >= 0 ? 'up' : 'down'">
                  {{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%
                </strong>
                <span>{{ formatAmount(item.amount || 0) }}</span>
              </div>
            </button>
          </div>
        </article>
      </section>

      <section class="panel-card">
        <div class="panel-card__head">
          <div>
            <span class="panel-card__eyebrow">板块成分股</span>
            <h3>{{ focusTitle }}</h3>
          </div>
        </div>
        <div v-if="membersLoading" class="members-empty">正在同步板块成分股...</div>
        <div v-else-if="members.length" class="member-grid">
          <button
            v-for="item in members"
            :key="item.code"
            class="member-card"
            @click="$emit('navigate-stock', item.code)"
          >
            <strong>{{ item.name }}</strong>
            <span>{{ item.code }}</span>
            <b :class="item.changePercent >= 0 ? 'up' : 'down'">
              {{ item.changePercent >= 0 ? '+' : '' }}{{ item.changePercent.toFixed(2) }}%
            </b>
            <small>{{ formatAmount(item.amount) }}</small>
          </button>
        </div>
        <div v-else class="members-empty">当前板块暂无可展示的成分股样本。</div>
      </section>
    </template>
    <div v-else class="home-tab-empty home-tab-empty--error">热门板块暂时没有可用数据。</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { HomeSectorData, StockListItem } from '@/types'
import { formatAmount } from '@/utils/format'

const props = defineProps<{
  loading: boolean
  data: HomeSectorData | null
  selectedSectorCode: string
  membersLoading: boolean
  members: StockListItem[]
}>()

defineEmits<{
  (e: 'select-sector', code: string): void
  (e: 'navigate-stock', code: string): void
}>()

const focusTitle = computed(() => {
  const focus = props.data?.leaders.find((item) => item.code === props.selectedSectorCode)
    || props.data?.focusSector
  return focus ? `${focus.name} · 成分股工作台` : '板块成分股工作台'
})
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.panel-grid--wide {
  grid-template-columns: 0.9fr 1.1fr;
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
.leader-row span,
.member-card span,
.member-card small,
.heatmap-cell small {
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
}

.panel-card__head h3 {
  margin: 4px 0 0;
}

.heatmap-grid,
.leader-list,
.member-grid {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.heatmap-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  max-height: 382px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.leader-list {
  grid-template-columns: 1fr;
  max-height: 382px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.member-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  max-height: 430px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.heatmap-cell,
.leader-row,
.member-card {
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(15, 33, 57, 0.08);
  background: rgba(247, 244, 238, 0.92);
  text-align: left;
}

.heatmap-cell strong,
.leader-row strong,
.member-card strong {
  color: $text-primary;
}

.heatmap-cell span,
.heatmap-cell small,
.member-card b,
.member-card small {
  display: block;
  margin-top: 6px;
}

.leader-row,
.member-card {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.leader-row__right {
  text-align: right;
}

.member-card {
  flex-direction: column;
}

.members-empty {
  margin-top: 14px;
  padding: 14px 16px;
  border-radius: 14px;
  background: rgba(247, 244, 238, 0.92);
  color: $text-secondary;
}

.active {
  border-color: rgba($color-accent, 0.28);
  box-shadow: 0 10px 25px rgba($color-accent, 0.1);
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
  .member-grid,
  .summary-grid,
  .panel-grid--wide {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .heatmap-grid,
  .member-grid,
  .summary-grid,
  .panel-grid--wide {
    grid-template-columns: 1fr;
  }
}
</style>
