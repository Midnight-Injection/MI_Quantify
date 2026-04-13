import re
import json
import threading
import time
import subprocess
from datetime import datetime
from app.services.network_env import create_http_session, get_original_proxy_env
from app.services.news_service import get_stock_news as get_stock_news_feed

_sina = create_http_session()

_finance_cache = {}
_finance_cache_time = 0
_finance_lock = threading.Lock()
_finance_loading = False
_eastmoney_quote_cache = {}
_eastmoney_quote_cache_time = {}


def _safe_float(v):
    try:
        return float(v) if v and v not in ("-", "") else 0
    except (ValueError, TypeError):
        return 0


def get_stock_info(code: str) -> dict:
    default = {
        "code": code,
        "name": "",
        "price": 0,
        "change": 0,
        "changePercent": 0,
        "open": 0,
        "high": 0,
        "low": 0,
        "preClose": 0,
        "volume": 0,
        "amount": 0,
        "turnover": 0,
        "date": "",
        "time": "",
        "bids": [],
        "asks": [],
    }
    try:
        if code.startswith("6"):
            sc = f"sh{code}"
        elif code.startswith(("0", "3")):
            sc = f"sz{code}"
        else:
            sc = f"bj{code}"

        url = f"https://hq.sinajs.cn/list={sc}"
        r = _sina.get(url, timeout=10)
        m = re.search(r'"([^"]*)"', r.text)
        if not m or not m.group(1):
            return default

        parts = m.group(1).split(",")
        if len(parts) < 32:
            return default

        name = parts[0]
        open_p = _safe_float(parts[1])
        prev_close = _safe_float(parts[2])
        price = _safe_float(parts[3])
        high = _safe_float(parts[4])
        low = _safe_float(parts[5])
        vol = _safe_float(parts[8])
        amt = _safe_float(parts[9])
        chg = price - prev_close if prev_close else 0
        chg_pct = (chg / prev_close * 100) if prev_close else 0

        date_str = parts[30] if len(parts) > 30 else ""
        time_str = parts[31].split(",")[0] if len(parts) > 31 else ""

        bids = []
        for i in range(5):
            vi = 10 + i * 2
            pi = 11 + i * 2
            if pi < len(parts):
                bids.append(
                    {"price": _safe_float(parts[pi]), "volume": _safe_float(parts[vi])}
                )

        asks = []
        for i in range(5):
            vi = 20 + i * 2
            pi = 21 + i * 2
            if pi < len(parts):
                asks.append(
                    {"price": _safe_float(parts[pi]), "volume": _safe_float(parts[vi])}
                )

        return {
            "code": code,
            "name": name,
            "price": price,
            "open": open_p,
            "high": high,
            "low": low,
            "preClose": prev_close,
            "change": round(chg, 2),
            "changePercent": round(chg_pct, 2),
            "volume": vol,
            "amount": amt,
            "turnover": 0,
            "date": date_str,
            "time": time_str,
            "bids": bids,
            "asks": asks,
        }
    except Exception as e:
        print(f"[stock] info error for {code}: {e}")
        return default


def get_stock_news(code: str) -> list[dict]:
    return get_stock_news_feed(code, 15)


def _load_finance_batch():
    global _finance_cache, _finance_cache_time, _finance_loading
    if _finance_loading:
        return
    _finance_loading = True
    try:
        cache = {}
        for p in range(1, 71):
            url = f"https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page={p}&num=80&sort=changepercent&asc=0&node=hs_a&_s_r_a=auto"
            try:
                r = _sina.get(url, timeout=15)
                stocks = json.loads(r.text)
                if not isinstance(stocks, list):
                    continue
                for s in stocks:
                    scode = (
                        s.get("code", "")
                        .replace("sh", "")
                        .replace("sz", "")
                        .replace("bj", "")
                    )
                    try:
                        cache[scode] = {
                            "pe": _safe_float(s.get("per", 0)),
                            "pb": _safe_float(s.get("pb", 0)),
                            "totalMv": _safe_float(s.get("mktcap", 0)) * 10000,
                            "circMv": _safe_float(s.get("nmc", 0)) * 10000,
                            "turnover": _safe_float(s.get("turnoverratio", 0)),
                        }
                    except Exception:
                        pass
            except Exception:
                continue
        with _finance_lock:
            _finance_cache = cache
            _finance_cache_time = time.time()
    finally:
        _finance_loading = False


def _ensure_finance_loaded():
    if _finance_cache and time.time() - _finance_cache_time < 300:
        return
    if not _finance_loading:
        t = threading.Thread(target=_load_finance_batch, daemon=True)
        t.start()


