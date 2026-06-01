import json
import time
from app.services.network_env import create_http_session

_CACHE_TTL_SECONDS = 60
_industry_cache = {"data": [], "updated": 0.0}
_concept_cache = {"data": [], "updated": 0.0}
_member_cache: dict[str, dict] = {}

_INDUSTRY_URL = "https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php"
_CONCEPT_URL = "https://money.finance.sina.com.cn/q/view/newFLJK.php?param=class"


def _http_get(url: str, referer: str = "https://finance.sina.com.cn", proxy_id: str | None = None, **kwargs):
    return create_http_session(referer=referer, target_url=url, proxy_id=proxy_id).get(url, **kwargs)


def _cache_valid(cache: dict) -> bool:
    return bool(cache["data"]) and (time.time() - cache["updated"] < _CACHE_TTL_SECONDS)


def _parse_sector_payload(text: str) -> dict:
    start = text.find("{")
    if start < 0:
        return {}
    return json.loads(text[start:])


def _safe_float(value) -> float:
    import math
    try:
        if value in (None, "", "-"):
            return 0.0
        v = float(value)
        if math.isnan(v) or math.isinf(v):
            return 0.0
        return v
    except (TypeError, ValueError):
        return 0.0


def _build_sector_item(value: str) -> dict:
    parts = value.split(",")
    code = parts[0] if len(parts) > 0 else ""
    name = parts[1] if len(parts) > 1 else ""
    company_count = int(float(parts[2])) if len(parts) > 2 and parts[2] else 0
    average_price = float(parts[3]) if len(parts) > 3 and parts[3] else 0
    change = float(parts[4]) if len(parts) > 4 and parts[4] else 0
    change_percent = float(parts[5]) if len(parts) > 5 and parts[5] else 0
    volume = float(parts[6]) if len(parts) > 6 and parts[6] else 0
    amount = float(parts[7]) if len(parts) > 7 and parts[7] else 0
    leading_code = parts[8].replace("sh", "").replace("sz", "").replace("bj", "") if len(parts) > 8 else ""
    leading_stock = parts[12] if len(parts) > 12 else ""
    return {
        "code": code,
        "name": name,
        "change": change,
        "changePercent": change_percent,
        "companyCount": company_count,
        "averagePrice": average_price,
        "leadingCode": leading_code,
        "leadingStock": leading_stock,
        "volume": volume,
        "amount": amount,
    }


def _fetch_sector_rank(url: str, cache: dict) -> list[dict]:
    if _cache_valid(cache):
        return list(cache["data"])
    try:
        response = _http_get(url, timeout=12)
        response.raise_for_status()
        payload = _parse_sector_payload(response.text)
        result = [_build_sector_item(value) for value in payload.values()]
        result = [item for item in result if item["name"]]
        result.sort(key=lambda item: item["changePercent"], reverse=True)
        data = result
        cache["data"] = data
        cache["updated"] = time.time()
        return data
    except Exception as exc:
        print(f"[sector] error fetching sector rank: {exc}")
        return list(cache["data"])


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
    mapping = {"daily": "日k", "weekly": "周k", "monthly": "月k"}
    return mapping.get(period, "日k")


def _normalize_adjust(adjust: str) -> str:
    if adjust in ("qfq", "hfq"):
        return adjust
    return ""


