# 前端开发规范 (Vue 3 + TypeScript)

> 本文档定义 MI Quantify 前端开发的所有强制规范和最佳实践。

---

## 1. 多文件组件结构（强制）

每个页面视图 (`views/`) 和复杂组件 (`components/`) **必须**使用多文件组件结构：

```
FeatureModule/
├── index.vue          # 胶水文件，引用其他三文件（不超过 5 行）
├── script.ts          # 组件逻辑（defineComponent）
├── template.html      # HTML 模板
└── style.scss         # 样式（必须独立，禁止写入 .vue）
```

### index.vue 标准格式

```vue
<template src="./template.html"></template>
<script lang="ts" src="./script.ts"></script>
<style lang="scss" scoped src="./style.scss"></style>
```

### 简单组件例外

仅对于极简组件（如纯展示、无逻辑、无样式的包装组件），允许使用单文件 `.vue` 格式，但行数不得超过 50 行。

---

## 2. CSS 隔离规则（强制）

### 2.1 核心规则

1. **禁止在 `.vue` 文件的 `<style>` 标签中直接编写 CSS**，必须引用独立的 `.scss` 文件
2. 所有组件样式使用 `scoped` 属性确保样式隔离
3. 全局样式仅允许在 `assets/styles/` 目录下定义
4. 颜色、间距、阴影等必须使用 `_variables.scss` 中的变量，禁止硬编码
5. 复用的样式片段使用 `_mixins.scss` 中的 mixin

### 2.2 正确 vs 错误示例

```scss
/* ✅ 正确：使用变量和 mixin */
.hero-panel {
  background: $bg-card;
  border-radius: $radius-lg;
  box-shadow: $shadow-md;
  @include glass-effect;
}

/* ❌ 错误：硬编码魔法值 */
.hero-panel {
  background: rgba(255, 255, 255, 0.82);
  border-radius: 16px;
  box-shadow: 0 18px 40px rgba(29, 38, 55, 0.06);
}
```

### 2.3 样式文件拆分

当 `style.scss` 超过 500 行时，使用 `@use` 导入 partial 文件：

```
HomeView/
├── style.scss             # 主入口，仅 @use 其他文件
├── _hero.scss             # 顶部面板样式
├── _market-overview.scss  # 行情概览样式
├── _fund-flow.scss        # 资金流向样式
└── _policy-theme.scss     # 政策主题样式
```

```scss
// style.scss — 仅作为样式入口
@use './hero' as *;
@use './market-overview' as *;
@use './fund-flow' as *;
@use './policy-theme' as *;
```

### 2.4 BEM 命名约定

```scss
/* 页面级：页面名 + 区块 + 元素 + 修饰符 */
.home-page {}
.home-page__hero-title {}
.home-page__hero-title--active {}

/* 组件级：组件名 + 区块 + 元素 + 修饰符 */
.kline-chart {}
.kline-chart__toolbar {}
.kline-chart__toolbar-btn {}
.kline-chart__toolbar-btn--selected {}
```

---

## 3. 文件大小限制与拆分策略

### 3.1 行数限制

| 文件类型 | 最大行数 |
|---------|---------|
| `.ts` | 500 行 |
| `.vue` | 50 行（仅限简单组件） |
| `.scss` | 500 行 |
| `.html` | 500 行 |

### 3.2 拆分优先级

当一个组件的 `script.ts` 超过 500 行时，按以下顺序拆分：

```
1. 提取业务逻辑 → composables/
   - 将数据获取、状态计算、事件处理提取为独立的 composable
   - 命名: use[Feature].ts，如 useHomeMarket.ts, useHomeAiDigest.ts

2. 提取子组件 → 同级目录或 components/
   - 将模板中的独立 UI 区块拆分为子组件
   - 子组件同样遵循多文件结构

3. 提取工具函数 → utils/
   - 纯函数、格式化、计算逻辑提取为工具函数

4. 提取常量配置 → utils/constants/ 目录下按功能拆分
   - 如 constants/ai.ts, constants/market.ts, constants/navigation.ts

5. 提取类型定义 → types/
   - 确保类型定义集中管理
```

### 3.3 拆分示例

