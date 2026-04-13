import re
import json
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from app.services.network_env import clear_proxy_env, create_http_session

clear_proxy_env()
from typing import Optional

_sina = create_http_session()

_ad_cache = {
    "data": {"advance": 0, "decline": 0, "flat": 0, "total": 0, "totalAmount": 0},
    "updated": 0,
}
_ad_lock = threading.Lock()
_ad_refresh_interval = 30
_hk_share_cache: dict[str, dict] = {}
_hk_share_lock = threading.Lock()
_HK_SHARE_CACHE_TTL = 6 * 60 * 60


def _bg_refresh_advance_decline():
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
    global _threading_started
    if not _threading_started:
        _threading_started = True
        try:
            data = _compute_advance_decline()
            with _ad_lock:
                _ad_cache["data"] = data
                _ad_cache["updated"] = time.time()
        except Exception as e:
            print(f"[market] initial advance/decline error: {e}")
        t = threading.Thread(target=_bg_refresh_advance_decline, daemon=True)
        t.start()


def _parse_sina_line(line: str):
    m = re.search(r'"([^"]*)"', line)
    if not m or not m.group(1):
        return None
    return m.group(1).split(",")


HK_CURATED_UNIVERSE = [
    "00005", "00388", "00700", "00857", "00883", "00939", "00941", "00981", "00992", "01024",
    "01093", "01109", "01299", "01347", "01398", "01772", "01810", "02007", "02015", "02269",
    "02318", "02319", "02331", "02382", "02628", "03690", "03800", "03888", "06030", "06160",
    "06618", "06862", "09618", "09626", "09633", "09863", "09866", "09868", "09888", "09988",
    "09992", "09999",
]

US_CURATED_UNIVERSE = [
    "AAPL", "ADBE", "AMD", "AMZN", "AVGO", "BABA", "BIDU", "COIN", "COST", "CRM",
    "CSCO", "DIS", "GOOGL", "HOOD", "INTC", "JD", "KO", "LI", "MA", "META",
    "MCD", "MELI", "MSFT", "NFLX", "NIO", "NKE", "NVDA", "ORCL", "PDD", "PLTR",
    "PYPL", "QCOM", "SMCI", "SOFI", "TSLA", "TSM", "TME", "UBER", "UNH", "V",
    "WMT", "XPEV",
]


# ─── Market Indices ───

A_INDEX_CODES = {
    "s_sh000001": ("000001", "上证指数"),
    "s_sz399001": ("399001", "深证成指"),
    "s_sz399006": ("399006", "创业板指"),
    "s_sh000688": ("000688", "科创50"),
    "s_sh000016": ("000016", "上证50"),
    "s_sz399005": ("399005", "中小100"),
    "s_sh000300": ("000300", "沪深300"),
    "s_sz399673": ("399673", "科创100"),
    "s_sz399905": ("399905", "中证500"),
    "s_sz399906": ("399906", "中证800"),
    "s_sz399903": ("399903", "中证1000"),
    "s_sh000852": ("000852", "中证2000"),
}

HK_INDEX_CODES = {
    "rt_hkHSI": ("HSI", "恒生指数"),
    "rt_hkHSCEI": ("HSCEI", "国企指数"),
    "rt_hkHSTECH": ("HSTECH", "科技指数"),
    "rt_hkHKGEM": ("HKGEM", "创业板"),
    "rt_hkHKHSCDI": ("HSCDI", "红筹指数"),
    "rt_hkHKHSFI": ("HSFI", "金融分类"),
    "rt_hkHKHSPI": ("HSPI", "地产分类"),
    "rt_hkHKHSCI": ("HSCI", "综合指数"),
}

US_INDEX_CODES = {
    "int_dji": (".DJI", "道琼斯"),
    "int_nasdaq": (".IXIC", "纳斯达克"),
    "int_sp500": (".INX", "标普500"),
    "int_nasdaq100": (".NDX", "纳斯达克100"),
    "int_russell2000": (".RUT", "罗素2000"),
    "int_phlxSemiconductor": (".SOX", "费城半导体"),
    "int_ftse": (".FTSE", "富时100"),
    "int_dax30": (".GDAXI", "德国DAX"),
}


