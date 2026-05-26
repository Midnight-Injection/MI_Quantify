"""
行情（报价 + 指数）远程数据源适配器

支持的源：yfinance, alphavantage, twelvedata, polygon, eodhd, fmp, tiingo, alpaca

标准输出格式（Quote）：
{code, name, price, change, changePercent, open, high, low, close,
 preClose, volume, amount, turnover, pe, pb, totalMv, circMv, timestamp}

标准输出格式（Index）：
{code, name, price, change, changePercent, timestamp}
"""

import logging
import time as _time

from .remote_api import (
    remote_get,
    safe_float,
    code_to_yahoo_symbol,
    code_to_alphavantage_symbol,
    code_to_twelvedata_symbol,
    code_to_polygon_symbol,
    code_to_eodhd_symbol,
    code_to_fmp_symbol,
    code_to_tiingo_symbol,
    code_to_alpaca_symbol,
)

logger = logging.getLogger(__name__)


def _build_quote(
    code: str,
    name: str = "",
    price: float = 0.0,
    change: float = 0.0,
    change_pct: float = 0.0,
    open_price: float = 0.0,
    high: float = 0.0,
    low: float = 0.0,
    close: float = 0.0,
    pre_close: float = 0.0,
    volume: float = 0.0,
    amount: float = 0.0,
) -> dict:
    return {
        "code": code,
        "name": name,
        "price": price,
        "change": change,
        "changePercent": change_pct,
        "open": open_price,
        "high": high,
        "low": low,
        "close": close,
        "preClose": pre_close,
        "volume": volume,
        "amount": amount,
        "turnover": 0.0,
        "pe": 0.0,
        "pb": 0.0,
        "totalMv": 0.0,
        "circMv": 0.0,
        "timestamp": int(_time.time() * 1000),
    }


def _build_index(code: str, name: str, price: float, change: float, change_pct: float) -> dict:
    return {
        "code": code,
        "name": name,
        "price": price,
        "change": change,
        "changePercent": change_pct,
        "timestamp": int(_time.time() * 1000),
    }


# ═══════════════════════════════════════════
# 报价 (Quote) Fetchers
# ═══════════════════════════════════════════