```
HomeView/ (原 1482 行 script.ts)
├── index.vue
├── script.ts              # 仅保留组件定义和子模块组合（<200 行）
├── template.html
├── style.scss             # 如超过 500 行则拆分为多个 partial
├── components/            # 子组件
│   ├── HeroPanel/
│   │   ├── index.vue
│   │   ├── script.ts
│   │   ├── template.html
│   │   └── style.scss
│   ├── MarketOverview/
│   ├── FundFlowCard/
│   └── PolicyThemePanel/
└── composables/           # 或提取到顶层 composables/
    ├── useHomeMarket.ts
    ├── useHomeAiDigest.ts
    └── useHomePolicy.ts
```

---

## 4. 类型定义规范

### 4.1 类型文件组织

```
src/types/
├── index.ts          # 统一导出所有类型
├── ai.ts             # AI 相关类型
├── stock.ts          # 股票、K 线、板块类型
├── settings.ts       # 应用设置类型 + DEFAULT_SETTINGS
├── strategy.ts       # 策略、信号、提示词模板
├── notification.ts   # 通知类型
├── news.ts           # 新闻类型
├── investment.ts     # 投资类型
├── recommendation.ts # 推荐类型
├── ask.ts            # AI 问股模式类型
├── insight.ts        # AI 洞察类型
└── strategy-pattern.ts  # 策略模式接口
```

### 4.2 注释规范

```typescript
/**
 * AI 提供商配置
 * @property id - 唯一标识符
 * @property name - 显示名称
 * @property enabled - 是否启用
 * @property apiUrl - API 端点地址
 * @property model - 模型标识
 * @property maxTokens - 最大生成 token 数
 * @property temperature - 生成温度 (0.0-2.0)
 * @property apiKey - API 密钥（敏感信息，禁止日志输出）
 * @property proxyId - 关联的代理配置 ID
 */
export interface AiProvider {
  id: string
  name: string
  enabled: boolean
  apiUrl: string
  model: string
  maxTokens: number
  temperature: number
  apiKey: string
  proxyId?: string
}
```

### 4.3 类型使用规则

- **禁止使用 `any`**，除非有充分理由并添加注释说明
- 可选字段使用 `field?: Type` 或 `field: Type | null`
- 联合类型使用字面量联合：`type MarketType = 'a' | 'hk' | 'us'`
- 导出类型统一从 `@/types` 导入，不直接引用子文件

---

## 5. 常量管理规范

当前 `utils/constants.ts` 已达 970 行，**必须拆分**为独立模块：

```
src/utils/constants/
├── index.ts          # 统一导出（re-export 所有子模块）
├── app.ts            # APP_NAME, PYTHON_SIDECAR_PORT, NAV_ITEMS
├── ai.ts             # AI_PROVIDER_PRESETS, AI 相关预设
├── market.ts         # DATA_SOURCE_PRESETS, 市场相关常量
├── search.ts         # SEARCH_PROVIDER_PRESETS, 搜索相关常量
├── strategy.ts       # STRATEGY_PRESETS, 策略预设和提示词模板
└── policy.ts         # POLICY_THEME_PRESETS 等政策主题配置
```

### 迁移原则

1. `index.ts` 使用 `export * from './app'` 统一导出，保持现有导入路径不变
2. 按业务领域拆分，每个文件不超过 300 行
3. 类型导入从 `@/types` 获取，禁止循环依赖

---

## 6. Pinia Store 规范

### 6.1 结构模板

```typescript
/**
 * @store useSettingsStore
 * @description 应用全局设置状态管理
 */
export const useSettingsStore = defineStore('settings', () => {
  // ===== 状态 =====
  const settings = ref<AppSettings>(/* ... */)
  const initialized = ref(false)

  // ===== 计算属性 =====
  const activeProvider = computed(() => /* ... */)

  // ===== 方法 =====
  /** 加载设置，优先从本地存储恢复 */
  async function loadSettings() { /* ... */ }

  /** 保存设置到本地存储 */
  async function saveSettings() { /* ... */ }

  // ===== 生命周期 =====
  watch(settings, saveSettings, { deep: true })

  return { settings, initialized, activeProvider, loadSettings, saveSettings }
})
```

