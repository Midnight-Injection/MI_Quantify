"""
K 线远程数据源适配器

支持的源：yfinance, stooq, alphavantage, twelvedata, polygon, eodhd,
          tushare, jqdata, rqdata, tiingo, alpaca

标准输出格式：
{"timestamp": int(ms), "open": float, "high": float, "low": float,
 "close": float, "volume": float, "amount": float}
"""

import logging
from typing import Optional

from .remote_api import (
    remote_get,
    remote_post,
    safe_float,
    safe_int,
    code_to_yahoo_symbol,
    code_to_stooq_symbol,
    code_to_alphavantage_symbol,
    code_to_twelvedata_symbol,
    code_to_polygon_symbol,
    code_to_eodhd_symbol,
)

logger = logging.getLogger(__name__)


def _parse_date_str(d: str) -> int:
    """解析日期字符串为毫秒时间戳"""
    try:
        from datetime import datetime
        dt = datetime.strptime(d[:19], "%Y-%m-%d %H:%M:%S")
        return int(dt.timestamp() * 1000)
    except Exception:
        try:
            from datetime import datetime
            dt = datetime.strptime(d[:10], "%Y-%m-%d")
            return int(dt.timestamp() * 1000)
        except Exception:
            return 0


def _coerce_float(value) -> float:
    try:
        if value in ("", "-", None):
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def _build_kline_row(timestamp: int, o: float, h: float, l: float,
                      c: float, v: float, a: float = 0.0) -> dict:
    return {
        "timestamp": timestamp,
        "open": o,
        "high": h,
        "low": l,
        "close": c,
        "volume": v,
        "amount": a or (c * v),
    }


# ─── yfinance (sidecar 模式，Python 库) ───

