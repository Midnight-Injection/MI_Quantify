import re
import json
from typing import Optional
from app.services.network_env import create_http_session

_PERIOD_MAP = {
    "daily": "240",
    "weekly": "1200",
    "monthly": "5200",
    "5min": "5",
    "15min": "15",
    "30min": "30",
    "60min": "60",
}


def _http_get(url: str, referer: str = "https://finance.sina.com.cn", **kwargs):
    return create_http_session(referer=referer, target_url=url).get(url, **kwargs)


def get_kline(
    code: str,
    period: str = "daily",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    adjust: str = "qfq",
    limit: Optional[int] = None,
) -> list[dict]:
    try:
        market = _infer_market(code)
        if market == "a":
            data = _get_kline_sina(code, period)
        elif market == "hk":
            data = _get_kline_hk(code, period, adjust)
        else:
            data = _get_kline_us(code, period, adjust)
        if start_date:
            start_ts = _parse_date_str(start_date)
            if start_ts:
                data = [item for item in data if item.get("timestamp", 0) >= start_ts]
        if end_date:
            end_ts = _parse_date_str(end_date)
            if end_ts:
                data = [item for item in data if item.get("timestamp", 0) <= end_ts]
        if limit and limit > 0:
            data = data[-limit:]
        return data
    except Exception as e:
        print(f"[kline] error for {code}: {e}")
        return []


def _infer_market(code: str) -> str:
    raw = str(code or "").strip().upper()
    if re.fullmatch(r"\d{5}", raw):
        return "hk"
    if re.fullmatch(r"\d{6}", raw):
        if raw.startswith(("6", "0", "3", "4", "8", "9")):
            return "a"
        return "hk"
    return "us"


def _get_kline_sina(code: str, period: str) -> list[dict]:
    if code.startswith("6"):
        sc = f"sh{code}"
    elif code.startswith(("0", "3")):
        sc = f"sz{code}"
    elif code.startswith(("4", "8")):
        sc = f"bj{code}"
    else:
        sc = code

    scale = _PERIOD_MAP.get(period, "240")
    datalen = "250" if period == "daily" else "120"

    url = f"https://quotes.sina.cn/cn/api/jsonp_v2.php/=/CN_MarketDataService.getKLineData?symbol={sc}&scale={scale}&ma=no&datalen={datalen}"
    r = _http_get(url, timeout=15)
    m = re.search(r"\((.+)\)", r.text, re.DOTALL)
    if not m:
        return []
    data = json.loads(m.group(1))
    if not isinstance(data, list):
        return []

    result = []
    for item in data:
        d = item.get("day", "")
        ts = _parse_date_str(d)
        result.append(
            {
                "timestamp": ts,
                "open": float(item.get("open", 0)),
                "high": float(item.get("high", 0)),
                "low": float(item.get("low", 0)),
                "close": float(item.get("close", 0)),
                "volume": float(item.get("volume", 0)),
                "amount": float(item.get("amount", 0))
                or float(item.get("close", 0)) * float(item.get("volume", 0)),
            }
        )
    return result


def _coerce_float(value) -> float:
    try:
        if value in ("", "-", None):
            return 0.0
        return float(value)
    except Exception:
        return 0.0


def _normalize_adjust(adjust: str) -> str:
    if adjust in ("qfq", "hfq"):
        return adjust
    return ""


def _rows_to_kline(rows: list[dict]) -> list[dict]:
    result = []
    for item in rows:
        timestamp = _parse_date_str(str(item.get("date", "") or item.get("日期", "")))
        if not timestamp:
            continue
        result.append(
            {
                "timestamp": timestamp,
                "open": _coerce_float(item.get("open", item.get("开盘", 0))),
                "high": _coerce_float(item.get("high", item.get("最高", 0))),
                "low": _coerce_float(item.get("low", item.get("最低", 0))),
                "close": _coerce_float(item.get("close", item.get("收盘", 0))),
                "volume": _coerce_float(item.get("volume", item.get("成交量", 0))),
                "amount": _coerce_float(item.get("amount", item.get("成交额", 0))),
            }
        )
    return result


def _aggregate_kline(data: list[dict], period: str) -> list[dict]:
    if period not in ("weekly", "monthly"):
        return data

    from datetime import datetime

    buckets: dict[str, dict] = {}
    for item in data:
        ts = item.get("timestamp", 0)
        if not ts:
            continue
        dt = datetime.utcfromtimestamp(ts / 1000)
        if period == "weekly":
            key = f"{dt.isocalendar().year}-{dt.isocalendar().week:02d}"
        else:
            key = f"{dt.year}-{dt.month:02d}"

        bucket = buckets.get(key)
        if not bucket:
            buckets[key] = dict(item)
            continue

        bucket["high"] = max(bucket.get("high", 0), item.get("high", 0))
        bucket["low"] = min(bucket.get("low", bucket.get("low", 0) or item.get("low", 0)), item.get("low", 0))
        bucket["close"] = item.get("close", bucket.get("close", 0))
        bucket["timestamp"] = item.get("timestamp", bucket.get("timestamp", 0))
        bucket["volume"] = bucket.get("volume", 0) + item.get("volume", 0)
        bucket["amount"] = bucket.get("amount", 0) + item.get("amount", 0)

    return [buckets[key] for key in sorted(buckets.keys())]


def _get_kline_hk(code: str, period: str, adjust: str) -> list[dict]:
    try:
        import akshare as ak

        df = ak.stock_hk_hist(
            symbol=str(code).zfill(5),
            period=period if period in ("daily", "weekly", "monthly") else "daily",
            adjust=_normalize_adjust(adjust),
        )
        if df is None or df.empty:
            return []
        return _rows_to_kline(df.to_dict("records"))
    except Exception as e:
        print(f"[kline] hk error for {code}: {e}")
        return []


def _get_kline_us(code: str, period: str, adjust: str) -> list[dict]:
    try:
        import akshare as ak

        df = ak.stock_us_daily(symbol=str(code).upper(), adjust=_normalize_adjust(adjust))
        if df is None or df.empty:
            return []
        rows = df.reset_index().rename(
            columns={
                "date": "date",
                "open": "open",
                "high": "high",
                "low": "low",
                "close": "close",
                "volume": "volume",
            }
        ).to_dict("records")
        data = _rows_to_kline(rows)
        return _aggregate_kline(data, period)
    except Exception as e:
        print(f"[kline] us error for {code}: {e}")
        return []


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