### 6.2 Store 设计原则

- 每个 Store 职责单一，按业务领域划分
- Store 文件不超过 500 行，超出时提取 computed 和 method 到 composable
- 异步操作必须包含 `loading` 和 `error` 状态
- 通过 `watch` 自动持久化到 Rust 层

---

## 7. Composable 规范

### 7.1 结构模板

```typescript
/**
 * @composable usePolling
 * @description 通用轮询组合式函数，支持启动、停止、手动触发
 * @param fetchFn - 数据获取函数
 * @param intervalMs - 轮询间隔（毫秒）
 * @returns 轮询控制方法和状态
 */
export function usePolling<T>(
  fetchFn: () => Promise<T>,
  intervalMs: number
) {
  const data = ref<T | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

  /** 启动轮询 */
  function start() { /* ... */ }

  /** 停止轮询 */
  function stop() { /* ... */ }

  /** 手动触发一次获取 */
  async function refresh() { /* ... */ }

  onUnmounted(stop)

  return { data, loading, error, start, stop, refresh }
}
```

### 7.2 Composable 设计原则

- 命名必须以 `use` 开头：`useAiChat`、`usePolling`
- 返回值使用解构赋值：`const { data, loading } = usePolling(...)`
- 必须在 `onUnmounted` 中清理副作用（定时器、事件监听、AbortController）
- 文件不超过 500 行，超出时按功能拆分为多个 composable

---

## 8. 路径别名

- `@` → `src/`（在 `vite.config.ts` 和 `tsconfig.json` 中配置）
- **禁止**使用相对路径跨层引用

```typescript
// ✅ 正确
import { formatAmount } from '@/utils/format'
import { useSettingsStore } from '@/stores/settings'
import type { AiProvider } from '@/types'

// ❌ 错误
import { formatAmount } from '../../../utils/format'
```

---

## 9. 设计模式

### 9.1 组合式函数模式（Composable Pattern）

将组件逻辑提取为可复用的组合式函数，这是前端最核心的设计模式。

```typescript
// composables/usePolling.ts
export function usePolling<T>(fetchFn: () => Promise<T>, intervalMs: number) {
  const data = ref<T | null>(null)
  const loading = ref(false)
  onUnmounted(() => stop())
  return { data, loading, start, stop }
}

// views/SomeView/script.ts
const { data: marketData, start, stop } = usePolling(fetchMarket, 5000)
```

### 9.2 策略模式（Strategy Pattern）

**已应用于**：`strategies/LlmProviderStrategies.ts`、`strategies/DataSourceStrategies.ts`

```typescript
/** LLM 提供商策略接口 */
export interface LlmProviderStrategy {
  buildRequest(prompt: string, options: ChatOptions): RequestConfig
  parseResponse(response: unknown): ParsedResponse
}

/** 策略注册表 */
const strategies: Record<string, LlmProviderStrategy> = {
  openai: new OpenAICompatibleStrategy(),
  custom: new CustomStrategy(),
}

/** 根据提供商类型获取策略 */
export function getStrategy(providerType: string): LlmProviderStrategy {
  return strategies[providerType] ?? strategies.openai
}
```

### 9.3 ReAct Agent 模式

**已应用于**：`agents/core/reactAgent.ts`

```
用户输入 → ModeRouter → DiagnosisAgent / RecommendationAgent
                          ↓
                    ReAct 循环 (Thought → Action → Observation)
                          ↓
                    工具调用 (搜索、行情查询、财务分析)
                          ↓
                    最终回复生成
```

---

## 10. 性能优化

### 10.1 优化策略表

| 场景 | 优化方案 | 示例 |
|------|---------|------|
| 大列表渲染 | 虚拟滚动 | 股票列表 > 100 条时使用虚拟列表 |
| 频繁数据更新 | 防抖/节流 | 行情数据 500ms 节流更新 |
| 复杂计算 | `computed` 缓存 | 排行计算使用 computed 避免重复计算 |
| 组件懒加载 | `defineAsyncComponent` | 非首屏组件异步加载 |
| 路由懒加载 | 动态 import | `() => import('@/views/xxx')` |
| 定时器清理 | `onUnmounted` | 清理 setInterval / setTimeout |
| 事件监听 | `onUnmounted` | 清理 Tauri event listener (UnlistenFn) |
| 异步取消 | `AbortController` | 组件卸载时中断未完成的 fetch |

