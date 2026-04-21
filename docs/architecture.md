# 项目架构概览

> MI Quantify (Midnight Injection Quantify) — AI 驱动的股票研究桌面工作站
> 技术栈：Tauri 2 + Vue 3 + TypeScript + Rust + Python FastAPI

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│ Tauri 2 Desktop Shell (Rust)                                │
│  - 窗口管理、自动更新、桌面通知                              │
│  - SQLite 持久化（自选股、预警、聊天记录、监控）             │
│  - AI 代理：reqwest 流式转发到 OpenAI 兼容 API              │
│  - 微信机器人集成（QR 登录、消息循环）                       │
│  - Sidecar 生命周期管理（启动/停止 Python 进程）             │
│  - KV 设置存储 (~/.mi_quantify/)                             │
├─────────────────────────────────────────────────────────────┤
│ Vue 3 + TypeScript + Pinia 前端                              │
│  - 8 个页面视图（哈希路由）                                  │
│  - ReAct AI Agent 循环（工具调用模式）                       │
│  - 策略模式（LLM 提供商 / 数据源切换）                      │
│  - Composables（sidecar HTTP、AI 聊天、轮询等）             │
│  - lightweight-charts K 线可视化                             │
├─────────────────────────────────────────────────────────────┤
│ Python FastAPI Sidecar (127.0.0.1:18911)                    │
│  - 8 个 API 路由（行情、K线、板块、资金流等）                │
│  - AkShare + BaoStock + 新浪 + 东方财富 数据聚合             │
│  - PyInstaller 打包为独立二进制，由 Tauri 启动               │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 通信架构

```
Vue 前端 ──invoke()──> Rust (Tauri IPC) ──SQLite/文件──> 本地持久化
    │                                              ──reqwest──> 外部 API (LLM)
    └──fetch(HTTP)──> Python Sidecar (127.0.0.1:18911) ──> 金融数据源
```

| 通信方式 | 场景 | 示例 |
|---------|------|------|
| `invoke()` IPC | 调用 Rust 命令 | AI 对话、数据持久化、进程管理 |
| `app.emit()` 事件 | Rust → 前端推送 | 流式 AI 响应、通知、Sidecar 状态 |
| HTTP fetch | 前端 → Python | 行情数据、K 线、资金流、新闻 |
| SQLite | Rust 本地存储 | 自选股、预警规则、聊天记录 |
| JSON 文件 | Rust 本地存储 | 应用设置、微信账户上下文 |

---

## 3. 目录结构

