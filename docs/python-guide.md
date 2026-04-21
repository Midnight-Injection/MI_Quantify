# Python Sidecar 开发规范

> 本文档定义 MI Quantify Python Sidecar（FastAPI）开发的所有强制规范和最佳实践。

---

## 1. 目录结构

```
src-python/
├── pyproject.toml            # 项目配置 + 依赖管理（UV）
├── run.py                    # 启动入口（uvicorn on 127.0.0.1:18911）
├── mi-quantify-sidecar.spec  # PyInstaller 打包配置
├── app/
│   ├── __init__.py
│   ├── main.py               # FastAPI 应用配置
│   ├── routers/              # API 路由层（薄层）
│   │   ├── __init__.py
│   │   ├── market.py         # /api/market
│   │   ├── kline.py          # /api/kline
│   │   ├── sector.py         # /api/sector
│   │   ├── fundflow.py       # /api/fundflow
│   │   ├── news.py           # /api/news
│   │   ├── finance.py        # /api/finance
│   │   ├── openclaw.py       # /api/openclaw
│   │   └── investment.py     # /api/investment
│   └── services/             # 业务逻辑层（核心实现）
│       ├── __init__.py
│       ├── market_service.py # 行情数据聚合
│       ├── stock_service.py  # 股票数据
│       ├── kline_service.py  # K 线数据
│       ├── sector_service.py # 板块数据
│       ├── fundflow_service.py # 资金流向
│       ├── news_service.py   # 新闻聚合
│       ├── finance_service.py # 财务数据
│       ├── search_service.py # 搜索集成
│       ├── investment_service.py # 投资数据
│       ├── openclaw_service.py # OpenClaw 频道
│       └── network_env.py    # 代理/网络环境管理
```

---

## 2. 文件大小限制

| 文件类型 | 最大行数 |
|---------|---------|
| `.py` 文件 | **400 行** |
| Router 文件 | **100 行** |
| `main.py` | **50 行** |

---

## 3. 分层原则

### 3.1 Router 层（薄层）

Router **只做**参数接收和响应返回，不包含任何业务逻辑：

```python
from fastapi import APIRouter, Query
from app.services.market_service import get_market_indices

router = APIRouter()


@router.get("/indices")
async def indices(market: str = Query(default="a")):
    """获取市场指数数据"""
    data = get_market_indices(market)
    return {"data": data}
```

### 3.2 Service 层（核心逻辑）

所有业务逻辑、外部 API 调用、数据处理都在 Service 中实现：

```python
import re
from app.services.network_env import create_http_session


def get_market_indices(market: str) -> list[dict]:
    """
    获取市场指数数据

    Args:
        market: 市场类型，"a" / "hk" / "us"

    Returns:
        指数数据列表，每项包含 code, name, price, change 等字段
    """
    url = _build_index_url(market)
    response = _http_get(url)
    return _parse_index_response(response, market)


def _build_index_url(market: str) -> str:
    """构建指数数据请求 URL"""
    # 实现...


def _parse_index_response(response: str, market: str) -> list[dict]:
    """解析指数数据响应"""
    # 实现...
```

---

## 4. HTTP 请求规范

### 4.1 使用统一 HTTP 客户端

```python
from app.services.network_env import create_http_session


def _http_get(url: str, **kwargs):
    """统一 HTTP GET 请求"""
    return create_http_session(target_url=url).get(url, **kwargs)
```

### 4.2 超时与重试

```python
def _http_get_with_retry(url: str, max_retries: int = 3, timeout: int = 10) -> dict:
    """
    带重试机制的 HTTP GET 请求

    Args:
        url: 请求地址
        max_retries: 最大重试次数
        timeout: 单次请求超时秒数

    Returns:
        解析后的 JSON 数据
    """
    for attempt in range(max_retries):
        try:
            resp = _http_get(url, timeout=timeout)
            return resp.json()
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            print(f"[retry {attempt + 1}/{max_retries}] {url}: {e}")
            time.sleep(1)
```

### 4.3 网络环境管理

```python
from app.services.network_env import clear_proxy_env, register_proxies

# 应用启动时清理代理环境
clear_proxy_env()
```

---

## 5. 类型注解规范

所有函数**必须**包含参数和返回值的类型注解：