def get_market_indices(market: str = "a") -> list[dict]:
    try:
        if market == "a":
            return _get_a_indices()
        elif market == "hk":
            return _get_hk_indices()
        elif market == "us":
            return _get_us_indices()
        return []
    except Exception as e:
        print(f"[market] error fetching indices: {e}")
        return []


def _get_a_indices() -> list[dict]:
    keys = list(A_INDEX_CODES.keys())
    url = f"https://hq.sinajs.cn/list={','.join(keys)}"
    r = _sina.get(url, timeout=10)
    result = []
    for line in r.text.strip().split("\n"):
        m = re.search(r"var hq_str_(\S+?)=", line)
        if not m:
            continue
        sina_key = m.group(1)
        if sina_key not in A_INDEX_CODES:
            continue
        code, name = A_INDEX_CODES[sina_key]
        parts = _parse_sina_line(line)
        if not parts:
            continue
        result.append(
            {
                "code": code,
                "name": name,
                "price": float(parts[1]) if len(parts) > 1 else 0,
                "change": float(parts[2]) if len(parts) > 2 else 0,
                "changePercent": float(parts[3]) if len(parts) > 3 else 0,
                "volume": float(parts[4]) * 100 if len(parts) > 4 else 0,
                "amount": float(parts[5]) * 10000 if len(parts) > 5 else 0,
            }
        )
    return result


def _get_hk_indices() -> list[dict]:
    url = f"https://hq.sinajs.cn/list={','.join(HK_INDEX_CODES.keys())}"
    r = _sina.get(url, timeout=10)
    result = []
    for line in r.text.strip().split("\n"):
        for key, (code, name) in HK_INDEX_CODES.items():
            if key in line:
                parts = _parse_sina_line(line)
                if not parts:
                    continue
                price = float(parts[2]) if len(parts) > 2 else 0
                prev = float(parts[3]) if len(parts) > 3 else 0
                chg = price - prev if prev else 0
                result.append(
                    {
                        "code": code,
                        "name": name,
                        "price": price,
                        "change": round(chg, 2),
                        "changePercent": round(chg / prev * 100, 2) if prev else 0,
                        "volume": float(parts[12]) if len(parts) > 12 else 0,
                        "amount": float(parts[11]) * 10000 if len(parts) > 11 else 0,
                    }
                )
                break
    return result


def _get_us_indices() -> list[dict]:
    url = f"https://hq.sinajs.cn/list={','.join(US_INDEX_CODES.keys())}"
    r = _sina.get(url, timeout=10)
    result = []
    for line in r.text.strip().split("\n"):
        for key, (code, name) in US_INDEX_CODES.items():
            if key in line:
                parts = _parse_sina_line(line)
                if not parts:
                    continue
                result.append(
                    {
                        "code": code,
                        "name": name,
                        "price": float(parts[1]) if len(parts) > 1 else 0,
                        "change": float(parts[4]) if len(parts) > 4 else 0,
                        "changePercent": float(parts[5]) if len(parts) > 5 else 0,
                        "volume": 0,
                        "amount": 0,
                    }
                )
                break
    return result


# ─── Advance/Decline Stats ───


def get_advance_decline() -> dict:
    with _ad_lock:
        return dict(_ad_cache["data"])