def get_stock_finance(code: str) -> dict:
    default = {
        "pe": 0,
        "pb": 0,
        "totalMv": 0,
        "circMv": 0,
        "roe": 0,
        "eps": 0,
        "bps": 0,
        "turnover": 0,
    }
    info = get_stock_info(code)
    eastmoney_data = _fetch_eastmoney_finance(code, info.get("price", 0))
    if eastmoney_data:
        return _finalize_finance_result(default, eastmoney_data, info.get("price", 0))

    _ensure_finance_loaded()
    with _finance_lock:
        data = _finance_cache.get(code)
    if not data:
        data = _fetch_sina_finance_for_code(code)
    if not data:
        return default

    return _finalize_finance_result(default, data, info.get("price", 0))


def _finalize_finance_result(default: dict, data: dict, current_price: float) -> dict:
    result = dict(default)
    result.update(data)

    if not result["eps"] and result["pe"] and current_price:
        result["eps"] = round(current_price / result["pe"], 4)
    if not result["bps"] and result["pb"] and current_price:
        result["bps"] = round(current_price / result["pb"], 4)
    if not result["roe"] and result["eps"] and result["bps"]:
        result["roe"] = round(result["eps"] / result["bps"], 4)

    return result


def _fetch_eastmoney_finance(code: str, current_price: float) -> dict | None:
    cached = _eastmoney_quote_cache.get(code)
    cached_at = _eastmoney_quote_cache_time.get(code, 0)
    if cached and time.time() - cached_at < 60:
        return cached

    secid = _resolve_secid(code)
    if not secid:
        return None

    url = (
        "https://push2.eastmoney.com/api/qt/stock/get"
        f"?secid={secid}"
        "&fields=f57,f58,f116,f117,f162,f167,f168,f173,f187,f188,f192,f193,f194,f195,f196"
    )
    try:
        curl_env = {"PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"}
        curl_env.update(get_original_proxy_env())
        raw = subprocess.run(
            ["curl", "-sL", "--max-time", "15", url],
            capture_output=True,
            text=True,
            check=False,
            env=curl_env,
        ).stdout.strip()
        if not raw:
            return None
        payload = json.loads(raw)
        data = payload.get("data") or {}
        pe = _scale_finance_value(data.get("f162"))
        pb = _scale_finance_value(data.get("f167"))
        roe = _scale_finance_value(data.get("f173")) / 100
        result = {
            "pe": pe,
            "pb": pb,
            "totalMv": _safe_float(data.get("f116")),
            "circMv": _safe_float(data.get("f117")),
            "roe": roe,
            "eps": round(current_price / pe, 4) if pe and current_price else 0,
            "bps": round(current_price / pb, 4) if pb and current_price else 0,
            "turnover": 0,
        }
        _eastmoney_quote_cache[code] = result
        _eastmoney_quote_cache_time[code] = time.time()
        return result
    except Exception as e:
        print(f"[stock] eastmoney finance error for {code}: {e}")
        return None


def _resolve_secid(code: str) -> str:
    if code.startswith("6") or code.startswith("688"):
        return f"1.{code}"
    if code.startswith(("0", "3")):
        return f"0.{code}"
    if code.startswith(("4", "8")):
        return f"0.{code}"
    return ""


def _scale_finance_value(value) -> float:
    raw = _safe_float(value)
    if raw == 0:
        return 0
    if raw >= 100:
        return round(raw / 100, 4)
    return round(raw, 4)


def _fetch_sina_finance_for_code(code: str) -> dict | None:
    global _finance_cache_time
    try:
        for page in range(1, 9):
            url = (
                "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/"
                f"Market_Center.getHQNodeData?page={page}&num=80&sort=changepercent&asc=0&node=hs_a&_s_r_a=auto"
            )
            response = _sina.get(url, timeout=12)
            stocks = json.loads(response.text)
            if not isinstance(stocks, list):
                continue
            for item in stocks:
                current_code = (
                    item.get("code", "")
                    .replace("sh", "")
                    .replace("sz", "")
                    .replace("bj", "")
                )
                if current_code != code:
                    continue
                data = {
                    "pe": _safe_float(item.get("per", 0)),
                    "pb": _safe_float(item.get("pb", 0)),
                    "totalMv": _safe_float(item.get("mktcap", 0)) * 10000,
                    "circMv": _safe_float(item.get("nmc", 0)) * 10000,
                    "roe": 0,
                    "eps": 0,
                    "bps": 0,
                    "turnover": _safe_float(item.get("turnoverratio", 0)),
                }
                with _finance_lock:
                    _finance_cache[code] = data
                    _finance_cache_time = time.time()
                return data
    except Exception as e:
        print(f"[stock] targeted sina finance error for {code}: {e}")
    return None
