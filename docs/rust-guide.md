# Rust 后端开发规范 (Tauri 2)

> 本文档定义 MI Quantify Rust 后端开发的所有强制规范和最佳实践。

---

## 1. 模块组织规范

### 1.1 目标结构

```
src-tauri/src/
├── main.rs              # 入口，仅调用 lib::run()
├── lib.rs               # Tauri Builder 配置（< 100 行）
├── storage.rs           # 存储基础设施（目录、文件路径、迁移）
├── commands/            # Tauri 命令模块（#[tauri::command] 薄层）
│   ├── mod.rs           # 模块声明
│   ├── app_store.rs     # KV 设置存储
│   ├── ai.rs            # AI 对话（同步/流式）
│   ├── chat.rs          # 聊天记录持久化
│   ├── monitor.rs       # 自选股和预警
│   ├── scheduler.rs     # 定时任务
│   ├── notifications.rs # 桌面通知
│   ├── sidecar.rs       # Sidecar 进程管理
│   └── wechat.rs        # 微信机器人（或 wechat/ 目录）
├── models/              # 数据模型层（结构体、枚举、序列化定义）
│   ├── mod.rs
│   ├── ai.rs            # AiMessage, StreamChunk, ProxyConfig
│   ├── chat.rs          # Conversation, ChatMessage
│   ├── monitor.rs       # WatchlistRecord, MonitorAlert, MonitorNotification
│   └── wechat.rs        # WechatLoginQrCode, WechatMessage 等
├── services/            # 业务逻辑层（纯函数、HTTP 调用、数据库操作）
│   ├── mod.rs
│   ├── ai_service.rs    # AI API 调用逻辑
│   ├── db_service.rs    # 数据库操作封装
│   └── wechat_service.rs # 微信 API 调用逻辑
└── constants/           # 常量管理
    ├── mod.rs
    ├── app.rs           # APP_DATA_DIR_NAME, DB_FILE_NAME
    └── wechat.rs        # DEFAULT_WECHAT_BASE_URL, MAX_CONSECUTIVE_FAILURES
```

### 1.2 分层原则

| 层级 | 职责 | 示例 |
|------|------|------|
| `commands/` | Tauri 命令入口，参数校验，调用 service | `#[tauri::command]` 函数 |
| `services/` | 核心业务逻辑，可独立测试 | HTTP 调用、数据处理 |
| `models/` | 数据结构定义 | `struct`, `enum`, `serde` |
| `constants/` | 常量集中管理 | 端口、URL、文件名 |

---

## 2. 文件大小限制与拆分策略

### 2.1 行数限制

| 规则 | 限制 |
|------|------|
| 所有 `.rs` 文件 | **500 行** |
| `lib.rs` | **100 行** |
| `main.rs` | **10 行** |

### 2.2 拆分优先级

当 `.rs` 文件超过 500 行时，按以下顺序拆分：

```
1. 提取数据模型 → models/
   - 结构体、枚举、序列化定义
   - 将 struct/enum 从 commands/*.rs 移到 models/*.rs

2. 提取业务逻辑 → services/
   - 纯函数、HTTP 调用、数据库操作
   - commands/*.rs 仅保留 #[tauri::command] 包装层

3. 提取常量 → constants/
   - 端口、URL、文件名等常量集中管理

4. 按功能拆分子模块
   - 大文件拆为同名目录 + mod.rs
```

### 2.3 拆分示例：wechat.rs

```
当前: commands/wechat.rs (887 行)

拆分为:
commands/wechat/
├── mod.rs              # 公开接口 + init_wechat_runtime_state()
├── login.rs            # QR 码登录、登录状态查询
├── listener.rs         # 消息监听、轮询循环
├── message.rs          # 消息发送、自动回复
└── context.rs          # 上下文管理、文件读写
```

---

## 3. Command 编写规范

### 3.1 标准模板

```rust
/// 获取自选股列表
///
/// # 参数
/// - `group`: 可选分组筛选
///
/// # 返回
/// 自选股记录列表
///
/// # 错误
/// 数据库操作失败时返回错误信息
#[tauri::command]
pub fn monitor_watchlist_list(group: Option<String>) -> Result<Vec<WatchlistRecord>, String> {
    with_connection(|conn| {
        let mut stmt = conn.prepare("SELECT ...")?;
        let records = stmt.query_map(params![group], |row| {
            Ok(WatchlistRecord { /* ... */ })
        })?;
        Ok(records.collect::<Result<Vec<_>, _>>()?)
    })
}
```

### 3.2 命令注册

所有新命令必须在 `lib.rs` 的 `invoke_handler` 中注册：

```rust
.invoke_handler(tauri::generate_handler![
    commands::app_store::app_store_get,
    // 新增命令在此添加
])
```

### 3.3 异步命令

需要异步操作（HTTP 请求、长时间任务）的命令使用 `async`：