def get_kline_yfinance(
    code: str,
    period: str = "daily",
    adjust: str = "qfq",
    market: str = "a",
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """
    yfinance K 线获取（sidecar 模式，直接调用 Python 库）

    Args:
        code: 股票代码
        period: daily / weekly / monthly
        adjust: qfq / hfq / 空
        market: a / hk / us
        proxy_id: 代理 ID
    """
    import yfinance as yf

    yf_period_map = {"daily": "1y", "weekly": "2y", "monthly": "5y"}
    yf_interval_map = {"daily": "1d", "weekly": "1wk", "monthly": "1mo"}

    symbol = code_to_yahoo_symbol(code, market)
    if market == "us":
        symbol = code.strip().upper()

    ticker = yf.Ticker(symbol)
    df = ticker.history(
        period=yf_period_map.get(period, "1y"),
        interval=yf_interval_map.get(period, "1d"),
        auto_adjust=(adjust == "hfq"),
    )
    if df is None or df.empty:
        return []

    result = []
    for idx, row in df.iterrows():
        ts = int(idx.timestamp() * 1000)
        result.append(_build_kline_row(
            ts,
            safe_float(row.get("Open")),
            safe_float(row.get("High")),
            safe_float(row.get("Low")),
            safe_float(row.get("Close")),
            safe_float(row.get("Volume")),
            safe_float(row.get("Close")) * safe_float(row.get("Volume")),
        ))
    return result


# ─── Stooq (CSV 下载) ───

def get_kline_stooq(
    code: str,
    period: str = "daily",
    adjust: str = "qfq",
    market: str = "a",
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """
    Stooq K 线获取（CSV 下载）

    Args:
        code: 股票代码
        period: daily / weekly / monthly
        adjust: 复权类型
        market: a / hk / us
        proxy_id: 代理 ID
    """
    symbol = code_to_stooq_symbol(code, market)
    if market == "us":
        symbol = code.strip().lower()

    stooq_period = {"daily": "d", "weekly": "w", "monthly": "m"}.get(period, "d")
    url = f"https://stooq.com/q/d/l/?s={symbol}&i={stooq_period}"

    resp = remote_get(url, proxy_id=proxy_id, referer="https://stooq.com/")
    lines = resp.text.strip().split("\n")
    if len(lines) < 2:
        return []

    result = []
    for line in lines[1:]:
        parts = line.strip().split(",")
        if len(parts) < 7:
            continue
        ts = _parse_date_str(parts[0].strip())
        if not ts:
            continue
        result.append(_build_kline_row(
            ts,
            safe_float(parts[1]),
            safe_float(parts[2]),
            safe_float(parts[3]),
            safe_float(parts[4]),
            safe_float(parts[5]),
            safe_float(parts[6]),
        ))
    return result


# ─── Alpha Vantage ───

def get_kline_alphavantage(
    code: str,
    period: str = "daily",
    adjust: str = "qfq",
    market: str = "a",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """
    Alpha Vantage K 线获取

    Args:
        code: 股票代码
        period: daily / weekly / monthly
        adjust: 复权类型
        market: a / hk / us
        api_key: Alpha Vantage API Key
        proxy_id: 代理 ID
    """
    if not api_key:
        return []

    symbol = code_to_alphavantage_symbol(code, market)
    if market == "us":
        symbol = code.strip().upper()

    fn = {"daily": "TIME_SERIES_DAILY", "weekly": "TIME_SERIES_WEEKLY",
          "monthly": "TIME_SERIES_MONTHLY"}.get(period, "TIME_SERIES_DAILY")

    resp = remote_get(
        "https://www.alphavantage.co/query",
        api_key=api_key,
        proxy_id=proxy_id,
        params={"function": fn, "symbol": symbol, "outputsize": "full", "datatype": "json"},
    )
    data = resp.json()

    ts_key = None
    for key in data:
        if "Time Series" in key:
            ts_key = key
            break
    if not ts_key:
        return []

    result = []
    for date_str, values in data[ts_key].items():
        ts = _parse_date_str(date_str)
        if not ts:
            continue
        result.append(_build_kline_row(
            ts,
            safe_float(values.get("1. open")),
            safe_float(values.get("2. high")),
            safe_float(values.get("3. low")),
            safe_float(values.get("4. close")),
            safe_float(values.get("5. volume")),
            safe_float(values.get("4. close")) * safe_float(values.get("5. volume")),
        ))
    return sorted(result, key=lambda x: x["timestamp"])


# ─── Twelve Data ───

def get_kline_twelvedata(
    code: str,
    period: str = "daily",
    adjust: str = "qfq",
    market: str = "a",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """
    Twelve Data K 线获取

    Args:
        code: 股票代码
        period: daily / weekly / monthly
        adjust: 复权类型
        market: a / hk / us
        api_key: Twelve Data API Key
        proxy_id: 代理 ID
    """
    if not api_key:
        return []

    symbol = code_to_twelvedata_symbol(code, market)
    if market == "us":
        symbol = code.strip().upper()

    interval = {"daily": "1day", "weekly": "1week", "monthly": "1month"}.get(period, "1day")

    resp = remote_get(
        "https://api.twelvedata.com/time_series",
        api_key=api_key,
        proxy_id=proxy_id,
        params={"symbol": symbol, "interval": interval, "outputsize": "250", "format": "JSON"},
    )
    data = resp.json()
    values = data.get("values") or []
    if not values:
        return []

    result = []
    for item in values:
        ts = _parse_date_str(item.get("datetime", ""))
        if not ts:
            continue
        result.append(_build_kline_row(
            ts,
            safe_float(item.get("open")),
            safe_float(item.get("high")),
            safe_float(item.get("low")),
            safe_float(item.get("close")),
            safe_float(item.get("volume")),
            safe_float(item.get("close")) * safe_float(item.get("volume")),
        ))
    return sorted(result, key=lambda x: x["timestamp"])


# ─── Polygon.io ───

def get_kline_polygon(
    code: str,
    period: str = "daily",
    adjust: str = "qfq",
    market: str = "a",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """
    Polygon.io K 线获取

    Args:
        code: 股票代码
        period: daily / weekly / monthly
        adjust: 复权类型
        market: a / hk / us
        api_key: Polygon API Key
        proxy_id: 代理 ID
    """
    if not api_key:
        return []

    symbol = code_to_polygon_symbol(code, market)
    if market == "us":
        symbol = code.strip().upper()

    timespan = {"daily": "day", "weekly": "week", "monthly": "month"}.get(period, "day")
    url = f"https://api.polygon.io/v2/aggs/ticker/{symbol}/range/1/{timespan}/2020-01-01/2029-12-31"

    resp = remote_get(
        url,
        api_key=api_key,
        proxy_id=proxy_id,
        params={"adjusted": "true", "sort": "asc", "limit": 500},
    )
    data = resp.json()
    results = data.get("results") or []

    return [
        _build_kline_row(
            item.get("t", 0),
            safe_float(item.get("o")),
            safe_float(item.get("h")),
            safe_float(item.get("l")),
            safe_float(item.get("c")),
            safe_float(item.get("v")),
            safe_float(item.get("c")) * safe_float(item.get("v")),
        )
        for item in results
    ]


# ─── EODHD ───

def get_kline_eodhd(
    code: str,
    period: str = "daily",
    adjust: str = "qfq",
    market: str = "a",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """
    EODHD K 线获取

    Args:
        code: 股票代码
        period: daily / weekly / monthly
        adjust: 复权类型
        market: a / hk / us
        api_key: EODHD API Token
        proxy_id: 代理 ID
    """
    if not api_key:
        return []

    symbol = code_to_eodhd_symbol(code, market)
    if market == "us":
        symbol = code.strip().upper() + ".US"

    url = f"https://eodhistoricaldata.com/api/eod/{symbol}"
    resp = remote_get(
        url,
        api_key=api_key,
        proxy_id=proxy_id,
        params={"fmt": "json", "period": period[:1]},
    )
    data = resp.json()
    if not isinstance(data, list):
        return []

    result = []
    for item in data:
        ts = _parse_date_str(item.get("date", ""))
        if not ts:
            continue
        result.append(_build_kline_row(
            ts,
            safe_float(item.get("open")),
            safe_float(item.get("high")),
            safe_float(item.get("low")),
            safe_float(item.get("close")),
            safe_float(item.get("volume")),
            safe_float(item.get("close")) * safe_float(item.get("volume")),
        ))
    return result


# ─── Tushare ───

def get_kline_tushare(
    code: str,
    period: str = "daily",
    adjust: str = "qfq",
    market: str = "a",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """
    Tushare K 线获取（POST + token）

    Args:
        code: 股票代码
        period: daily / weekly / monthly
        adjust: qfq / hfq / 空
        market: a（仅支持 A 股）
        api_key: Tushare Token
        proxy_id: 代理 ID
    """
    if not api_key:
        return []

    raw = code.strip()
    if raw.startswith("6"):
        ts_code = f"{raw}.SH"
    elif raw.startswith(("0", "3")):
        ts_code = f"{raw}.SZ"
    elif raw.startswith(("4", "8")):
        ts_code = f"{raw}.BJ"
    else:
        ts_code = raw

    freq = {"daily": "D", "weekly": "W", "monthly": "M"}.get(period, "D")
    adj = {"qfq": "qfq", "hfq": "hfq", "": None}.get(adjust)

    params: dict = {
        "api_name": "daily" if not adj else f"daily",
        "token": api_key,
        "params": {"ts_code": ts_code, "freq": freq},
        "fields": "trade_date,open,high,low,close,vol,amount",
    }
    if adj:
        params["params"]["adj"] = adj

    resp = remote_post(
        "https://api.tushare.pro",
        proxy_id=proxy_id,
        json_body=params,
    )
    data = resp.json()
    fields = data.get("data", {}).get("fields", [])
    items = data.get("data", {}).get("items", [])
    if not fields or not items:
        return []

    idx_map = {f: i for i, f in enumerate(fields)}
    result = []
    for row in items:
        date_str = str(row[idx_map.get("trade_date", 0)]) if "trade_date" in idx_map else ""
        ts = _parse_date_str(date_str)
        if not ts:
            continue
        result.append(_build_kline_row(
            ts,
            safe_float(row[idx_map.get("open", -1)]) if "open" in idx_map else 0,
            safe_float(row[idx_map.get("high", -1)]) if "high" in idx_map else 0,
            safe_float(row[idx_map.get("low", -1)]) if "low" in idx_map else 0,
            safe_float(row[idx_map.get("close", -1)]) if "close" in idx_map else 0,
            safe_float(row[idx_map.get("vol", -1)]) if "vol" in idx_map else 0,
            safe_float(row[idx_map.get("amount", -1)]) if "amount" in idx_map else 0,
        ))
    return sorted(result, key=lambda x: x["timestamp"])


# ─── JQData (JoinQuant) ───

def get_kline_jqdata(
    code: str,
    period: str = "daily",
    adjust: str = "qfq",
    market: str = "a",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """
    JQData K 线获取（用户名+密码认证）

    JQData 使用 mob+password 认证获取 token，再查询数据

    Args:
        code: 股票代码
        period: daily / weekly / monthly
        adjust: qfq / hfq / 空
        market: a（仅支持 A 股）
        api_key: JSON 格式 {"username":"...","password":"..."}
        proxy_id: 代理 ID
    """
    import json as _json

    if not api_key:
        return []
    try:
        creds = _json.loads(api_key)
        username = creds.get("username", "")
        password = creds.get("password", "")
    except Exception:
        return []

    if not username or not password:
        return []

    raw = code.strip()
    if raw.startswith("6"):
        jq_code = f"{raw}.XSHG"
    elif raw.startswith(("0", "3")):
        jq_code = f"{raw}.XSHE"
    else:
        jq_code = raw

    auth_resp = remote_post(
        "https://dataapi.joinquant.com/apis",
        proxy_id=proxy_id,
        json_body={"method": "get_current_token", "mob": username, "pwd": password},
    )
    token = auth_resp.text.strip().strip('"')
    if not token:
        return []

    freq_map = {"daily": "1d", "weekly": "1w", "monthly": "1M"}
    resp = remote_post(
        "https://dataapi.joinquant.com/apis",
        proxy_id=proxy_id,
        json_body={
            "method": "get_price_period",
            "token": token,
            "code": jq_code,
            "unit": freq_map.get(period, "1d"),
            "count": 500,
        },
    )
    data = resp.json()
    if not isinstance(data, list):
        return []

    result = []
    for item in data:
        ts = _parse_date_str(str(item.get("date", "")))
        if not ts:
            continue
        result.append(_build_kline_row(
            ts,
            safe_float(item.get("open")),
            safe_float(item.get("high")),
            safe_float(item.get("low")),
            safe_float(item.get("close")),
            safe_float(item.get("volume")),
            safe_float(item.get("money")),
        ))
    return result


# ─── RQData (RiceQuant) ───

def get_kline_rqdata(
    code: str,
    period: str = "daily",
    adjust: str = "qfq",
    market: str = "a",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """
    RQData K 线获取（用户名+密码认证）

    Args:
        code: 股票代码
        period: daily / weekly / monthly
        adjust: qfq / hfq / 空
        market: a（仅支持 A 股）
        api_key: JSON 格式 {"username":"...","password":"..."}
        proxy_id: 代理 ID
    """
    import json as _json

    if not api_key:
        return []
    try:
        creds = _json.loads(api_key)
        username = creds.get("username", "")
        password = creds.get("password", "")
    except Exception:
        return []

    if not username or not password:
        return []

    raw = code.strip()
    if raw.startswith("6"):
        rq_code = f"XSHG:{raw}"
    elif raw.startswith(("0", "3")):
        rq_code = f"XSHE:{raw}"
    else:
        rq_code = raw

    auth_resp = remote_post(
        "https://rqdatac.ricequant.com/passport/login",
        proxy_id=proxy_id,
        json_body={"username": username, "password": password},
    )
    auth_data = auth_resp.json()
    access_token = auth_data.get("access_token", "")
    if not access_token:
        return []

    freq_map = {"daily": "1d", "weekly": "1w", "monthly": "1M"}
    resp = remote_get(
        "https://rqdatac.ricequant.com/api/stock_price",
        header_api_key_name="Authorization",
        api_key=f"Bearer {access_token}",
        proxy_id=proxy_id,
        params={"code": rq_code, "frequency": freq_map.get(period, "1d"), "count": 500},
    )
    data = resp.json()
    rows = data.get("data", {}).get("rows", []) or data.get("data", [])
    if not isinstance(rows, list):
        return []

    result = []
    for item in rows:
        ts = _parse_date_str(str(item.get("date", item.get("trading_date", ""))))
        if not ts:
            continue
        result.append(_build_kline_row(
            ts,
            safe_float(item.get("open")),
            safe_float(item.get("high")),
            safe_float(item.get("low")),
            safe_float(item.get("close")),
            safe_float(item.get("volume")),
            safe_float(item.get("total_turnover", item.get("amount", 0))),
        ))
    return result


# ─── Tiingo ───

def get_kline_tiingo(
    code: str,
    period: str = "daily",
    adjust: str = "qfq",
    market: str = "us",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """
    Tiingo K 线获取（Bearer token，仅美股）

    Args:
        code: 美股代码
        period: daily / weekly / monthly
        adjust: 复权类型
        market: us
        api_key: Tiingo API Token
        proxy_id: 代理 ID
    """
    if not api_key:
        return []

    symbol = code.strip().lower()
    freq = {"daily": "daily", "weekly": "weekly", "monthly": "monthly"}.get(period, "daily")
    url = f"https://api.tiingo.com/tiingo/daily/{symbol}/prices"

    resp = remote_get(
        url,
        header_api_key_name="Authorization",
        api_key=f"Token {api_key}",
        proxy_id=proxy_id,
        params={"startDate": "2020-01-01", "frequency": freq},
    )
    data = resp.json()
    if not isinstance(data, list):
        return []

    result = []
    for item in data:
        ts = _parse_date_str(item.get("date", ""))
        if not ts:
            continue
        result.append(_build_kline_row(
            ts,
            safe_float(item.get("open")),
            safe_float(item.get("high")),
            safe_float(item.get("low")),
            safe_float(item.get("close")),
            safe_float(item.get("volume")),
            safe_float(item.get("close")) * safe_float(item.get("volume")),
        ))
    return result


# ─── Alpaca ───

def get_kline_alpaca(
    code: str,
    period: str = "daily",
    adjust: str = "qfq",
    market: str = "us",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """
    Alpaca K 线获取（API Key + Secret Header，仅美股）

    Args:
        code: 美股代码
        period: daily / weekly / monthly
        adjust: 复权类型
        market: us
        api_key: JSON 格式 {"key":"...","secret":"..."}
        proxy_id: 代理 ID
    """
    import json as _json

    if not api_key:
        return []
    try:
        creds = _json.loads(api_key)
        alpaca_key = creds.get("key", "")
        alpaca_secret = creds.get("secret", "")
    except Exception:
        return []

    if not alpaca_key or not alpaca_secret:
        return []

    symbol = code.strip().upper()
    timeframe = {"daily": "1Day", "weekly": "1Week", "monthly": "1Month"}.get(period, "1Day")
    url = f"https://data.alpaca.markets/v2/stocks/{symbol}/bars"

    session = __import__("app.services.network_env", fromlist=["create_http_session"]).create_http_session(
        referer="https://data.alpaca.markets/",
        proxy_id=proxy_id,
        target_url=url,
    )
    session.headers["APCA-API-KEY-ID"] = alpaca_key
    session.headers["APCA-API-SECRET-KEY"] = alpaca_secret

    resp = session.get(url, params={"timeframe": timeframe, "limit": 500}, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    bars = data.get("bars") or []

    result = []
    for bar in bars:
        ts = bar.get("t", 0)
        if isinstance(ts, str):
            ts = _parse_date_str(ts)
        result.append(_build_kline_row(
            ts,
            safe_float(bar.get("o")),
            safe_float(bar.get("h")),
            safe_float(bar.get("l")),
            safe_float(bar.get("c")),
            safe_float(bar.get("v")),
            safe_float(bar.get("c")) * safe_float(bar.get("v")),
        ))
    return result


# ─── Dispatch 映射 ───

KLINE_REMOTE_FETCHERS: dict[str, callable] = {
    "yfinance": get_kline_yfinance,
    "stooq": get_kline_stooq,
    "alphavantage": get_kline_alphavantage,
    "twelvedata": get_kline_twelvedata,
    "polygon": get_kline_polygon,
    "eodhd": get_kline_eodhd,
    "tushare": get_kline_tushare,
    "jqdata": get_kline_jqdata,
    "rqdata": get_kline_rqdata,
    "tiingo": get_kline_tiingo,
    "alpaca": get_kline_alpaca,
}
