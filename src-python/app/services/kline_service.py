import re
import json
from typing import Optional
from app.services.network_env import create_http_session

_sina = create_http_session()

_PERIOD_MAP = {
    "daily": "240",
    "weekly": "1200",
    "monthly": "5200",
    "5min": "5",
    "15min": "15",
    "30min": "30",
    "60min": "60",
}


def get_kline(
    code: str,
    period: str = "daily",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    adjust: str = "qfq",
    limit: Optional[int] = None,
) -> list[dict]:
    try:
        data = _get_kline_sina(code, period)
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
    r = _sina.get(url, timeout=15)
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