```rust
/// 流式 AI 对话
///
/// # 参数
/// - `app`: Tauri AppHandle，用于发送事件
/// - `messages`: 消息历史
/// - `config`: AI 配置
#[tauri::command]
pub async fn ai_chat_stream(
    app: AppHandle,
    messages: Vec<AiMessage>,
    config: AiChatConfig,
) -> Result<(), String> {
    // 异步实现...
    Ok(())
}
```

---

## 4. 序列化规范

### 4.1 核心规则

- 所有与前端交互的结构体**必须**使用 `#[serde(rename_all = "camelCase")]`
- 避免字段名冲突时使用 `#[serde(rename = "type")]`
- 可选字段使用 `Option<T>`，前端对应为 `T | null`
- 默认值使用 `#[serde(default)]` 或 `#[serde(default = "fn_name")]`

### 4.2 枚举序列化

使用 `#[serde(tag = "kind")]` 实现联合类型序列化：

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum StreamChunk {
    Delta { request_id: String, content: String },
    Done { request_id: String, full_content: String },
    Error { request_id: String, message: String },
}
```

---

## 5. 错误处理规范

### 5.1 错误类型定义

使用 `thiserror` 定义模块级错误类型：

```rust
use thiserror::Error;

/// 监控模块错误类型
#[derive(Debug, Error)]
enum MonitorDbError {
    /// 用户主目录无法定位
    #[error("无法定位用户目录")]
    HomeDirMissing,
    /// IO 错误（目录创建、文件读写）
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    /// SQLite 数据库操作错误
    #[error("数据库操作失败: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// JSON 序列化/反序列化错误
    #[error("JSON 序列化失败: {0}")]
    Json(#[from] serde_json::Error),
}
```

### 5.2 统一错误转换

```rust
/// 统一转换为 String 返回给前端
fn with_connection<T, F>(action: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, MonitorDbError>,
{
    let path = monitor_db_path_inner().map_err(|e| e.to_string())?;
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    action(&conn).map_err(|e| e.to_string())
}
```

### 5.3 错误处理原则

- **禁止**在生产代码中使用 `unwrap()`，使用 `?` 或 `map_err`
- Command 函数返回 `Result<T, String>`，将内部错误转为用户可读消息
- 内部函数使用自定义 `enum` 错误类型（thiserror）
- 异步命令中的错误使用 `map_err(|e| e.to_string())` 转换

---

## 6. 状态管理规范

### 6.1 状态定义

```rust
use std::sync::Arc;
use tokio::sync::Mutex;

/// Sidecar 进程管理状态
pub struct SidecarState {
    /// 子进程句柄，None 表示未启动
    pub process: Arc<Mutex<Option<std::process::Child>>>,
    /// 当前运行状态
    pub running: Arc<std::sync::Mutex<bool>>,
}
```

### 6.2 状态初始化

每个状态模块提供 `init_*_state()` 函数，在 `lib.rs` 中注册：

```rust
// commands/sidecar.rs
pub fn init_state() -> SidecarState {
    SidecarState {
        process: Arc::new(Mutex::new(None)),
        running: Arc::new(std::sync::Mutex::new(false)),
    }
}

// lib.rs
.manage(commands::sidecar::init_state())
```

### 6.3 状态使用

```rust
#[tauri::command]
pub async fn sidecar_start(
    state: State<'_, SidecarState>,
) -> Result<(), String> {
    let mut process = state.process.lock().await;
    // 操作状态...
    Ok(())
}
```

---

## 7. 多线程与并发

### 7.1 锁类型选择指南

| 场景 | 使用 | 原因 |
|------|------|------|
| 需要跨 `.await` 持有锁 | `tokio::sync::Mutex` | 避免阻塞 Tokio 运行时 |
| 简单数据读写（无 async） | `std::sync::Mutex` | 性能更好，无 async 开销 |
| 只读共享数据 | `Arc<T>` (T: Clone) | 无需锁，直接克隆 |
| 需要读写分离 | `tokio::sync::RwLock` | 允许多读者并发 |

### 7.2 异步运行时

本项目使用 Tokio 作为异步运行时，Tauri 2 默认集成。

```rust
use tokio::time::sleep;
use std::time::Duration;

/// 异步 HTTP 请求示例
#[tauri::command]
pub async fn ai_chat_stream(app: AppHandle, /* ... */) -> Result<(), String> {
    let response = client
        .post(&config.api_url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let data = chunk.map_err(|e| e.to_string())?;
        app.emit("ai-stream-chunk", &chunk_data).map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

### 7.3 并发任务管理

```rust
use tokio::task::JoinSet;

/// 并发获取多只股票数据
async fn fetch_stocks_concurrently(codes: Vec<String>) -> Vec<StockData> {
    let mut set = JoinSet::new();

    for code in codes {
        set.spawn(async move {
            fetch_single_stock(code).await
        });
    }

    let mut results = Vec::new();
    while let Some(result) = set.join_next().await {
        if let Ok(data) = result {
            results.push(data);
        }
    }
    results
}
```

### 7.4 长时间运行后台任务

```rust
/// 使用 tokio::spawn 启动后台任务
/// 注意：必须持有 AppHandle 的 Arc 引用以发送事件
pub fn start_background_listener(app: AppHandle, state: Arc<SidecarState>) {
    tokio::spawn(async move {
        loop {
            if !*state.running.lock().unwrap() {
                break;
            }

            if let Some(data) = poll_sidecar().await {
                let _ = app.emit("sidecar-data", &data);
            }

            sleep(Duration::from_secs(5)).await;
        }
    });
}
```

### 7.5 共享所有权

```rust
use std::sync::Arc;

// ✅ 正确：使用 Arc 共享所有权
let state = Arc::new(Mutex::new(data));
let state_clone = state.clone();
tokio::spawn(async move {
    let mut data = state_clone.lock().await;
});

// ❌ 错误：避免不必要的克隆
// 大型数据结构优先使用引用或 Arc
fn process_data(data: &LargeStruct) { /* ... */ }
```

---

## 8. 常量管理规范

### 8.1 常量文件组织

```rust
// constants/app.rs
/// 应用数据目录名（位于用户主目录下）
pub const APP_DATA_DIR_NAME: &str = ".mi_quantify";

/// 旧版数据目录名（用于迁移检测）
pub const LEGACY_APP_DATA_DIR_NAME: &str = "mi_quantify";

/// SQLite 数据库文件名
pub const DB_FILE_NAME: &str = "mi_quantify.db";

/// 设置文件名
pub const SETTINGS_FILE_NAME: &str = "settings.json";
```

```rust
// constants/wechat.rs
/// 微信机器人默认 API 地址
pub const DEFAULT_WECHAT_BASE_URL: &str = "https://ilinkai.weixin.qq.com";

/// 登录信息文件名
pub const LOGIN_FILE_NAME: &str = "wechat_accounts.json";

/// 上下文文件名
pub const CONTEXT_FILE_NAME: &str = "wechat_contexts.json";

/// 最大连续失败次数
pub const MAX_CONSECUTIVE_FAILURES: u32 = 3;
```

```rust
// constants/mod.rs
pub mod app;
pub mod wechat;
```

### 8.2 使用方式

```rust
use crate::constants::app::DB_FILE_NAME;
use crate::constants::wechat::DEFAULT_WECHAT_BASE_URL;
```

### 8.3 常量规则

- **禁止**在 commands/ 或 services/ 中硬编码常量
- 常量名使用 UPPER_SNAKE_CASE
- 每个常量必须添加文档注释
- 按模块拆分常量文件，每个文件不超过 200 行

---

## 9. 数据库操作规范

### 9.1 连接管理

使用 `with_connection` 模式统一处理路径解析、目录创建、Schema 初始化。

### 9.2 SQL 安全

- **必须**使用参数化查询（`params![]`），禁止字符串拼接 SQL
- Schema 初始化集中在 `init_schema()` 函数中

---

## 10. 注释规范

- 模块头使用 `//!` 文档注释：`//! wechat.rs — 微信机器人集成模块`
- 函数使用 `///` 文档注释，包含 `# 参数`、`# 返回`、`# 错误` 段落
- 结构体每个字段添加 `///` 行注释

---

## 11. 性能优化

| 场景 | 优化方案 |
|------|---------|
| SQLite 连接 | 使用 `with_connection` 复用连接模式 |
| HTTP 客户端 | 复用 `reqwest::Client` 实例（内部连接池） |
| 流式响应 | 使用 SSE 逐块发送（`app.emit`） |
| 后台任务 | 使用 `tokio::spawn` 避免阻塞主线程 |

---

## 12. 代码审查清单

- [ ] 文件 ≤ 500 行，按功能模块组织（commands/models/services/constants）
- [ ] Command 函数有 `///` 文档注释
- [ ] 错误类型使用 `thiserror`，生产代码无 `unwrap()`
- [ ] 与前端交互的结构体有 `#[serde(rename_all = "camelCase")]`
- [ ] 共享状态使用 `Arc<Mutex<T>>`，常量集中在 `constants/`
- [ ] 异步操作不阻塞主线程，数据库使用参数化查询

---

## 13. 技术债务

以下文件已超过或接近 500 行限制，需要按本规范进行拆分：

| 文件 | 行数 | 建议拆分方案 |
|------|------|-------------|
| `commands/wechat.rs` | 887 | 拆为 `commands/wechat/` 目录（login/listener/message/context） |
| `commands/monitor.rs` | 428 | 接近上限，提取 models/monitor.rs 和 services/db_service.rs |

**wechat.rs 拆分方案**：拆为 `commands/wechat/` 目录（mod.rs + login.rs + listener.rs + message.rs + context.rs），同时提取 `models/wechat.rs`（结构体）和 `constants/wechat.rs`（常量）。
