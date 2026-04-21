<template>
  <div class="home-tab-panel">
    <div v-if="loading && !data" class="home-tab-empty"><span class="spinner"></span><span>加载新闻脉冲...</span></div>
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
              <span class="panel-card__eyebrow">最新快讯</span>
              <h3>消息流</h3>
            </div>
          </div>
          <div class="news-list">
            <article v-for="item in data.latest" :key="item.id" class="news-row">
              <div class="news-row__meta">
                <strong>{{ item.title }}</strong>
                <span>{{ item.source || '快讯' }} · {{ item.publishTime || '--' }}</span>
              </div>
              <p>{{ item.content || '暂无摘要' }}</p>
            </article>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">热议主题</span>
              <h3>主题簇</h3>
            </div>
          </div>
          <div class="topic-list">
            <article v-for="item in data.hotTopics" :key="item.label" class="topic-card">
              <span>{{ item.label }}</span>
              <strong>{{ item.count }}</strong>
              <small>{{ item.headline }}</small>
            </article>
          </div>
        </article>
      </section>

      <section class="panel-grid panel-grid--two">
        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">主题分组</span>
              <h3>市场消息地图</h3>
            </div>
          </div>
          <div class="group-list">
            <article v-for="item in data.groups" :key="item.label" class="group-card">
              <div class="group-card__head">
                <strong>{{ item.label }}</strong>
                <span>{{ item.count }} 条</span>
              </div>
              <ul>
                <li v-for="news in item.items.slice(0, 4)" :key="news.id">{{ news.title }}</li>
              </ul>
            </article>
          </div>
        </article>

        <article class="panel-card">
          <div class="panel-card__head">
            <div>
              <span class="panel-card__eyebrow">事件时间线</span>
              <h3>宏观与财报线索</h3>
            </div>
          </div>
          <div class="timeline-list">
            <article v-for="item in data.timeline" :key="item.id" class="timeline-row">
              <span>{{ item.publishTime || '--' }}</span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.source || '快讯' }}</small>
            </article>
          </div>
        </article>
      </section>
    </template>
    <div v-else class="home-tab-empty home-tab-empty--error">新闻脉冲暂时没有可用数据。</div>
  </div>
</template>

<script setup lang="ts">
import type { HomeNewsData } from '@/types'

defineProps<{
  loading: boolean
  data: HomeNewsData | null
}>()
</script>

<style scoped lang="scss">
.home-tab-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.summary-grid,
.panel-grid,
.topic-list,
.group-list,
.timeline-list,
.news-list {
  display: grid;
  gap: 14px;
  align-items: start;
}

.summary-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.panel-grid--wide,
.panel-grid--two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.topic-list {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 14px;
  max-height: 408px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.group-list,
.timeline-list,
.news-list {
  margin-top: 14px;
  max-height: 448px;
  overflow: auto;
  padding-right: 4px;
  @include custom-scrollbar;
}

.summary-card,
.panel-card,
.topic-card,
.group-card,
.timeline-row,
.news-row {
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
.topic-card span,
.topic-card small,
.group-card span,
.timeline-row span,
.timeline-row small,
.news-row__meta span {
  font-size: 11px;
  color: $text-muted;
}

.summary-card__value,
.panel-card__head h3,
.topic-card strong,
.timeline-row strong,
.news-row__meta strong {
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

.topic-card strong,
.topic-card small,
.timeline-row span,
.timeline-row small {
  display: block;
}

.topic-card small,
.timeline-row small {
  margin-top: 6px;
  line-height: 1.5;
}

.group-card__head,
.news-row__meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.group-card ul {
  margin: 10px 0 0;
  padding-left: 18px;

  li {
    color: $text-secondary;
    line-height: 1.6;
  }
}

.news-row p {
  margin: 8px 0 0;
  color: $text-secondary;
  line-height: 1.7;
}

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
  .topic-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .summary-grid,
  .panel-grid--wide,
  .panel-grid--two,
  .topic-list {
    grid-template-columns: 1fr;
  }
}
</style>
