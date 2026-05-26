"""
远程 API 通用辅助模块

提供所有远程数据源适配器共享的工具函数：
- API 请求（带重试、超时、代理）
- 响应解析（JSON / CSV）
- 代码格式转换
"""

import logging
import time
from typing import Any

import requests

from .network_env import create_http_session

logger = logging.getLogger(__name__)

_DEFAULT_TIMEOUT = 15
_MAX_RETRIES = 2
_RETRY_DELAY = 1.0


def remote_get(
    url: str,
    *,
    api_key: str | None = None,
    header_api_key_name: str | None = None,
    proxy_id: str | None = None,
    params: dict | None = None,
    timeout: int = _DEFAULT_TIMEOUT,
    referer: str = "",
) -> requests.Response:
    """
    发起远程 GET 请求

    Args:
        url: 请求 URL
        api_key: API 密钥（附加到 query param `apikey` 或 header）
        header_api_key_name: 若提供，api_key 放到该 header 名；否则放 query param
        proxy_id: 代理 ID
        params: 额外 query 参数
        timeout: 超时秒数
        referer: Referer 头

    Returns:
        requests.Response

    Raises:
        requests.RequestException: 请求失败
    """
    params = dict(params or {})
    if api_key and not header_api_key_name:
        params["apikey"] = api_key

    session = create_http_session(referer=referer or url, proxy_id=proxy_id, target_url=url)
    if api_key and header_api_key_name:
        session.headers[header_api_key_name] = api_key

    last_exc: Exception | None = None
    for attempt in range(1, _MAX_RETRIES + 2):
        try:
            resp = session.get(url, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp
        except requests.RequestException as exc:
            last_exc = exc
            logger.warning("remote_get %s attempt %d failed: %s", url, attempt, exc)
            if attempt <= _MAX_RETRIES:
                time.sleep(_RETRY_DELAY)
    raise last_exc  # type: ignore[misc]


def remote_post(
    url: str,
    *,
    api_key: str | None = None,
    header_api_key_name: str | None = None,
    proxy_id: str | None = None,
    json_body: dict | None = None,
    timeout: int = _DEFAULT_TIMEOUT,
    referer: str = "",
) -> requests.Response:
    """
    发起远程 POST 请求（JSON body）

    Args:
        url: 请求 URL
        api_key: API 密钥
        header_api_key_name: 若提供，api_key 放到该 header 名
        proxy_id: 代理 ID
        json_body: JSON 请求体
        timeout: 超时秒数
        referer: Referer 头

    Returns:
        requests.Response
    """
    session = create_http_session(referer=referer or url, proxy_id=proxy_id, target_url=url)
    if api_key and header_api_key_name:
        session.headers[header_api_key_name] = api_key

    last_exc: Exception | None = None
    for attempt in range(1, _MAX_RETRIES + 2):
        try:
            resp = session.post(url, json=json_body, timeout=timeout)
            resp.raise_for_status()
            return resp
        except requests.RequestException as exc:
            last_exc = exc
            logger.warning("remote_post %s attempt %d failed: %s", url, attempt, exc)
            if attempt <= _MAX_RETRIES:
                time.sleep(_RETRY_DELAY)
    raise last_exc  # type: ignore[misc]


def safe_float(value: Any, default: float = 0.0) -> float:
    """安全转换为 float，失败返回 default"""
    try:
        if value is None or value == "" or value == "-":
            return default
        return float(value)
    except (ValueError, TypeError):
        return default


def safe_int(value: Any, default: int = 0) -> int:
    """安全转换为 int，失败返回 default"""
    try:
        if value is None or value == "" or value == "-":
            return default
        return int(float(value))
    except (ValueError, TypeError):
        return default


def code_to_yahoo_symbol(code: str, market: str = "") -> str:
    """
    A 股 / 港股代码转 Yahoo Finance symbol

    Examples:
        600038 → 600038.SS
        000001 → 000001.SZ
        00700  → 0700.HK
    """
    c = code.strip()
    if market == "hk" or (len(c) == 5 and c.startswith("0")):
        return c.zfill(5) + ".HK"
    if c.startswith(("6", "5")):
        return c + ".SS"
    if c.startswith(("0", "3")):
        return c + ".SZ"
    return c


def code_to_stooq_symbol(code: str, market: str = "") -> str:
    """
    A 股 / 港股代码转 Stooq symbol

    Examples:
        600038 → 600038
        00700  → 0700.hk
    """
    c = code.strip()
    if market == "hk" or (len(c) == 5 and c.startswith("0")):
        return c.zfill(4) + ".hk"
    return c


def code_to_alphavantage_symbol(code: str, market: str = "") -> str:
    """
    A 股 / 港股代码转 Alpha Vantage symbol

    Examples:
        600038 → 600038.SHJ  (Shanghai)
        000001 → 000001.SHZ  (Shenzhen)
        00700  → 0700.HKG
    """
    c = code.strip()
    if market == "hk" or (len(c) == 5 and c.startswith("0")):
        return c.zfill(4) + ".HKG"
    if c.startswith(("6", "5")):
        return c + ".SHJ"
    if c.startswith(("0", "3")):
        return c + ".SHZ"
    return c


def code_to_twelvedata_symbol(code: str, market: str = "") -> str:
    """
    A 股 / 港股代码转 Twelve Data symbol:exchange 格式

    Examples:
        600038 → 600038:SHSE
        000001 → 000001:SZSE
        00700  → 0700:HKG
    """
    c = code.strip()
    if market == "hk" or (len(c) == 5 and c.startswith("0")):
        return c.zfill(4) + ":HKG"
    if c.startswith(("6", "5")):
        return c + ":SHSE"
    if c.startswith(("0", "3")):
        return c + ":SZSE"
    return c


def code_to_polygon_symbol(code: str, market: str = "") -> str:
    """
    A 股代码转 Polygon.io symbol

    Examples:
        600038 → 600038  (无后缀，Polygon 会根据 market 参数区分)
    """
    return code.strip()


def code_to_fmp_symbol(code: str, market: str = "") -> str:
    """
    A 股 / 港股代码转 FMP symbol

    Examples:
        600038 → 600038.SS
        000001 → 000001.SZ
        00700  → 0700.HK
    """
    return code_to_yahoo_symbol(code, market)


def code_to_eodhd_symbol(code: str, market: str = "") -> str:
    """
    A 股 / 港股代码转 EODHD symbol.exchange 格式

    Examples:
        600038 → 600038.SSE
        000001 → 000001.SZSE
        00700  → 0700.HKEX
    """
    c = code.strip()
    if market == "hk" or (len(c) == 5 and c.startswith("0")):
        return c.zfill(4) + ".HKEX"
    if c.startswith(("6", "5")):
        return c + ".SSE"
    if c.startswith(("0", "3")):
        return c + ".SZSE"
    return c


def code_to_tiingo_symbol(code: str, market: str = "") -> str:
    """
    A 股 / 港股代码转 Tiingo symbol（仅美股有效，A股不支持）

    Examples:
        AAPL → aapl
    """
    return code.strip().lower()


def code_to_alpaca_symbol(code: str, market: str = "") -> str:
    """
    A 股 / 港股代码转 Alpaca symbol（仅美股有效）

    Examples:
        AAPL → AAPL
    """
    return code.strip()
