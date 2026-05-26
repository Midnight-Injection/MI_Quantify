"""
数据源注册中心 — 管理前端同步的数据源配置，供各 service 按优先级读取。

核心职责：
1. 接收前端 sync 过来的 enabled 数据源列表
2. 根据工具名返回该工具可用的数据源（按 priority 排序）
3. 根据数据源 ID 返回完整配置（apiKey / proxyId 等）
"""

from __future__ import annotations

import threading
from typing import Optional

_LOCK = threading.Lock()
_SOURCES: list[dict] = []

TOOL_SOURCE_MAP: dict[str, list[str]] = {
    "load_quote": [
        "sina", "eastmoney", "easyquotation", "akshare",
        "yfinance", "alphavantage", "twelvedata", "polygon",
        "eodhd", "fmp", "tiingo", "alpaca",
    ],
    "load_kline": [
        "sina", "akshare", "baostock",
        "yfinance", "stooq", "alphavantage", "twelvedata", "polygon",
        "eodhd", "tushare", "jqdata", "rqdata", "tiingo", "alpaca",
    ],
    "load_fund_flow": ["eastmoney", "akshare"],
    "load_stock_news": [
        "eastmoney", "google-news-rss", "yahoo-finance-rss",
        "rsshub", "gnews", "newsapi", "finnhub",
    ],
    "load_macro_news": [
        "eastmoney", "google-news-rss", "yahoo-finance-rss",
        "rsshub", "gnews", "newsapi", "mediastack",
    ],
    "load_financial_news": [
        "eastmoney", "google-news-rss", "yahoo-finance-rss",
        "rsshub", "gnews", "newsapi", "mediastack", "finnhub",
    ],
    "load_sector_rank": ["eastmoney"],
    "load_concept_rank": ["eastmoney"],
    "load_market_indices": ["sina", "eastmoney", "yfinance", "stooq"],
    "load_advance_decline": ["eastmoney"],
    "load_finance_report": [
        "akshare",
        "fmp", "alphavantage", "finnhub", "eodhd", "tushare", "jqdata", "rqdata",
    ],
    "search_stock": ["eastmoney"],
}


def register_sources(sources: list[dict]) -> None:
    """
    接收前端同步的数据源配置列表并覆盖本地缓存。

    Args:
        sources: 前端 DataSource 序列化后的字典列表，
                 每项含 id / name / enabled / priority / apiKey / proxyId 等
    """
    with _LOCK:
        _SOURCES.clear()
        for s in (sources or []):
            _SOURCES.append(dict(s))


def get_sources_for_tool(
    tool_name: str,
    preferred_source: Optional[str] = None,
) -> list[dict]:
    """
    返回指定工具可用的数据源列表，按 priority 升序排列。

    Args:
        tool_name: 工具名，如 "load_quote"
        preferred_source: AI 指定的优先数据源 ID，若存在则提升到首位

    Returns:
        启用且匹配的数据源列表，每个元素为完整配置字典
    """
    allowed_ids = TOOL_SOURCE_MAP.get(tool_name, [])
    with _LOCK:
        enabled = [s for s in _SOURCES if s.get("enabled") and s.get("id") in allowed_ids]

    enabled.sort(key=lambda s: s.get("priority", 99))

    if preferred_source:
        for i, s in enumerate(enabled):
            if s.get("id") == preferred_source:
                if i > 0:
                    enabled.insert(0, enabled.pop(i))
                break

    return enabled


def get_source_by_id(source_id: str) -> Optional[dict]:
    """
    根据 ID 查找数据源完整配置。

    Args:
        source_id: 数据源 ID，如 "sina"

    Returns:
        数据源字典或 None
    """
    with _LOCK:
        for s in _SOURCES:
            if s.get("id") == source_id:
                return dict(s)
    return None


def get_all_enabled_sources() -> list[dict]:
    """返回所有已启用的数据源（按 priority 排序）。"""
    with _LOCK:
        enabled = [dict(s) for s in _SOURCES if s.get("enabled")]
    enabled.sort(key=lambda s: s.get("priority", 99))
    return enabled