def get_industry_kline(
    name: str,
    period: str = "daily",
    adjust: str = "qfq",
) -> list[dict]:
    try:
        import akshare as ak
        ak_period = _normalize_period(period)
        ak_adjust = _normalize_adjust(adjust)
        df = ak.stock_board_industry_hist_em(
            symbol=name,
            period=ak_period,
            adjust=ak_adjust,
            start_date="20240101",
            end_date="20991231",
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
        return result
    except Exception as e:
        print(f"[sector] industry kline error for {name}: {e}")
        return []


def get_concept_kline(
    name: str,
    period: str = "daily",
    adjust: str = "qfq",
) -> list[dict]:
    try:
        import akshare as ak
        ak_period = _normalize_period(period)
        ak_adjust = _normalize_adjust(adjust)
        df = ak.stock_board_concept_hist_em(
            symbol=name,
            period=ak_period,
            adjust=ak_adjust,
            start_date="20240101",
            end_date="20991231",
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
        return result
    except Exception as e:
        print(f"[sector] concept kline error for {name}: {e}")
        return []


_sector_fund_flow_cache: dict[str, tuple[float, list[dict]]] = {}


def get_sector_fund_flow(
    indicator: str = "今日",
    sector_type: str = "行业资金流",
) -> list[dict]:
    cache_key = f"{indicator}_{sector_type}"
    cached = _sector_fund_flow_cache.get(cache_key)
    if cached and (time.time() - cached[0] < _CACHE_TTL_SECONDS):
        return cached[1]

    try:
        import akshare as ak
        df = ak.stock_sector_fund_flow_rank(
            indicator=indicator,
            sector_type=sector_type,
        )
        if df is None or df.empty:
            return cached[1] if cached else []
        result = []
        for _, row in df.iterrows():
            result.append({
                "name": str(row.get("名称", "")),
                "change": _safe_float(row.get("涨跌幅")),
                "mainNetInflow": _safe_float(row.get("主力净流入-净额")),
                "mainNetInflowPercent": _safe_float(row.get("主力净流入-净占比")),
                "superLargeNetInflow": _safe_float(row.get("超大单净流入-净额")),
                "superLargeNetInflowPercent": _safe_float(row.get("超大单净流入-净占比")),
                "largeNetInflow": _safe_float(row.get("大单净流入-净额")),
                "largeNetInflowPercent": _safe_float(row.get("大单净流入-净占比")),
                "mediumNetInflow": _safe_float(row.get("中单净流入-净额")),
                "mediumNetInflowPercent": _safe_float(row.get("中单净流入-净占比")),
                "smallNetInflow": _safe_float(row.get("小单净流入-净额")),
                "smallNetInflowPercent": _safe_float(row.get("小单净流入-净占比")),
                "netInflow": _safe_float(row.get("净流入")),
            })
        _sector_fund_flow_cache[cache_key] = (time.time(), result)
        return result
    except Exception as e:
        print(f"[sector] fund flow error: {e}")
        return cached[1] if cached else []


def get_sector_rank(indicator: str = "涨跌幅") -> list[dict]:
    data = _fetch_sector_rank(_INDUSTRY_URL, _industry_cache)
    if indicator == "涨跌幅":
        return data
    return list(data)


def get_concept_rank() -> list[dict]:
    return _fetch_sector_rank(_CONCEPT_URL, _concept_cache)


def _build_member_item(raw: dict) -> dict:
    return {
        "code": raw.get("code", "")
        or raw.get("symbol", "").replace("sh", "").replace("sz", "").replace("bj", ""),
        "name": raw.get("name", ""),
        "price": _safe_float(raw.get("trade", 0)),
        "change": _safe_float(raw.get("pricechange", 0)),
        "changePercent": _safe_float(raw.get("changepercent", 0)),
        "open": _safe_float(raw.get("open", 0)),
        "high": _safe_float(raw.get("high", 0)),
        "low": _safe_float(raw.get("low", 0)),
        "preClose": _safe_float(raw.get("settlement", 0)),
        "volume": _safe_float(raw.get("volume", 0)),
        "amount": _safe_float(raw.get("amount", 0)),
        "turnover": _safe_float(raw.get("turnoverratio", 0)),
        "pe": _safe_float(raw.get("per", 0)),
        "pb": _safe_float(raw.get("pb", 0)),
        "totalMv": _safe_float(raw.get("mktcap", 0)) * 10000,
        "circMv": _safe_float(raw.get("nmc", 0)) * 10000,
    }


def _fetch_sector_members(code: str, page_size: int = 120) -> list[dict]:
    cache_key = f"{code}:{page_size}"
    cached = _member_cache.get(cache_key)
    if cached and time.time() - cached.get("updated", 0.0) < _CACHE_TTL_SECONDS:
        return list(cached.get("data", []))

    try:
        response = _http_get(
            "https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData",
            params={
                "page": 1,
                "num": max(20, min(page_size, 240)),
                "sort": "changepercent",
                "asc": 0,
                "node": code,
                "symbol": "",
                "_s_r_a": "auto",
            },
            timeout=12,
        )
        response.raise_for_status()
        payload = json.loads(response.text) if response.text.strip() else []
        if not isinstance(payload, list):
            return []
        data = [_build_member_item(item) for item in payload if item.get("code") or item.get("symbol")]
        _member_cache[cache_key] = {"data": data, "updated": time.time()}
        return data
    except Exception as exc:
        print(f"[sector] error fetching members for {code}: {exc}")
        return list(cached.get("data", [])) if cached else []


def get_sector_members(codes: list[str], page_size: int = 120) -> list[dict]:
    normalized_codes = []
    for code in codes:
        current = str(code or "").strip()
        if current and current not in normalized_codes:
            normalized_codes.append(current)

    if not normalized_codes:
        return []

    sector_lookup = {
        item["code"]: item["name"]
        for item in [*get_sector_rank(), *get_concept_rank()]
        if item.get("code") and item.get("name")
    }
    merged: dict[str, dict] = {}

    for sector_code in normalized_codes:
        sector_name = sector_lookup.get(sector_code, sector_code)
        for item in _fetch_sector_members(sector_code, page_size):
            stock_code = item.get("code", "")
            if not stock_code:
                continue
            existing = merged.get(stock_code)
            if existing:
                tags = existing.setdefault("sectorTags", [])
                if sector_name not in tags:
                    tags.append(sector_name)
                continue
            merged[stock_code] = {
                **item,
                "sectorTags": [sector_name],
            }

    result = list(merged.values())
    result.sort(
        key=lambda item: (
            item.get("changePercent", 0),
            item.get("amount", 0),
            item.get("volume", 0),
        ),
        reverse=True,
    )
    return result


def search_sectors(keyword: str, limit: int = 5) -> list[dict]:
    """
    根据关键词模糊搜索行业和概念板块

    Args:
        keyword: 搜索关键词
        limit: 最大返回数量

    Returns:
        匹配的板块列表，每项包含 code/name/type/changePercent/companyCount/leadingStock
    """
    if not keyword or not keyword.strip():
        return []

    kw = keyword.strip().lower()
    matches: list[dict] = []

    for sector_type, fetch_fn in [
        ("industry", get_industry_rank),
        ("concept", get_concept_rank),
    ]:
        try:
            items = fetch_fn()
        except Exception:
            items = []
        for item in items:
            name = item.get("name", "")
            if kw in name.lower():
                matches.append({
                    "code": item.get("code", ""),
                    "name": name,
                    "type": sector_type,
                    "changePercent": item.get("changePercent", 0),
                    "companyCount": item.get("companyCount", 0),
                    "leadingStock": item.get("leadingStock", ""),
                })

    matches.sort(key=lambda x: abs(x.get("changePercent", 0)), reverse=True)
    return matches[:limit]
