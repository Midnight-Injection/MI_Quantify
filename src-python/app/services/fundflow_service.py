import time

from app.services.network_env import create_http_session


_CACHE_TTL_SECONDS = 60
_REQUEST_RETRY_DELAYS = (0.0, 0.5, 1.2)
_FUND_FLOW_URL = "https://push2.eastmoney.com/api/qt/clist/get"
_FUND_FLOW_PARAMS = {
    "fid": "f62",
    "po": "1",
    "pn": "1",
    "np": "1",
    "fltt": "2",
    "invt": "2",
    "ut": "b2884a393a59ad64002292a3e90d46a5",
    "fs": "m:0+t:6+f:!2,m:0+t:13+f:!2,m:0+t:80+f:!2,m:1+t:2+f:!2,m:1+t:23+f:!2,m:0+t:7+f:!2,m:1+t:3+f:!2",
    "fields": "f12,f14,f2,f3,f62,f184,f66,f69,f72,f75,f78,f81,f84,f87",
}
_fund_flow_cache = {"data": [], "updated": 0.0}
_stock_fund_cache: dict[str, tuple[float, list[dict]]] = {}


def _make_session(url: str):
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


def _safe_float(value) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _map_rank_item(item: dict) -> dict:
    return {
        "code": str(item.get("f12", "") or ""),
        "name": str(item.get("f14", "") or ""),
        "mainNetInflow": _safe_float(item.get("f62")),
        "mainNetInflowPercent": _safe_float(item.get("f184")),
        "superLargeNetInflow": _safe_float(item.get("f66")),
        "largeNetInflow": _safe_float(item.get("f72")),
        "mediumNetInflow": _safe_float(item.get("f78")),
        "smallNetInflow": _safe_float(item.get("f84")),
    }


def _request_rank_payload(rank: int) -> list[dict]:
    params = {**_FUND_FLOW_PARAMS, "pz": str(rank)}
    last_error = None

    for delay in _REQUEST_RETRY_DELAYS:
        if delay:
            time.sleep(delay)
        session = _make_session(_FUND_FLOW_URL)
        try:
            resp = session.get(_FUND_FLOW_URL, params=params, timeout=15)
            resp.raise_for_status()
            data = resp.json()
            items = data.get("data", {}).get("diff", [])
            if items:
                return items
        except Exception as error:
            last_error = error
        finally:
            session.close()

    if last_error:
        raise last_error
    return []


def _fetch_eastmoney(rank: int = 50) -> list[dict]:
    items = _request_rank_payload(rank)
    result = [_map_rank_item(item) for item in items if item.get("f12")]
    if result:
        return result
    raise ValueError("eastmoney returned empty fundflow rank")


def _fetch_akshare(rank: int = 50) -> list[dict]:
    import akshare as ak

    result = []
    for indicator in ("今日", "5日", "10日"):
        try:
            df = ak.stock_individual_fund_flow_rank(indicator=indicator)
        except Exception:
            continue
        if df is None or df.empty:
            continue
        for _, row in df.head(rank).iterrows():
            result.append(
                {
                    "code": str(row.get("代码", "") or ""),
                    "name": str(row.get("名称", "") or ""),
                    "mainNetInflow": _safe_float(row.get("主力净流入-净额")),
                    "mainNetInflowPercent": _safe_float(row.get("主力净流入-净占比")),
                    "superLargeNetInflow": _safe_float(row.get("超大户净流入-净额")),
                    "largeNetInflow": _safe_float(row.get("大户净流入-净额")),
                    "mediumNetInflow": _safe_float(row.get("中户净流入-净额")),
                    "smallNetInflow": _safe_float(row.get("散户净流入-净额")),
                }
            )
        if result:
            return result
    return []


def get_fund_flow(rank: int = 50) -> list[dict]:
    if _fund_flow_cache["data"] and (
        time.time() - _fund_flow_cache["updated"] < _CACHE_TTL_SECONDS
    ):
        return list(_fund_flow_cache["data"])[:rank]

    result = []
    errors: list[str] = []
    for loader_name, loader in (
        ("eastmoney", _fetch_eastmoney),
        ("akshare", _fetch_akshare),
    ):
        try:
            result = loader(rank)
        except Exception as error:
            errors.append(f"{loader_name}: {error}")
            print(f"[fundflow] {loader_name} error: {error}")
            continue
        if result:
            break

    if result:
        _fund_flow_cache["data"] = result
        _fund_flow_cache["updated"] = time.time()
        return result[:rank]

    if errors and _fund_flow_cache["data"]:
        print("[fundflow] using stale cache after upstream failures")
    return list(_fund_flow_cache["data"])[:rank]


def get_stock_fund_flow(code: str, days: int = 10) -> list[dict]:
    key = f"{code}_{days}"
    cached = _stock_fund_cache.get(key)
    if cached and (time.time() - cached[0] < _CACHE_TTL_SECONDS):
        return cached[1]

    try:
        import akshare as ak

        market = "sh" if code.startswith(("6", "9")) else "sz"
        df = ak.stock_individual_fund_flow(stock=code, market=market)
        if df is None or df.empty:
            return cached[1] if cached else []

        result = []
        for _, row in df.tail(days).iterrows():
            result.append(
                {
                    "date": str(row.get("日期", "")),
                    "close": _safe_float(row.get("收盘价")),
                    "changePercent": _safe_float(row.get("涨跌幅")),
                    "mainNetInflow": _safe_float(row.get("主力净流入-净额")),
                    "mainNetInflowPercent": _safe_float(row.get("主力净流入-净占比")),
                    "superLargeNetInflow": _safe_float(row.get("超大单净流入-净额")),
                    "superLargeNetInflowPercent": _safe_float(
                        row.get("超大单净流入-净占比")
                    ),
                    "largeNetInflow": _safe_float(row.get("大单净流入-净额")),
                    "largeNetInflowPercent": _safe_float(
                        row.get("大单净流入-净占比")
                    ),
                    "mediumNetInflow": _safe_float(row.get("中单净流入-净额")),
                    "mediumNetInflowPercent": _safe_float(
                        row.get("中单净流入-净占比")
                    ),
                    "smallNetInflow": _safe_float(row.get("小单净流入-净额")),
                    "smallNetInflowPercent": _safe_float(
                        row.get("小单净流入-净占比")
                    ),
                }
            )

        _stock_fund_cache[key] = (time.time(), result)
        return result
    except Exception as error:
        print(f"[fundflow] stock {code} error: {error}")
        return cached[1] if cached else []
