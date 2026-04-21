# MI Quantify - AI 开发协作规范

> **语言要求**: 所有 AI 模型必须使用中文进行思考、交流、注释编写和提交信息生成。
> **项目概述**: MI Quantify (Midnight Injection Quantify) 是一款 AI 驱动的股票研究桌面工作站，基于 Tauri 2 构建，前端 Vue 3 + TypeScript，后端 Rust，数据层 Python FastAPI Sidecar。

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [docs/architecture.md](docs/architecture.md) | 项目架构概览、目录结构、通信架构、命令/API 一览 |
| [docs/frontend-guide.md](docs/frontend-guide.md) | 前端开发规范（Vue 3 + TypeScript） |
| [docs/rust-guide.md](docs/rust-guide.md) | Rust 后端开发规范（Tauri 2） |
| [docs/python-guide.md](docs/python-guide.md) | Python Sidecar 开发规范（FastAPI） |

---

## 通用规范

### 文件大小限制（强制）

| 层级 | 最大行数 | 超出时策略 |
|------|---------|-----------|
| `.ts` / `.vue` / `.scss` / `.html` | **500 行** | 按功能拆分为多个文件 |
| `.rs` 文件 | **500 行** | 按职责拆分为子模块 |
| `.py` 文件 | **400 行** | 拆分为 service/router/utility 模块 |

### 注释规范（强制）

所有代码文件必须包含标准注释：

```typescript
/**
 * 格式化金额为可读字符串
 * @param amount - 原始金额数值（单位：元）
 * @param decimals - 保留小数位数，默认 2
 * @returns 格式化后的字符串，如 "12.34亿"
 */
export function formatAmount(amount: number, decimals = 2): string {
```

```rust
/// 构建 HTTP 客户端，可选代理配置
///
/// # 参数
/// - `proxy_url`: 代理地址，None 表示直连
///
/// # 错误
/// 代理配置无效时返回错误描述
fn build_client_with_proxy(proxy_url: Option<&str>) -> Result<reqwest::Client, String> {
```

```python
def get_market_indices(market: str) -> list[dict]:
    """
    获取市场指数数据

    Args:
        market: 市场类型，"a" / "hk" / "us"

    Returns:
        指数数据列表
    """
```

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| Vue 组件目录 | PascalCase | `HomeView/`, `KlineChart/` |
| TypeScript 文件 | camelCase | `useAiChat.ts`, `format.ts` |
| TypeScript 类型/接口 | PascalCase | `AiProvider`, `StockItem` |
| TypeScript 常量 | UPPER_SNAKE_CASE | `APP_NAME`, `PYTHON_SIDECAR_PORT` |
| SCSS 类名 | BEM 风格 | `.home-page__hero-title--active` |
| Rust 模块/函数 | snake_case | `app_store.rs`, `build_proxy_url()` |
| Rust 结构体/枚举 | PascalCase | `StreamChunk`, `MonitorAlert` |
| Rust 常量 | UPPER_SNAKE_CASE | `DB_FILE_NAME` |
| Python 文件/函数 | snake_case | `market_service.py`, `get_quotes()` |

### Git 提交规范

```
<类型>(<范围>): <简要描述>

类型: feat | fix | refactor | style | docs | test | chore | perf
范围: frontend | rust | python | sidecar | config | ci
语言: 中文

示例:
feat(frontend): 新增 K 线图 MACD 指标叠加显示
fix(rust): 修复微信监听器断线后未正确重连
refactor(frontend): 拆分 HomeView 为多个子组件
```

---

## 编译与验证

### 修改代码后必须执行的验证命令

```bash
# 前端类型检查
pnpm typecheck

# 前端构建验证
pnpm build

# Rust 构建验证
cd src-tauri && cargo build

# Python 依赖检查
cd src-python && uv sync

# 完整桌面应用构建（发布前）
pnpm tauri build
```

### 禁止行为

1. **禁止自动启动项目** — 修改完成后由用户手动启动验证
2. **禁止直接使用全局 pip** — Python 环境使用 UV 管理
3. **禁止提交敏感信息** — API Key、密码等不得出现在代码中
4. **禁止在 CI 未通过时合并代码**