### 10.2 并发请求

```typescript
/**
 * 并发获取多个数据源
 * 使用 Promise.allSettled 确保单个失败不影响其他请求
 */
async function fetchDashboardData() {
  const results = await Promise.allSettled([
    fetchMarketOverview(),
    fetchFundFlow(),
    fetchAiDigest(),
    fetchNewsList(),
  ])

  const [market, fundFlow, aiDigest, news] = results.map((r) =>
    r.status === 'fulfilled' ? r.value : null
  )

  return { market, fundFlow, aiDigest, news }
}
```

### 10.3 可取消异步任务

```typescript
/**
 * 使用 AbortController 管理可取消的异步任务
 */
export function useCancellableFetch() {
  const controller = ref<AbortController | null>(null)

  async function fetch(url: string) {
    controller.value?.abort()
    controller.value = new AbortController()
    const response = await fetch(url, { signal: controller.value.signal })
    return response.json()
  }

  onUnmounted(() => controller.value?.abort())

  return { fetch }
}
```

---

## 11. 代码审查清单

- [ ] 文件行数不超过 500 行
- [ ] CSS 独立为 `.scss` 文件，未写在 `.vue` 中
- [ ] 多文件组件结构（index.vue + script.ts + template.html + style.scss）
- [ ] 样式使用 `scoped`，未使用全局选择器污染
- [ ] 颜色/间距使用 `_variables.scss` 变量，未硬编码
- [ ] 函数/组件/模块有标准注释（JSDoc 风格）
- [ ] 无 `console.log` 残留
- [ ] TypeScript 严格类型，无 `any`（除非有充分理由）
- [ ] 无硬编码的 API 地址或端口（使用常量）
- [ ] 组件销毁时清理定时器和事件监听
- [ ] 异步操作有错误处理（try/catch 或 .catch）
- [ ] 导入路径使用 `@/` 别名，未使用跨层相对路径

---

## 12. 技术债务

以下文件已超过 500 行限制，需要按本规范进行拆分：

| 文件 | 行数 | 建议拆分方案 |
|------|------|-------------|
| `agents/diagnosisAgent.ts` | 1932 | 拆分为多个子 agent 和工具模块 |
| `views/HomeView/script.ts` | 1482 | 提取子组件（HeroPanel, MarketOverview, FundFlowCard, PolicyThemePanel）+ composables |
| `views/AskView/style.scss` | 1414 | 拆分为 `_hero.scss`, `_chat.scss`, `_sidebar.scss` 等 partial |
| `views/StockDetailView/style.scss` | 1384 | 拆分为 `_header.scss`, `_kline.scss`, `_finance.scss` 等 partial |
| `views/AskView/script.ts` | 1304 | 提取子组件 + composables（useAskChat, useAskDiagnosis） |
| `views/HomeView/style.scss` | 1185 | 拆分为 `_hero.scss`, `_market.scss`, `_fundflow.scss`, `_policy.scss` |
| `utils/constants.ts` | 970 | 拆分为 constants/ 目录（app/ai/market/search/strategy/policy） |
| `views/StockDetailView/script.ts` | 938 | 提取子组件（StockHeader, KlineSection, FinanceTable）+ composables |
| `agents/investmentAgent.ts` | 928 | 拆分子 agent（investmentSearch, investmentAnalysis） |
| `views/AnalysisView/script.ts` | 645 | 提取图表组件（KlineChartPanel, IndicatorPanel） |
| `views/SettingsView/style.scss` | 556 | 拆分为 `_ai.scss`, `_search.scss`, `_proxy.scss` 等 |
| `views/AnalysisView/style.scss` | 545 | 拆分为 `_chart.scss`, `_toolbar.scss`, `_panel.scss` |
| `views/SettingsView/script.ts` | 537 | 提取设置子模块（AiSettings, SearchSettings, ProxySettings） |
| `composables/useNotifications.ts` | 512 | 提取通知子功能（alertManager, notificationRenderer） |
