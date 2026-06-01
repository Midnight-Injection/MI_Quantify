import math
import time
from typing import Optional

_CACHE_TTL_SECONDS = 60
_etf_spot_cache: dict[str, tuple[float, list[dict]]] = {}


def _safe_float(value) -> float:
    try:
        if value in ("", "-", None):
            return 0.0
        v = float(value)
        if math.isnan(v) or math.isinf(v):
            return 0.0
        return v
    except Exception:
        return 0.0


def _parse_date_str(d: str) -> int:
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


def _normalize_period(period: str) -> str:
    mapping = {"daily": "daily", "weekly": "weekly", "monthly": "monthly"}
    return mapping.get(period, "daily")


def _normalize_adjust(adjust: str) -> str:
    if adjust in ("qfq", "hfq"):
        return adjust
    return ""


def get_etf_spot() -> list[dict]:
    cache_key = "etf_spot"
    cached = _etf_spot_cache.get(cache_key)
    if cached and (time.time() - cached[0] < _CACHE_TTL_SECONDS):
        return cached[1]

    try:
        import akshare as ak
        df = ak.fund_etf_spot_em()
        if df is None or df.empty:
            return cached[1] if cached else []
        result = []
        for _, row in df.iterrows():
            result.append({
                "code": str(row.get("代码", "")),
                "name": str(row.get("名称", "")),
                "price": _safe_float(row.get("最新价")),
                "change": _safe_float(row.get("涨跌额")),
                "changePercent": _safe_float(row.get("涨跌幅")),
                "volume": _safe_float(row.get("成交量")),
                "amount": _safe_float(row.get("成交额")),
                "open": _safe_float(row.get("今开")),
                "high": _safe_float(row.get("最高")),
                "low": _safe_float(row.get("最低")),
                "preClose": _safe_float(row.get("昨收")),
            })
        _etf_spot_cache[cache_key] = (time.time(), result)
        return result
    except Exception as e:
        print(f"[etf] spot error: {e}")
        return cached[1] if cached else []


def get_etf_kline(
    code: str,
    period: str = "daily",
    adjust: str = "qfq",
    limit: Optional[int] = None,
) -> list[dict]:
    try:
        import akshare as ak
        symbol = str(code).strip()
        ak_period = _normalize_period(period)
        ak_adjust = _normalize_adjust(adjust)
        df = ak.fund_etf_hist_em(
            symbol=symbol,
            period=ak_period,
            adjust=ak_adjust,
        )
        if df is None or df.empty:
            return []
        result = []
        for _, row in df.iterrows():
            timestamp = _parse_date_str(str(row.get("日期", "")))
            if not timestamp:
                continue
            result.append({
                "timestamp": timestamp,
                "open": _safe_float(row.get("开盘")),
                "high": _safe_float(row.get("最高")),
                "low": _safe_float(row.get("最低")),
                "close": _safe_float(row.get("收盘")),
                "volume": _safe_float(row.get("成交量")),
                "amount": _safe_float(row.get("成交额")),
            })
        if limit and limit > 0:
            result = result[-limit:]
        return result
    except Exception as e:
        print(f"[etf] kline error for {code}: {e}")
        return []