```
MI_Quantify/
├── src/                          # Vue 3 前端
│   ├── main.ts                   # 应用入口
│   ├── App.vue                   # 根组件
│   ├── router/
│   │   └── index.ts              # 路由配置（8 个页面，hash 模式）
│   ├── stores/                   # Pinia 状态管理
│   │   ├── app.ts                # 应用外壳状态
│   │   ├── settings.ts           # 全局设置
│   │   ├── market.ts             # 行情数据
│   │   ├── news.ts               # 新闻数据
│   │   ├── strategy.ts           # 策略状态
│   │   └── appUpdate.ts          # 自动更新
│   ├── types/                    # TypeScript 类型定义
│   │   ├── index.ts              # 统一导出
│   │   ├── ai.ts                 # AiProvider, AiMessage 等
│   │   ├── stock.ts              # Stock, KlineData, SectorData 等
│   │   ├── settings.ts           # AppSettings, DEFAULT_SETTINGS
│   │   ├── strategy.ts           # Strategy, Signal, PromptTemplate
│   │   └── ...                   # 其他类型文件
│   ├── views/                    # 页面视图（多文件组件）
│   │   ├── HomeView/             # 首页总览
│   │   ├── MarketView/           # 股票列表
│   │   ├── StockDetailView/      # 个股详情
│   │   ├── MonitorView/          # 关注监听
│   │   ├── AnalysisView/         # 技术分析
│   │   ├── AskView/              # AI 问股
│   │   ├── StrategyView/         # 策略中心
│   │   └── SettingsView/         # 设置页面
│   ├── components/               # 可复用组件
│   │   ├── layout/               # 布局组件（AppLayout, AppHeader, AppSidebar）
│   │   ├── common/               # 通用组件（InfoTooltip, StockSearchInput）
│   │   ├── market/               # 行情组件（WatchListTable, SectorRank）
│   │   ├── analysis/             # 分析组件（KlineChart, IndicatorPanel）
│   │   ├── strategy/             # 策略组件（StrategyList, SignalList, AiEvaluator）
│   │   └── settings/             # 设置组件（AiProviderCard）
│   ├── composables/              # Vue 组合式函数
│   │   ├── useSidecar.ts         # Python Sidecar HTTP 客户端
│   │   ├── useAiChat.ts          # AI 聊天封装
│   │   ├── useAiInsights.ts      # AI 洞察生成
│   │   ├── useAiTaskLogger.ts    # AI 任务日志
│   │   ├── useNotifications.ts   # 通知管理
│   │   ├── useRealtimeTask.ts    # 实时任务管理
│   │   └── usePolling.ts         # 通用轮询
│   ├── agents/                   # AI Agent 系统
│   │   ├── core/
│   │   │   └── reactAgent.ts     # ReAct 循环实现
│   │   ├── diagnosisAgent.ts     # 诊断 Agent
│   │   ├── recommendationAgent.ts# 推荐 Agent
│   │   ├── investmentAgent.ts    # 投资产品 Agent
│   │   └── modeRouterAgent.ts    # 模式路由
│   ├── strategies/               # 策略模式实现
│   │   ├── LlmProviderStrategies.ts
│   │   └── DataSourceStrategies.ts
│   ├── utils/                    # 工具函数
│   │   ├── constants.ts          # 常量（待拆分为目录）
│   │   ├── format.ts             # 格式化
│   │   ├── color.ts              # 颜色工具
│   │   ├── security.ts           # 安全工具
│   │   ├── marketSession.ts      # 交易时段
│   │   ├── marketMetrics.ts      # 市场指标计算
│   │   ├── investment.ts         # 投资计算
│   │   ├── aiQuestion.ts         # AI 提问构建
│   │   ├── chatPersistence.ts    # 聊天持久化
│   │   └── monitorPersistence.ts # 监控持久化
│   └── assets/styles/            # 全局样式
│       ├── main.scss             # 入口
│       ├── _reset.scss           # CSS 重置
│       ├── _global.scss          # 全局样式
│       ├── _variables.scss       # 设计变量
│       └── _mixins.scss          # 混入
├── src-tauri/                    # Rust 后端
│   ├── Cargo.toml                # 依赖管理
│   ├── tauri.conf.json           # Tauri 配置
│   └── src/
│       ├── main.rs               # 入口（调用 lib::run()）
│       ├── lib.rs                # Builder 配置（< 100 行）
│       ├── storage.rs            # 存储基础设施
│       └── commands/             # Tauri 命令
│           ├── mod.rs            # 模块声明
│           ├── app_store.rs      # KV 设置
│           ├── ai.rs             # AI 对话
│           ├── chat.rs           # 聊天持久化
│           ├── monitor.rs        # 自选股 & 预警
│           ├── scheduler.rs      # 定时任务
│           ├── notifications.rs  # 桌面通知
│           ├── sidecar.rs        # Sidecar 管理
│           └── wechat.rs         # 微信机器人
├── src-python/                   # Python Sidecar
│   ├── pyproject.toml            # Python 项目配置
│   ├── run.py                    # 启动入口
│   └── app/
│       ├── main.py               # FastAPI 应用
│       ├── routers/              # API 路由（8 个模块）
│       └── services/             # 业务逻辑（11 个模块）
└── docs/                         # 开发文档
    ├── architecture.md           # 本文件
    ├── frontend-guide.md         # 前端开发规范
    ├── rust-guide.md             # Rust 开发规范
    └── python-guide.md           # Python 开发规范
```

---

## 4. 路由表

| 路径 | 视图 | 功能 |
|------|------|------|
| `/` | HomeView | 首页总览（行情仪表盘、AI 洞察、资金流向、政策主题） |
| `/market` | MarketView | 股票列表（A 股 / 港股 / 美股） |
| `/monitor` | MonitorView | 自选股管理 & 价格预警 |
| `/stock/:code` | StockDetailView | 个股详情页 |
| `/analysis` | AnalysisView | 技术分析 |
| `/ask` | AskView | AI 问股（诊断 + 推荐模式） |
| `/strategy` | StrategyView | 策略中心 |
| `/settings` | SettingsView | 应用设置 |

