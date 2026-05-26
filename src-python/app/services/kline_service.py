import re
import json
from typing import Optional
from app.services.network_env import create_http_session
from app.services.datasource_registry import get_sources_for_tool
from app.services.kline_remote_fetchers import KLINE_REMOTE_FETCHERS

_PERIOD_MAP = {
    "daily": "240",
    "weekly": "1200",
    "monthly": "5200",
    "5min": "5",
    "15min": "15",
    "30min": "30",
    "60min": "60",
}


def _http_get(url: str, referer: str = "https://finance.sina.com.cn", proxy_id: str | None = None, **kwargs):
    return create_http_session(referer=referer, target_url=url, proxy_id=proxy_id).get(url, **kwargs)


def get_kline(
    code: str,
    period: str = "daily",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    adjust: str = "qfq",
    limit: Optional[int] = None,
    preferred_source: Optional[str] = None,
) -> list[dict]:
    try:
        market = _infer_market(code)
        sources = get_sources_for_tool("load_kline", preferred_source)
        data = _fetch_kline_multi_source(code, period, adjust, market, sources)
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


def _fetch_kline_multi_source(code: str, period: str, adjust: str, market: str, sources: list[dict]) -> list[dict]:
    fetchers = []
    for source in sources:
        source_id = source.get("id", "")
        proxy_id = source.get("proxyId")
        api_key = source.get("apiKey")
        if market == "a":
            if source_id == "sina":
                fetchers.append(("sina", lambda pid=proxy_id: _get_kline_sina(code, period, proxy_id=pid)))
            elif source_id == "akshare":
                fetchers.append(("akshare", lambda pid=proxy_id: _get_kline_akshare_a(code, period, adjust)))
            elif source_id == "baostock":
                fetchers.append(("baostock", lambda pid=proxy_id: _get_kline_baostock(code, period, adjust)))
        elif market == "hk":
            if source_id == "akshare":
                fetchers.append(("akshare", lambda pid=proxy_id: _get_kline_hk(code, period, adjust)))
        elif market == "us":
            if source_id == "akshare":
                fetchers.append(("akshare", lambda pid=proxy_id: _get_kline_us(code, period, adjust)))

        remote_fn = KLINE_REMOTE_FETCHERS.get(source_id)
        if remote_fn:
            fetchers.append((source_id, lambda fn=remote_fn, pid=proxy_id, ak=api_key: fn(code, period=period, adjust=adjust, market=market, proxy_id=pid, api_key=ak)))

    if not fetchers:
        if market == "a":
            return _get_kline_sina(code, period)
        elif market == "hk":
            return _get_kline_hk(code, period, adjust)
        else:
            return _get_kline_us(code, period, adjust)

    for name, fetcher in fetchers:
        try:
            data = fetcher()
            if data:
                return data
            print(f"[kline] {name} returned empty for {code}")
        except Exception as e:
            print(f"[kline] {name} failed for {code}: {e}")
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


def _get_kline_sina(code: str, period: str, proxy_id: str | None = None) -> list[dict]:
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
    r = _http_get(url, timeout=15, proxy_id=proxy_id)
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


def _get_kline_akshare_a(code: str, period: str, adjust: str) -> list[dict]:
    try:
        import akshare as ak

        symbol = str(code).strip()
        if symbol.startswith("6"):
            ak_symbol = f"sh{symbol}"
        elif symbol.startswith(("0", "3")):
            ak_symbol = f"sz{symbol}"
        elif symbol.startswith(("4", "8")):
            ak_symbol = f"bj{symbol}"
        else:
            ak_symbol = symbol

        ak_period = period if period in ("daily", "weekly", "monthly") else "daily"
        df = ak.stock_zh_a_hist(
            symbol=ak_symbol,
            period=ak_period,
            adjust=_normalize_adjust(adjust),
        )
        if df is None or df.empty:
            return []
        return _rows_to_kline(df.to_dict("records"))
    except Exception as e:
        print(f"[kline] akshare A error for {code}: {e}")
        return []


def _get_kline_baostock(code: str, period: str, adjust: str) -> list[dict]:
    try:
        import baostock as bs
        from datetime import datetime, timedelta

        raw = str(code).strip()
        if raw.startswith("6"):
            bs_code = f"sh.{raw}"
        elif raw.startswith(("0", "3")):
            bs_code = f"sz.{raw}"
        else:
            bs_code = f"bj.{raw}"

        login = bs.login()
        if str(login.error_code) != "0":
            return []
        try:
            end_date = datetime.now().strftime("%Y-%m-%d")
            start_date = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")

            bs_period = {"daily": "d", "weekly": "w", "monthly": "m"}.get(period, "d")
            bs_adjust = {"qfq": "2", "hfq": "1", "": "3"}.get(adjust, "3")

            rs = bs.query_history_k_data_plus(
                bs_code,
                "date,open,high,low,close,volume,amount",
                start_date=start_date,
                end_date=end_date,
                frequency=bs_period,
                adjustflag=bs_adjust,
            )
            if str(rs.error_code) != "0":
                return []

            rows = []
            while rs.next():
                row = rs.get_row_data()
                if row and row[0]:
                    rows.append({
                        "date": row[0],
                        "open": row[1],
                        "high": row[2],
                        "low": row[3],
                        "close": row[4],
                        "volume": row[5],
                        "amount": row[6],
                    })
            return _rows_to_kline(rows)
        finally:
            try:
                bs.logout()
            except Exception:
                pass
    except Exception as e:
        print(f"[kline] baostock error for {code}: {e}")
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
