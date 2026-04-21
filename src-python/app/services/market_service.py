import re
import json
import time
import threading
import subprocess
import os
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlencode
from app.services.network_env import clear_proxy_env, create_http_session, get_original_proxy_env

clear_proxy_env()
from typing import Optional

_ad_cache = {
    "data": {"advance": 0, "decline": 0, "flat": 0, "total": 0, "totalAmount": 0},
    "updated": 0,
}
_ad_lock = threading.Lock()
_ad_refresh_interval = 30
_A_SHARE_SNAPSHOT_TTL = 45
_a_share_snapshot_cache = {"data": [], "updated": 0.0, "breadth": None}
_a_share_snapshot_lock = threading.Lock()
_a_share_snapshot_refresh_lock = threading.Lock()
_a_share_code_cache = {"codes": [], "updated": 0.0, "trade_day": ""}
_a_share_code_lock = threading.Lock()
_hk_share_cache: dict[str, dict] = {}
_hk_share_lock = threading.Lock()
_HK_SHARE_CACHE_TTL = 6 * 60 * 60
_EASTMONEY_A_LIST_URL = "https://push2.eastmoney.com/api/qt/clist/get"
_EASTMONEY_A_LIST_FS = "m:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:7+f:!2,m:1+t:3+f:!2"
_EASTMONEY_A_LIST_FIELDS = "f12,f14,f2,f3,f4,f5,f6,f15,f16,f17,f18,f8,f9,f23,f20,f21"
_EASTMONEY_UT = "b2884a393a59ad64002292a3e90d46a5"


def _http_get(url: str, **kwargs):
    return create_http_session(target_url=url).get(url, **kwargs)


def _curl_text(url: str, timeout: int = 15) -> str:
    env = os.environ.copy()
    env.update(get_original_proxy_env())
    env.pop("NO_PROXY", None)
    env.pop("no_proxy", None)
    result = subprocess.run(
        ["curl", "-fsSL", "--max-time", str(timeout), url],
        capture_output=True,
        text=True,
        check=True,
        env=env,
    )
    return result.stdout


def _make_eastmoney_session(url: str):
    session = create_http_session(
        referer="https://data.eastmoney.com/",
        target_url=url,
    )
    session.headers.update(
        {
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Connection": "close",
            "Origin": "https://data.eastmoney.com",
            "X-Requested-With": "XMLHttpRequest",
        }
    )
    return session


def _request_eastmoney_a_page(page: int, page_size: int) -> tuple[int, list[dict]]:
    params = {
        "fid": "f3",
        "po": "1",
        "pn": str(max(1, page)),
        "pz": str(max(1, min(page_size, 500))),
        "np": "1",
        "fltt": "2",
        "invt": "2",
        "ut": _EASTMONEY_UT,
        "fs": _EASTMONEY_A_LIST_FS,
        "fields": _EASTMONEY_A_LIST_FIELDS,
    }
    session = _make_eastmoney_session(_EASTMONEY_A_LIST_URL)
    try:
        try:
            response = session.get(_EASTMONEY_A_LIST_URL, params=params, timeout=15)
            response.raise_for_status()
            payload = response.json()
        except Exception:
            payload = json.loads(_curl_text(f"{_EASTMONEY_A_LIST_URL}?{urlencode(params)}"))
        data = payload.get("data") or {}
        total = int(data.get("total") or 0)
        diff = data.get("diff") or []
        return total, diff if isinstance(diff, list) else []
    finally:
        session.close()


def _map_eastmoney_stock_item(item: dict) -> dict:
    return {
        "code": str(item.get("f12", "") or ""),
        "name": str(item.get("f14", "") or ""),
        "price": _safe_float(item.get("f2")),
        "change": _safe_float(item.get("f4")),
        "changePercent": _safe_float(item.get("f3")),
        "open": _safe_float(item.get("f17")),
        "high": _safe_float(item.get("f15")),
        "low": _safe_float(item.get("f16")),
        "preClose": _safe_float(item.get("f18")),
        "volume": _safe_float(item.get("f5")),
        "amount": _safe_float(item.get("f6")),
        "turnover": _safe_float(item.get("f8")),
        "pe": _safe_float(item.get("f9")),
        "pb": _safe_float(item.get("f23")),
        "totalMv": _safe_float(item.get("f20")),
        "circMv": _safe_float(item.get("f21")),
    }


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
        t = threading.Thread(target=_bg_refresh_advance_decline, daemon=True)
        t.start()