---

## 5. Tauri 命令一览

### 应用设置 (app_store)

| 命令 | 功能 |
|------|------|
| `app_store_get` | 读取 KV 设置 |
| `app_store_set` | 写入 KV 设置 |

### AI 对话 (ai)

| 命令 | 功能 |
|------|------|
| `ai_chat` | 同步 AI 对话 |
| `ai_chat_stream` | 流式 AI 对话（SSE） |
| `test_ai_connection` | 测试 AI 连接 |

### 聊天记录 (chat)

| 命令 | 功能 |
|------|------|
| `chat_conversation_list` | 会话列表 |
| `chat_conversation_create` | 创建会话 |
| `chat_conversation_update_title` | 更新会话标题 |
| `chat_conversation_delete` | 删除会话 |
| `chat_message_list` | 消息列表 |
| `chat_message_add` | 添加消息 |
| `chat_message_clear` | 清空消息 |

### 监控 (monitor)

| 命令 | 功能 |
|------|------|
| `monitor_db_path` | 获取数据库路径 |
| `monitor_watchlist_list` | 自选股列表 |
| `monitor_watchlist_upsert` | 新增/更新自选股 |
| `monitor_watchlist_remove` | 删除自选股 |
| `monitor_alert_list` | 预警列表 |
| `monitor_alert_upsert` | 新增/更新预警 |
| `monitor_alert_remove` | 删除预警 |
| `monitor_alert_toggle` | 启用/禁用预警 |
| `monitor_alert_touch` | 触发预警 |
| `monitor_notification_list` | 通知列表 |
| `monitor_notification_add` | 添加通知 |
| `monitor_notification_clear` | 清空通知 |
| `monitor_notification_mark_read` | 标记已读 |

### 定时任务 (scheduler)

| 命令 | 功能 |
|------|------|
| `scheduler_list` | 任务列表 |
| `scheduler_toggle` | 启停任务 |
| `scheduler_run_now` | 立即执行 |

### 通知 (notifications)

| 命令 | 功能 |
|------|------|
| `alert_list` | 告警列表 |
| `alert_add` | 添加告警 |
| `alert_remove` | 删除告警 |
| `alert_toggle` | 启停告警 |
| `send_notification` | 发送桌面通知 |

### Sidecar (sidecar)

| 命令 | 功能 |
|------|------|
| `sidecar_start` | 启动 Python 进程 |
| `sidecar_stop` | 停止 Python 进程 |
| `sidecar_status` | 查询运行状态 |
| `set_proxy_env` | 设置代理环境变量 |

### 微信 (wechat)

| 命令 | 功能 |
|------|------|
| `wechat_start_login` | 发起 QR 码登录 |
| `wechat_get_login_status` | 查询登录状态 |
| `wechat_get_channel_status` | 查询频道状态 |
| `wechat_start_listener` | 启动消息监听 |
| `wechat_stop_listener` | 停止消息监听 |
| `wechat_logout_channel` | 登出频道 |
| `wechat_send_message` | 发送消息 |

---

## 6. Python Sidecar API 一览

| 路径前缀 | 功能 |
|---------|------|
| `/api/market` | 行情数据（指数、报价、热门） |
| `/api/kline` | K 线数据 |
| `/api/sector` | 板块数据 |
| `/api/fundflow` | 资金流向 |
| `/api/news` | 新闻聚合 |
| `/api/finance` | 财务数据 |
| `/api/openclaw` | OpenClaw 频道 |
| `/api/investment` | 投资产品 |
| `/health` | 健康检查 |
| `/api/proxy/register` | 代理配置 |

---

## 7. 数据存储

| 存储方式 | 路径 | 用途 |
|---------|------|------|
| SQLite | `~/.mi_quantify/mi_quantify.db` | 自选股、预警、聊天记录、通知 |
| JSON 文件 | `~/.mi_quantify/settings.json` | 应用设置 KV |
| JSON 文件 | `~/.mi_quantify/wechat_accounts.json` | 微信登录信息 |
| JSON 文件 | `~/.mi_quantify/wechat_contexts.json` | 微信上下文 |
| 内存 | Rust State | Sidecar 进程、调度器、告警、微信运行时 |