```python
from typing import Optional


def get_stock_list(
    market: str,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, any]:
    """
    获取股票列表

    Args:
        market: 市场类型（"a" / "hk" / "us"）
        page: 页码，从 1 开始
        page_size: 每页数量

    Returns:
        分页数据，包含 items、total、page、pageSize
    """
    pass


def search_stocks(
    keyword: str,
    limit: int = 8,
    with_quotes: bool = True,
) -> list[dict]:
    """
    搜索股票

    Args:
        keyword: 搜索关键词（代码或名称）
        limit: 返回数量上限
        with_quotes: 是否附带实时行情

    Returns:
        匹配的股票列表
    """
    pass
```

---

## 6. 缓存与并发

### 6.1 线程安全缓存

```python
import threading
import time

_cache: dict[str, dict] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = 300  # 5 分钟


def get_cached(key: str) -> Optional[dict]:
    """获取缓存数据"""
    with _cache_lock:
        entry = _cache.get(key)
        if not entry:
            return None
        if time.time() - entry["ts"] > _CACHE_TTL:
            del _cache[key]
            return None
        return entry["data"]


def set_cached(key: str, data: dict) -> None:
    """设置缓存数据"""
    with _cache_lock:
        _cache[key] = {"data": data, "ts": time.time()}
```

### 6.2 后台刷新线程

```python
_ad_cache = {"data": {}, "updated": 0}
_ad_lock = threading.Lock()
_ad_refresh_interval = 30  # 秒


def _bg_refresh_advance_decline():
    """后台刷新涨跌统计"""
    while True:
        try:
            data = _compute_advance_decline()
            with _ad_lock:
                _ad_cache["data"] = data
                _ad_cache["updated"] = time.time()
        except Exception as e:
            print(f"[market] bg advance/decline error: {e}")
        time.sleep(_ad_refresh_interval)


_threading_started = False


def ensure_ad_thread():
    """确保后台刷新线程已启动"""
    global _threading_started
    if not _threading_started:
        _threading_started = True
        t = threading.Thread(target=_bg_refresh_advance_decline, daemon=True)
        t.start()
```

### 6.3 线程池并发请求

```python
from concurrent.futures import ThreadPoolExecutor, as_completed


def fetch_multiple_stocks(codes: list[str]) -> list[dict]:
    """
    并发获取多只股票数据

    Args:
        codes: 股票代码列表

    Returns:
        股票数据列表
    """
    results = []
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {
            executor.submit(_fetch_single_stock, code): code
            for code in codes
        }
        for future in as_completed(futures):
            try:
                results.append(future.result())
            except Exception as e:
                code = futures[future]
                print(f"[error] fetch {code}: {e}")
    return results
```

---

## 7. 环境管理

### 7.1 UV 管理

```bash
# 安装依赖
cd src-python && uv sync

# 添加新依赖
uv add <package>

# 启动开发服务器
uv run python run.py
```

### 7.2 禁止事项

- **禁止**使用全局 `pip install`
- **禁止**在代码中硬编码端口或 URL
- **禁止**提交 `.venv/` 目录

---

## 8. 代码审查清单

- [ ] 文件行数不超过 400 行
- [ ] Router 层无业务逻辑
- [ ] 所有函数有类型注解和文档字符串
- [ ] HTTP 请求有超时设置
- [ ] 共享数据使用 `threading.Lock` 保护
- [ ] 后台线程设置 `daemon=True`
- [ ] 无 `print` 语句残留（使用日志模块替代）
- [ ] 异常处理不吞没错误（至少打印错误信息）
- [ ] 依赖通过 `uv add` 管理

---

## 9. 技术债务

以下文件已超过 400 行限制，需要拆分：

| 文件 | 行数 | 建议拆分方案 |
|------|------|-------------|
| `services/market_service.py` | 838 | 拆为 `market_quote_service.py`（行情报价）、`market_index_service.py`（指数数据）、`market_stock_service.py`（股票列表和搜索） |
| `services/news_service.py` | 612 | 拆为 `news_eastmoney_service.py`（东方财富新闻）、`news_sina_service.py`（新浪新闻）、`news_aggregator.py`（聚合逻辑） |
| `services/search_service.py` | 451 | 拆为 `search_local_service.py`（本地搜索）、`search_api_service.py`（API 搜索） |