def _parse_sina_line(line: str):
    m = re.search(r'"([^"]*)"', line)
    if not m or not m.group(1):
        return None
    return m.group(1).split(",")


HK_CURATED_UNIVERSE = [
    "00005",
    "00388",
    "00700",
    "00857",
    "00883",
    "00939",
    "00941",
    "00981",
    "00992",
    "01024",
    "01093",
    "01109",
    "01299",
    "01347",
    "01398",
    "01772",
    "01810",
    "02007",
    "02015",
    "02269",
    "02318",
    "02319",
    "02331",
    "02382",
    "02628",
    "03690",
    "03800",
    "03888",
    "06030",
    "06160",
    "06618",
    "06862",
    "09618",
    "09626",
    "09633",
    "09863",
    "09866",
    "09868",
    "09888",
    "09988",
    "09992",
    "09999",
]

US_CURATED_UNIVERSE = [
    "AAPL",
    "ADBE",
    "AMD",
    "AMZN",
    "AVGO",
    "BABA",
    "BIDU",
    "COIN",
    "COST",
    "CRM",
    "CSCO",
    "DIS",
    "GOOGL",
    "HOOD",
    "INTC",
    "JD",
    "KO",
    "LI",
    "MA",
    "META",
    "MCD",
    "MELI",
    "MSFT",
    "NFLX",
    "NIO",
    "NKE",
    "NVDA",
    "ORCL",
    "PDD",
    "PLTR",
    "PYPL",
    "QCOM",
    "SMCI",
    "SOFI",
    "TSLA",
    "TSM",
    "TME",
    "UBER",
    "UNH",
    "V",
    "WMT",
    "XPEV",
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
    r = _http_get(url, timeout=10)
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
    r = _http_get(url, timeout=10)
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
    r = _http_get(url, timeout=10)
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


def _get_recent_trade_day() -> str:
    today = datetime.now().date()
    for offset in range(0, 14):
        current = today - timedelta(days=offset)
        if current.weekday() >= 5:
            continue
        return current.isoformat()
    return today.isoformat()


def _dedupe_codes(codes: list[str]) -> list[str]:
    seen: set[str] = set()
    deduped: list[str] = []
    for code in codes:
        normalized = str(code or "").strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


def _load_a_share_codes_from_eastmoney() -> list[str]:
    page_size = 100
    page = 1
    total = 0
    codes: list[str] = []
    while True:
        page_total, diff = _request_eastmoney_a_page(page, page_size)
        if page == 1:
            total = page_total
        if not diff:
            break
        for item in diff:
            raw_code = str(item.get("f12", "") or "").strip().lower()
            if raw_code.startswith(("6", "0", "3", "4", "8")):
                prefix = "sh" if raw_code.startswith("6") else "sz" if raw_code.startswith(("0", "3")) else "bj"
                codes.append(f"{prefix}{raw_code}")
        if len(codes) >= total:
            break
        page += 1
    return _dedupe_codes(codes)


def _load_a_share_codes_from_akshare() -> list[str]:
    import akshare as ak

    dataset = ak.stock_info_a_code_name()
    if dataset is None or dataset.empty:
        return []

    codes: list[str] = []
    for raw_code in dataset["code"].astype(str).tolist():
        normalized = raw_code.strip().lower()
        if normalized.startswith("6"):
            codes.append(f"sh{normalized}")
        elif normalized.startswith(("0", "3")):
            codes.append(f"sz{normalized}")
        elif normalized.startswith(("4", "8")):
            codes.append(f"bj{normalized}")
    return _dedupe_codes(codes)


def _load_a_share_codes() -> list[str]:
    trade_day = _get_recent_trade_day()
    with _a_share_code_lock:
        cached_codes = list(_a_share_code_cache["codes"])
        cached_day = str(_a_share_code_cache.get("trade_day", "") or "")
        updated_at = float(_a_share_code_cache.get("updated", 0.0) or 0.0)
        if cached_codes and cached_day == trade_day and time.time() - updated_at < 12 * 60 * 60:
            return cached_codes

        codes: list[str] = []
        try:
            import baostock as bs

            login = bs.login()
            if str(login.error_code) == "0":
                try:
                    query = bs.query_all_stock(day=trade_day)
                    if str(query.error_code) == "0":
                        while query.next():
                            row = query.get_row_data()
                            if not row:
                                continue
                            raw_code = str(row[0] or "").strip().lower()
                            if raw_code.startswith("sh.6"):
                                codes.append(raw_code.replace(".", ""))
                            elif raw_code.startswith(("sz.0", "sz.3", "bj.4", "bj.8")):
                                codes.append(raw_code.replace(".", ""))
                finally:
                    try:
                        bs.logout()
                    except Exception:
                        pass
        except Exception:
            pass

        codes = _dedupe_codes(codes)
        if not codes:
            try:
                codes = _load_a_share_codes_from_akshare()
            except Exception:
                codes = []
        if not codes:
            try:
                codes = _load_a_share_codes_from_eastmoney()
            except Exception:
                codes = []

        if not codes:
            if cached_codes:
                return cached_codes
            raise RuntimeError("A 股股票池为空：baostock、akshare 与东方财富兜底均未返回有效代码")

        _a_share_code_cache["codes"] = list(codes)
        _a_share_code_cache["updated"] = time.time()
        _a_share_code_cache["trade_day"] = trade_day
        return codes


def _chunk_codes(values: list[str], size: int = 80) -> list[list[str]]:
    return [values[index:index + size] for index in range(0, len(values), size)]


def _parse_tencent_a_line(line: str) -> Optional[dict]:
    if not line:
        return None
    match = re.search(r'v_(s[hz]|bj)(\d{6})="([^"]*)"', line)
    if not match:
        return None
    code = match.group(2)
    parts = match.group(3).split("~")
    if len(parts) < 47:
        return None
    price = _safe_float(parts[3])
    pre_close = _safe_float(parts[4])
    if price <= 0 or pre_close <= 0:
        return None

    amount = _safe_float(parts[37]) * 10000
    circ_mv = _safe_float(parts[44]) * 100000000
    total_mv = _safe_float(parts[45]) * 100000000
    return {
        "code": code,
        "name": str(parts[1] or "").strip(),
        "price": price,
        "change": _safe_float(parts[31]),
        "changePercent": _safe_float(parts[32]),
        "open": _safe_float(parts[5]),
        "high": _safe_float(parts[33]),
        "low": _safe_float(parts[34]),
        "preClose": pre_close,
        "volume": _safe_float(parts[36]),
        "amount": amount,
        "turnover": _safe_float(parts[38]),
        "pe": _safe_float(parts[39]),
        "pb": _safe_float(parts[46]),
        "totalMv": total_mv,
        "circMv": circ_mv,
        "dateTime": parts[30],
    }


def _fetch_tencent_a_quotes(codes: list[str]) -> list[dict]:
    if not codes:
        return []
    url = f"http://qt.gtimg.cn/q={','.join(codes)}"
    response = create_http_session(referer="http://gu.qq.com", target_url=url).get(url, timeout=20)
    rows = []
    for line in response.text.strip().split("\n"):
        item = _parse_tencent_a_line(line.strip())
        if item:
            rows.append(item)
    return rows


def _build_a_share_snapshot() -> list[dict]:
    now = time.time()
    with _a_share_snapshot_lock:
        cached_data = list(_a_share_snapshot_cache["data"])
        updated_at = float(_a_share_snapshot_cache.get("updated", 0.0) or 0.0)
    if cached_data and now - updated_at < _A_SHARE_SNAPSHOT_TTL:
        return cached_data

    with _a_share_snapshot_refresh_lock:
        with _a_share_snapshot_lock:
            cached_data = list(_a_share_snapshot_cache["data"])
            updated_at = float(_a_share_snapshot_cache.get("updated", 0.0) or 0.0)
        if cached_data and time.time() - updated_at < _A_SHARE_SNAPSHOT_TTL:
            return cached_data

        codes = _load_a_share_codes()
        chunks = _chunk_codes(codes, 80)
        results: list[dict] = []

        with ThreadPoolExecutor(max_workers=min(12, max(1, len(chunks)))) as executor:
            futures = {executor.submit(_fetch_tencent_a_quotes, chunk): index for index, chunk in enumerate(chunks)}
            for future in as_completed(futures):
                results.extend(future.result())

        if not results:
            raise RuntimeError("腾讯行情未返回 A 股实时快照")

        results.sort(
            key=lambda item: (
                item.get("changePercent", 0),
                item.get("amount", 0),
                item.get("volume", 0),
            ),
            reverse=True,
        )

        advance = sum(1 for item in results if item.get("changePercent", 0) > 0)
        decline = sum(1 for item in results if item.get("changePercent", 0) < 0)
        total = len(results)
        breadth = {
            "advance": advance,
            "decline": decline,
            "flat": max(0, total - advance - decline),
            "total": total,
            "totalAmount": round(sum(_safe_float(item.get("amount", 0)) for item in results), 2),
        }

        with _a_share_snapshot_lock:
            _a_share_snapshot_cache["data"] = list(results)
            _a_share_snapshot_cache["updated"] = time.time()
            _a_share_snapshot_cache["breadth"] = dict(breadth)
        return results


def get_advance_decline() -> dict:
    return _compute_advance_decline()


_AD_COMPUTE_TIMEOUT = 60


def _compute_advance_decline() -> dict:
    snapshot = _build_a_share_snapshot()
    with _a_share_snapshot_lock:
        breadth = dict(_a_share_snapshot_cache.get("breadth") or {})
    if breadth:
        with _ad_lock:
            _ad_cache["data"] = dict(breadth)
            _ad_cache["updated"] = time.time()
        return breadth
    if not snapshot:
        raise RuntimeError("A 股实时快照为空，无法计算涨跌家数")
    raise RuntimeError("A 股涨跌家数计算失败")


# ─── Realtime Stock Quotes ───


def get_realtime_quotes(codes: list[str]) -> list[dict]:
    if not codes:
        return []
    try:
        fetched_at = int(time.time() * 1000)
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
        r = _http_get(url, timeout=10)
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
            quote = _parse_quote_line(sc, code, parts, market, fetched_at)
            if quote:
                result.append(quote)
        if has_hk_codes:
            result = _enrich_hk_quotes(result)
        return result
    except Exception as e:
        print(f"[market] error fetching quotes: {e}")
        return []


def get_stock_list(market: str = "a", page: int = 1, page_size: int = 50) -> dict:
    if market == "a":
        return _get_a_stock_list_sina(page, page_size)
    if market == "hk":
        return _get_hk_stock_list(page, page_size)
    if market == "us":
        return _get_us_stock_list(page, page_size)
    raise RuntimeError(f"unsupported market: {market}")


def _get_a_stock_list_sina(page: int, page_size: int) -> dict:
    snapshot = _build_a_share_snapshot()
    total = len(snapshot)
    if total == 0:
        raise RuntimeError("A 股实时股票池为空")
    start = max(0, page - 1) * page_size
    end = start + page_size
    return {"data": snapshot[start:end], "total": total, "page": page}


def _get_hk_stock_list(page: int, page_size: int) -> dict:
    return _get_curated_market_list("hk", HK_CURATED_UNIVERSE, page, page_size)


def _get_us_stock_list(page: int, page_size: int) -> dict:
    return _get_curated_market_list("us", US_CURATED_UNIVERSE, page, page_size)


def search_stocks(keyword: str, limit: int = 8, with_quotes: bool = True) -> list[dict]:
    if not keyword:
        return []
    try:
        url = f"https://suggest3.sinajs.cn/suggest/type=11,31,41&key={keyword}"
        r = _http_get(url, timeout=10)
        m = re.search(r'"([^"]*)"', r.text)
        if not m or not m.group(1):
            return []
        items = m.group(1).split(";")
        result = []
        scored_items = []
        suggest_map = {}
        normalized_keyword = str(keyword).strip().upper()
        for item in items[: max(8, min(int(limit or 8), 20))]:
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
            if len(codes_to_fetch) >= max(1, min(int(limit or 8), 10)):
                break

        if not with_quotes:
            return [
                {
                    "code": code,
                    "name": suggest_map.get(code, ""),
                }
                for code in codes_to_fetch
            ]

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


def _parse_quote_line(
    sina_code: str, code: str, parts: list[str], market: str, fetched_at: int
) -> Optional[dict]:
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
        change_percent = (
            _safe_float(parts[8])
            if len(parts) > 8
            else ((change / prev_close * 100) if prev_close else 0)
        )
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
            "timestamp": fetched_at,
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
            "turnover": round((volume / shares_outstanding) * 100, 2)
            if shares_outstanding
            else 0,
            "timestamp": fetched_at,
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
        "turnover": 0,
        "timestamp": fetched_at,
    }


def _get_curated_market_list(
    market: str, universe: list[str], page: int, page_size: int
) -> dict:
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
        response = _http_get(url, timeout=10)
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
            futures = {
                executor.submit(_get_hk_share_count, code): code for code in need_fetch
            }
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
            turnover = (
                round((volume / shares) * 100, 2) if shares else item.get("turnover", 0)
            )
            total_mv = (
                round(price * shares, 2) if shares and price else item.get("totalMv", 0)
            )
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

    if market_type == "41" and (
        "ADR" in normalized_name or normalized_code.endswith("F")
    ):
        score -= 18

    return score