def _compute_advance_decline() -> dict:
    default = {"advance": 0, "decline": 0, "flat": 0, "total": 0, "totalAmount": 0}
    try:
        total_url = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=hs_a&symbol="
        tr = _sina.get(total_url, timeout=10)
        total = (
            int(tr.text.strip().strip('"'))
            if tr.text.strip().strip('"').isdigit()
            else 0
        )

        advance = 0
        decline = 0
        flat = 0
        total_amount = 0.0
        counted = 0

        pages = max(1, (total + 79) // 80)
        pages = min(pages, 70)
        for p in range(1, pages + 1):
            url = f"https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page={p}&num=80&sort=changepercent&asc=0&node=hs_a&symbol=&_s_r_a=auto"
            try:
                r = _sina.get(url, timeout=15)
                if r.status_code != 200 or not r.text.strip():
                    continue
                stocks = json.loads(r.text)
                if not isinstance(stocks, list):
                    continue
                for s in stocks:
                    pct = _safe_float(s.get("changepercent", 0))
                    if pct > 0:
                        advance += 1
                    elif pct < 0:
                        decline += 1
                    else:
                        flat += 1
                    total_amount += _safe_float(s.get("amount", 0))
                    counted += 1
            except Exception:
                continue

        if counted == 0:
            return default

        return {
            "advance": advance,
            "decline": decline,
            "flat": flat,
            "total": total or counted,
            "totalAmount": round(total_amount, 2),
        }
    except Exception as e:
        print(f"[market] error computing advance/decline: {e}")
        return default


# ─── Realtime Stock Quotes ───


def get_realtime_quotes(codes: list[str]) -> list[dict]:
    if not codes:
        return []
    try:
        sina_codes = []
        code_map = {}
        has_hk_codes = False
        for c in codes:
            sc = _to_sina_symbol(c)
            sina_codes.append(sc)
            code_map[sc] = c
            if _infer_market_from_code(c) == "hk":
                has_hk_codes = True

        url = f"https://hq.sinajs.cn/list={','.join(sina_codes)}"
        r = _sina.get(url, timeout=10)
        result = []
        for line in r.text.strip().split("\n"):
            m = re.search(r"var hq_str_(\S+?)=", line)
            if not m:
                continue
            sc = m.group(1)
            parts = _parse_sina_line(line)
            if not parts:
                continue
            code = code_map.get(sc, sc)
            market = _infer_market_from_code(code)
            quote = _parse_quote_line(sc, code, parts, market)
            if quote:
                result.append(quote)
        if has_hk_codes:
            result = _enrich_hk_quotes(result)
        return result
    except Exception as e:
        print(f"[market] error fetching quotes: {e}")
        return []


def get_stock_list(market: str = "a", page: int = 1, page_size: int = 50) -> dict:
    try:
        if market == "a":
            return _get_a_stock_list_sina(page, page_size)
        elif market == "hk":
            return _get_hk_stock_list(page, page_size)
        elif market == "us":
            return _get_us_stock_list(page, page_size)
        return {"data": [], "total": 0, "page": page}
    except Exception as e:
        print(f"[market] error fetching stock list: {e}")
        return {"data": [], "total": 0, "page": page}


def _get_a_stock_list_sina(page: int, page_size: int) -> dict:
    try:
        num = page_size
        url = f"https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page={page}&num={num}&sort=changepercent&asc=0&node=hs_a&symbol=&_s_r_a=auto"
        r = _sina.get(url, timeout=15)
        if r.status_code != 200 or not r.text.strip():
            return {"data": [], "total": 0, "page": page}
        try:
            stocks = json.loads(r.text)
        except (json.JSONDecodeError, ValueError):
            print(f"[market] stock list response not JSON: {r.text[:200]}")
            return {"data": [], "total": 0, "page": page}

        if not isinstance(stocks, list):
            return {"data": [], "total": 0, "page": page}

        total_url = "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=hs_a&symbol="
        try:
            tr = _sina.get(total_url, timeout=10)
            raw = tr.text.strip().strip('"')
            total = int(raw) if raw.isdigit() else len(stocks)
        except Exception:
            total = len(stocks)

        result = []
        for s in stocks:
            result.append(
                {
                    "code": s.get("code", "")
                    or s.get("symbol", "")
                    .replace("sh", "")
                    .replace("sz", "")
                    .replace("bj", ""),
                    "name": s.get("name", ""),
                    "price": _safe_float(s.get("trade", 0)),
                    "change": _safe_float(s.get("pricechange", 0)),
                    "changePercent": _safe_float(s.get("changepercent", 0)),
                    "open": _safe_float(s.get("open", 0)),
                    "high": _safe_float(s.get("high", 0)),
                    "low": _safe_float(s.get("low", 0)),
                    "preClose": _safe_float(s.get("settlement", 0)),
                    "volume": _safe_float(s.get("volume", 0)),
                    "amount": _safe_float(s.get("amount", 0)),
                    "turnover": _safe_float(s.get("turnoverratio", 0)),
                    "pe": _safe_float(s.get("per", 0)),
                    "pb": _safe_float(s.get("pb", 0)),
                    "totalMv": _safe_float(s.get("mktcap", 0)) * 10000,
                    "circMv": _safe_float(s.get("nmc", 0)) * 10000,
                }
            )
        return {"data": result, "total": total, "page": page}
    except Exception as e:
        print(f"[market] error fetching A stock list: {e}")
        return {"data": [], "total": 0, "page": page}


def _get_hk_stock_list(page: int, page_size: int) -> dict:
    return _get_curated_market_list("hk", HK_CURATED_UNIVERSE, page, page_size)


def _get_us_stock_list(page: int, page_size: int) -> dict:
    return _get_curated_market_list("us", US_CURATED_UNIVERSE, page, page_size)


def search_stocks(keyword: str) -> list[dict]:
    if not keyword:
        return []
    try:
        url = f"https://suggest3.sinajs.cn/suggest/type=11,31,41&key={keyword}"
        r = _sina.get(url, timeout=10)
        m = re.search(r'"([^"]*)"', r.text)
        if not m or not m.group(1):
            return []
        items = m.group(1).split(";")
        result = []
        scored_items = []
        suggest_map = {}
        normalized_keyword = str(keyword).strip().upper()
        for item in items[:20]:
            parts = item.split(",")
            if len(parts) >= 6:
                market_type = parts[1]
                raw_code = (parts[3] or parts[2] or "").strip()
                code = _normalize_suggest_code(market_type, raw_code)
                if not code:
                    continue
                name = parts[4] or parts[0]
                suggest_map[code] = name
                score = _score_suggest_item(normalized_keyword, market_type, code, name)
                scored_items.append((score, code))

        seen_codes = set()
        codes_to_fetch = []
        for _, code in sorted(scored_items, key=lambda item: item[0], reverse=True):
            if code in seen_codes:
                continue
            seen_codes.add(code)
            codes_to_fetch.append(code)

        if codes_to_fetch:
            quotes = get_realtime_quotes(codes_to_fetch)
            quote_map = {q["code"]: q for q in quotes}
            for code in codes_to_fetch:
                q = quote_map.get(code)
                if q:
                    result.append(q)
                else:
                    result.append(
                        {
                            "code": code,
                            "name": suggest_map.get(code, ""),
                            "price": 0,
                            "change": 0,
                            "changePercent": 0,
                            "volume": 0,
                            "amount": 0,
                        }
                    )
        return result
    except Exception as e:
        print(f"[market] error searching stocks: {e}")
        return []


def _safe_float(val) -> float:
    try:
        if val is None or val == "" or val == "-":
            return 0
        return float(val)
    except (ValueError, TypeError):
        return 0


def _infer_market_from_code(code: str) -> str:
    raw = str(code or "").strip().upper()
    if re.fullmatch(r"\d{5}", raw):
        return "hk"
    if re.fullmatch(r"\d{6}", raw):
        if raw.startswith(("6", "0", "3", "4", "8")):
            return "a"
        return "hk"
    return "us"


def _to_sina_symbol(code: str) -> str:
    raw = str(code or "").strip()
    market = _infer_market_from_code(raw)
    if market == "a":
        if raw.startswith("6"):
            return f"sh{raw}"
        if raw.startswith(("0", "3")):
            return f"sz{raw}"
        if raw.startswith(("4", "8")):
            return f"bj{raw}"
    elif market == "hk":
        return f"rt_hk{raw.zfill(5)}"
    return f"gb_{raw.lower()}"


def _parse_quote_line(sina_code: str, code: str, parts: list[str], market: str) -> Optional[dict]:
    if market == "hk":
        if len(parts) < 13:
            return None
        name = parts[1] or parts[0]
        price = _safe_float(parts[6])
        prev_close = _safe_float(parts[3])
        open_p = _safe_float(parts[2])
        high = _safe_float(parts[4])
        low = _safe_float(parts[5])
        change = _safe_float(parts[7]) if len(parts) > 7 else price - prev_close
        change_percent = _safe_float(parts[8]) if len(parts) > 8 else ((change / prev_close * 100) if prev_close else 0)
        volume = _safe_float(parts[12])
        amount = _safe_float(parts[11])
        return {
            "code": str(code).upper().zfill(5),
            "name": name,
            "price": price,
            "change": round(change, 2),
            "changePercent": round(change_percent, 2),
            "open": open_p,
            "high": high,
            "low": low,
            "close": price,
            "preClose": prev_close,
            "volume": volume,
            "amount": amount,
            "turnover": 0,
            "timestamp": 0,
            "pe": _safe_float(parts[13]) if len(parts) > 13 else 0,
            "pb": 0,
            "totalMv": 0,
            "circMv": 0,
        }

    if market == "us":
        if len(parts) < 13:
            return None
        price = _safe_float(parts[1])
        change = _safe_float(parts[4]) if len(parts) > 4 else _safe_float(parts[2])
        change_percent = _safe_float(parts[2])
        open_p = _safe_float(parts[5]) if len(parts) > 5 else 0
        high = _safe_float(parts[6]) if len(parts) > 6 else 0
        low = _safe_float(parts[7]) if len(parts) > 7 else 0
        prev_close = round(price - change, 4) if price or change else 0
        volume = _safe_float(parts[10]) if len(parts) > 10 else 0
        total_mv = _safe_float(parts[12]) if len(parts) > 12 else 0
        shares_outstanding = _safe_float(parts[20]) if len(parts) > 20 else 0
        amount = round(volume * price, 2) if volume and price else 0
        return {
            "code": str(code).upper(),
            "name": parts[0],
            "price": price,
            "change": round(change, 2),
            "changePercent": round(change_percent, 2),
            "open": open_p,
            "high": high,
            "low": low,
            "close": price,
            "preClose": prev_close,
            "volume": volume,
            "amount": amount,
            "turnover": round((volume / shares_outstanding) * 100, 2) if shares_outstanding else 0,
            "timestamp": 0,
            "pe": _safe_float(parts[14]) if len(parts) > 14 else 0,
            "pb": 0,
            "totalMv": total_mv,
            "circMv": total_mv,
        }

    if len(parts) < 32:
        return None
    name = parts[0]
    open_p = _safe_float(parts[1])
    prev_close = _safe_float(parts[2])
    price = _safe_float(parts[3])
    high = _safe_float(parts[4])
    low = _safe_float(parts[5])
    change = price - prev_close if prev_close else 0
    change_percent = (change / prev_close * 100) if prev_close else 0
    volume = _safe_float(parts[8])
    amount = _safe_float(parts[9])
    return {
        "code": str(code),
        "name": name,
        "price": price,
        "change": round(change, 2),
        "changePercent": round(change_percent, 2),
        "open": open_p,
        "high": high,
        "low": low,
        "close": price,
        "preClose": prev_close,
        "volume": volume,
        "amount": amount,
        "turnover": _safe_float(parts[10]) if len(parts) > 10 else 0,
        "timestamp": 0,
    }


def _get_curated_market_list(market: str, universe: list[str], page: int, page_size: int) -> dict:
    quotes = get_realtime_quotes(universe)
    if market == "hk":
        quotes = [{**item, "code": str(item["code"]).zfill(5)} for item in quotes]
    sorted_quotes = sorted(
        quotes,
        key=lambda item: (
            item.get("changePercent", 0),
            item.get("amount", 0),
            item.get("volume", 0),
        ),
        reverse=True,
    )
    start = max(page - 1, 0) * page_size
    end = start + page_size
    return {
        "data": sorted_quotes[start:end],
        "total": len(sorted_quotes),
        "page": page,
    }


def _extract_hk_shares(html: str) -> int:
    match = re.search(r"港股股份数目</span></td>\s*<td>([\d,]+)\(股\)</td>", html)
    if not match:
        match = re.search(r"港股股份数目</span></td>\s*<td>([\d,]+)</td>", html)
    if not match:
        return 0
    return int(match.group(1).replace(",", ""))


def _get_hk_share_count(code: str) -> int:
    normalized = str(code or "").zfill(5)
    now = time.time()
    with _hk_share_lock:
        cached = _hk_share_cache.get(normalized)
        if cached and now - cached.get("updated", 0) < _HK_SHARE_CACHE_TTL:
            return int(cached.get("shares", 0))

    try:
        url = f"https://stock.finance.sina.com.cn/hkstock/info/{normalized}.html"
        response = _sina.get(url, timeout=10)
        shares = _extract_hk_shares(response.text)
    except Exception as exc:
        print(f"[market] error fetching HK share count for {normalized}: {exc}")
        shares = 0

    with _hk_share_lock:
        _hk_share_cache[normalized] = {"shares": shares, "updated": now}
    return shares


def _enrich_hk_quotes(quotes: list[dict]) -> list[dict]:
    if not quotes:
        return quotes

    need_fetch = []
    now = time.time()
    with _hk_share_lock:
        for item in quotes:
            raw_code = str(item.get("code", ""))
            if _infer_market_from_code(raw_code) != "hk":
                continue
            code = raw_code.zfill(5)
            cached = _hk_share_cache.get(code)
            if not cached or now - cached.get("updated", 0) >= _HK_SHARE_CACHE_TTL:
                need_fetch.append(code)

    if need_fetch:
        with ThreadPoolExecutor(max_workers=min(8, len(need_fetch))) as executor:
            futures = {executor.submit(_get_hk_share_count, code): code for code in need_fetch}
            for future in as_completed(futures):
                try:
                    future.result()
                except Exception as exc:
                    code = futures[future]
                    print(f"[market] error enriching HK quote {code}: {exc}")

    enriched = []
    with _hk_share_lock:
        for item in quotes:
            raw_code = str(item.get("code", ""))
            if _infer_market_from_code(raw_code) != "hk":
                enriched.append(item)
                continue
            code = raw_code.zfill(5)
            shares = int(_hk_share_cache.get(code, {}).get("shares", 0))
            volume = _safe_float(item.get("volume", 0))
            price = _safe_float(item.get("price", 0))
            turnover = round((volume / shares) * 100, 2) if shares else item.get("turnover", 0)
            total_mv = round(price * shares, 2) if shares and price else item.get("totalMv", 0)
            enriched.append(
                {
                    **item,
                    "code": code,
                    "turnover": turnover,
                    "totalMv": total_mv,
                    "circMv": total_mv,
                }
            )
    return enriched


def _normalize_suggest_code(market_type: str, raw_code: str) -> str:
    code = str(raw_code or "").strip()
    if not code:
        return ""
    if market_type == "11":
        return code.replace("sh", "").replace("sz", "").replace("bj", "")
    if market_type == "31":
        digits = re.sub(r"\D", "", code)
        return digits.zfill(5) if digits else ""
    if market_type == "41":
        return code.upper()
    return ""


def _score_suggest_item(keyword: str, market_type: str, code: str, name: str) -> int:
    normalized_code = str(code or "").upper()
    normalized_name = str(name or "").upper()
    score = {
        "11": 30,
        "31": 40,
        "41": 20,
    }.get(market_type, 0)

    if normalized_code == keyword:
        score += 120
    elif normalized_code.startswith(keyword):
        score += 35

    if normalized_name == keyword:
        score += 100
    elif keyword and keyword in normalized_name:
        score += 70

    if market_type == "41" and ("ADR" in normalized_name or normalized_code.endswith("F")):
        score -= 18

    return score