def get_quote_yfinance(
    codes: list[str],
    market: str = "a",
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """yfinance 报价获取"""
    import yfinance as yf

    results = []
    for code in codes:
        symbol = code_to_yahoo_symbol(code, market)
        if market == "us":
            symbol = code.strip().upper()
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.fast_info
            price = safe_float(getattr(info, "last_price", 0))
            prev = safe_float(getattr(info, "previous_close", 0))
            change = price - prev if prev else 0
            results.append(_build_quote(
                code=code,
                name=getattr(info, "short_name", "") or "",
                price=price,
                change=change,
                change_pct=round(change / prev * 100, 2) if prev else 0,
                open_price=safe_float(getattr(info, "open", 0)),
                high=safe_float(getattr(info, "day_high", 0)),
                low=safe_float(getattr(info, "day_low", 0)),
                close=price,
                pre_close=prev,
                volume=safe_float(getattr(info, "last_volume", 0)),
            ))
        except Exception as e:
            logger.warning("yfinance quote failed for %s: %s", code, e)
    return results


def get_quote_alphavantage(
    codes: list[str],
    market: str = "a",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """Alpha Vantage 报价获取 (GLOBAL_QUOTE)"""
    if not api_key:
        return []

    results = []
    for code in codes:
        symbol = code_to_alphavantage_symbol(code, market)
        if market == "us":
            symbol = code.strip().upper()
        try:
            resp = remote_get(
                "https://www.alphavantage.co/query",
                api_key=api_key,
                proxy_id=proxy_id,
                params={"function": "GLOBAL_QUOTE", "symbol": symbol},
            )
            gq = resp.json().get("Global Quote", {})
            price = safe_float(gq.get("05. price"))
            prev = safe_float(gq.get("08. previous close"))
            results.append(_build_quote(
                code=code,
                price=price,
                change=safe_float(gq.get("09. change")),
                change_pct=safe_float(gq.get("10. change percent", "0").replace("%", "")),
                open_price=safe_float(gq.get("02. open")),
                high=safe_float(gq.get("03. high")),
                low=safe_float(gq.get("04. low")),
                close=price,
                pre_close=prev,
                volume=safe_float(gq.get("06. volume")),
            ))
        except Exception as e:
            logger.warning("alphavantage quote failed for %s: %s", code, e)
    return results


def get_quote_twelvedata(
    codes: list[str],
    market: str = "a",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """Twelve Data 报价获取"""
    if not api_key:
        return []

    symbols = []
    for code in codes:
        symbol = code_to_twelvedata_symbol(code, market)
        if market == "us":
            symbol = code.strip().upper()
        symbols.append(symbol)

    results = []
    try:
        resp = remote_get(
            "https://api.twelvedata.com/quote",
            api_key=api_key,
            proxy_id=proxy_id,
            params={"symbol": ",".join(symbols), "format": "JSON"},
        )
        data = resp.json()
        if not isinstance(data, dict):
            return []
        items = data if all(isinstance(v, dict) for v in data.values()) else {"_": data}
        for code, symbol in zip(codes, symbols):
            item = items.get(symbol, items.get("_", {}))
            if not isinstance(item, dict):
                continue
            price = safe_float(item.get("close"))
            prev = safe_float(item.get("previous_close"))
            results.append(_build_quote(
                code=code,
                name=item.get("name", ""),
                price=price,
                change=safe_float(item.get("change")),
                change_pct=safe_float(item.get("percent_change")),
                open_price=safe_float(item.get("open")),
                high=safe_float(item.get("high")),
                low=safe_float(item.get("low")),
                close=price,
                pre_close=prev,
                volume=safe_float(item.get("volume")),
            ))
    except Exception as e:
        logger.warning("twelvedata quote failed: %s", e)
    return results


def get_quote_polygon(
    codes: list[str],
    market: str = "a",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """Polygon.io 报价获取 (Previous Close)"""
    if not api_key:
        return []

    results = []
    for code in codes:
        symbol = code_to_polygon_symbol(code, market)
        if market == "us":
            symbol = code.strip().upper()
        try:
            url = f"https://api.polygon.io/v2/aggs/ticker/{symbol}/prev"
            resp = remote_get(url, api_key=api_key, proxy_id=proxy_id, params={"adjusted": "true"})
            data = resp.json()
            results_list = data.get("results") or []
            if not results_list:
                continue
            item = results_list[0]
            price = safe_float(item.get("c"))
            prev = safe_float(item.get("o"))
            results.append(_build_quote(
                code=code,
                price=price,
                change=price - prev,
                change_pct=round((price - prev) / prev * 100, 2) if prev else 0,
                open_price=safe_float(item.get("o")),
                high=safe_float(item.get("h")),
                low=safe_float(item.get("l")),
                close=price,
                pre_close=prev,
                volume=safe_float(item.get("v")),
            ))
        except Exception as e:
            logger.warning("polygon quote failed for %s: %s", code, e)
    return results


def get_quote_eodhd(
    codes: list[str],
    market: str = "a",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """EODHD 实时报价获取"""
    if not api_key:
        return []

    results = []
    for code in codes:
        symbol = code_to_eodhd_symbol(code, market)
        if market == "us":
            symbol = code.strip().upper() + ".US"
        try:
            url = f"https://eodhistoricaldata.com/api/real-time/{symbol}"
            resp = remote_get(url, api_key=api_key, proxy_id=proxy_id, params={"fmt": "json"})
            item = resp.json()
            if not isinstance(item, dict):
                continue
            price = safe_float(item.get("close"))
            prev = safe_float(item.get("previousClose"))
            results.append(_build_quote(
                code=code,
                price=price,
                change=safe_float(item.get("change")),
                change_pct=safe_float(item.get("change_p")),
                open_price=safe_float(item.get("open")),
                high=safe_float(item.get("high")),
                low=safe_float(item.get("low")),
                close=price,
                pre_close=prev,
                volume=safe_float(item.get("volume")),
            ))
        except Exception as e:
            logger.warning("eodhd quote failed for %s: %s", code, e)
    return results


def get_quote_fmp(
    codes: list[str],
    market: str = "a",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """FMP (Financial Modeling Prep) 报价获取"""
    if not api_key:
        return []

    results = []
    for code in codes:
        symbol = code_to_fmp_symbol(code, market)
        if market == "us":
            symbol = code.strip().upper()
        try:
            url = f"https://financialmodelingprep.com/api/v3/quote/{symbol}"
            resp = remote_get(url, api_key=api_key, proxy_id=proxy_id)
            data = resp.json()
            if not isinstance(data, list) or not data:
                continue
            item = data[0]
            price = safe_float(item.get("price"))
            prev = safe_float(item.get("previousClose"))
            results.append(_build_quote(
                code=code,
                name=item.get("name", item.get("companyName", "")),
                price=price,
                change=safe_float(item.get("change")),
                change_pct=safe_float(item.get("changesPercentage")),
                open_price=safe_float(item.get("open")),
                high=safe_float(item.get("dayHigh")),
                low=safe_float(item.get("dayLow")),
                close=price,
                pre_close=prev,
                volume=safe_float(item.get("volume")),
                amount=safe_float(item.get("volume") or 0) * price,
            ))
        except Exception as e:
            logger.warning("fmp quote failed for %s: %s", code, e)
    return results


def get_quote_tiingo(
    codes: list[str],
    market: str = "us",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """Tiingo 报价获取（仅美股）"""
    if not api_key:
        return []

    results = []
    for code in codes:
        symbol = code_to_tiingo_symbol(code, market)
        try:
            url = f"https://api.tiingo.com/tiingo/daily/{symbol}/latest"
            resp = remote_get(
                url,
                header_api_key_name="Authorization",
                api_key=f"Token {api_key}",
                proxy_id=proxy_id,
            )
            item = resp.json()
            if not isinstance(item, list):
                item = [item]
            if not item:
                continue
            it = item[0] if isinstance(item[0], dict) else {}
            price = safe_float(it.get("close", it.get("last", 0)))
            prev = safe_float(it.get("prevClose", 0))
            results.append(_build_quote(
                code=code,
                price=price,
                change=price - prev,
                change_pct=round((price - prev) / prev * 100, 2) if prev else 0,
                open_price=safe_float(it.get("open")),
                high=safe_float(it.get("high")),
                low=safe_float(it.get("low")),
                close=price,
                pre_close=prev,
                volume=safe_float(it.get("volume")),
            ))
        except Exception as e:
            logger.warning("tiingo quote failed for %s: %s", code, e)
    return results


def get_quote_alpaca(
    codes: list[str],
    market: str = "us",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """Alpaca 报价获取（仅美股）"""
    import json as _json
    from app.services.network_env import create_http_session

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

    symbols = [c.strip().upper() for c in codes]
    url = "https://data.alpaca.markets/v2/stocks/snapshots"
    session = create_http_session(
        referer="https://data.alpaca.markets/",
        proxy_id=proxy_id,
        target_url=url,
    )
    session.headers["APCA-API-KEY-ID"] = alpaca_key
    session.headers["APCA-API-SECRET-KEY"] = alpaca_secret

    try:
        resp = session.get(url, params={"symbols": ",".join(symbols)}, timeout=15)
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.warning("alpaca quote failed: %s", e)
        return []

    results = []
    for code in codes:
        sym = code.strip().upper()
        snap = data.get(sym, {})
        daily = snap.get("dailyBar", {})
        prev = snap.get("prevDailyBar", {})
        price = safe_float(daily.get("c"))
        prev_close = safe_float(prev.get("c"))
        results.append(_build_quote(
            code=code,
            price=price,
            change=price - prev_close,
            change_pct=round((price - prev_close) / prev_close * 100, 2) if prev_close else 0,
            open_price=safe_float(daily.get("o")),
            high=safe_float(daily.get("h")),
            low=safe_float(daily.get("l")),
            close=price,
            pre_close=prev_close,
            volume=safe_float(daily.get("v")),
        ))
    return results


# ═══════════════════════════════════════════
# 指数 (Index) Fetchers
# ═══════════════════════════════════════════

_A_SHARE_INDICES = {
    "000001": "上证指数",
    "399001": "深证成指",
    "399006": "创业板指",
}
_US_INDICES = {
    "^DJI": "道琼斯",
    "^GSPC": "标普500",
    "^IXIC": "纳斯达克",
    "^VIX": "VIX",
}


def get_indices_yfinance(
    market: str = "a",
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """yfinance 指数获取"""
    import yfinance as yf

    if market == "us":
        index_map = _US_INDICES
    else:
        index_map = {
            "000001.SS": "上证指数",
            "399001.SZ": "深证成指",
            "399006.SZ": "创业板指",
        }

    results = []
    for symbol, name in index_map.items():
        try:
            ticker = yf.Ticker(symbol)
            info = ticker.fast_info
            price = safe_float(getattr(info, "last_price", 0))
            prev = safe_float(getattr(info, "previous_close", 0))
            change = price - prev if prev else 0
            results.append(_build_index(
                code=symbol.replace(".SS", "").replace(".SZ", "").replace("^", ""),
                name=name,
                price=price,
                change=change,
                change_pct=round(change / prev * 100, 2) if prev else 0,
            ))
        except Exception as e:
            logger.warning("yfinance index failed for %s: %s", symbol, e)
    return results


def get_indices_stooq(
    market: str = "a",
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """Stooq 指数获取（CSV）"""
    if market == "us":
        symbols = {"^spx": "标普500", "^dji": "道琼斯", "^ndq": "纳斯达克"}
    else:
        symbols = {"000001": "上证指数", "399001": "深证成指", "399006": "创业板指"}

    results = []
    for sym, name in symbols.items():
        try:
            url = f"https://stooq.com/q/d/l/?s={sym}&i=d&l=1"
            resp = remote_get(url, proxy_id=proxy_id, referer="https://stooq.com/")
            lines = resp.text.strip().split("\n")
            if len(lines) < 2:
                continue
            parts = lines[-1].strip().split(",")
            if len(parts) < 5:
                continue
            close = safe_float(parts[4])
            prev_close = safe_float(parts[1]) if len(lines) >= 3 else 0
            if prev_close == 0 and len(lines) >= 3:
                prev_parts = lines[-2].strip().split(",")
                if len(prev_parts) >= 5:
                    prev_close = safe_float(prev_parts[4])
            change = close - prev_close if prev_close else 0
            results.append(_build_index(
                code=sym.lstrip("^"),
                name=name,
                price=close,
                change=change,
                change_pct=round(change / prev_close * 100, 2) if prev_close else 0,
            ))
        except Exception as e:
            logger.warning("stooq index failed for %s: %s", sym, e)
    return results


# ═══════════════════════════════════════════
# Dispatch 映射
# ═══════════════════════════════════════════

QUOTE_REMOTE_FETCHERS: dict[str, callable] = {
    "yfinance": get_quote_yfinance,
    "alphavantage": get_quote_alphavantage,
    "twelvedata": get_quote_twelvedata,
    "polygon": get_quote_polygon,
    "eodhd": get_quote_eodhd,
    "fmp": get_quote_fmp,
    "tiingo": get_quote_tiingo,
    "alpaca": get_quote_alpaca,
}

INDEX_REMOTE_FETCHERS: dict[str, callable] = {
    "yfinance": get_indices_yfinance,
    "stooq": get_indices_stooq,
}
