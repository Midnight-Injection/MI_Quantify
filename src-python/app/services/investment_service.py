import re
import time
import io
import contextlib
from urllib.parse import quote

import akshare as ak
from bs4 import BeautifulSoup

from app.services.network_env import create_http_session

_CACHE_TTL = 15 * 60
_DATAFRAME_CACHE: dict[str, tuple[float, object]] = {}


def _cached_dataframe(key: str, loader):
    cached = _DATAFRAME_CACHE.get(key)
    now = time.time()
    if cached and now - cached[0] < _CACHE_TTL:
        return cached[1]

    data = loader()
    _DATAFRAME_CACHE[key] = (now, data)
    return data


def normalize_bank_name(bank: str | None) -> str:
    normalized = str(bank or "").strip()
    if not normalized:
        return "中国银行"
    if re.search(r"中国银行|中行|BOC", normalized, re.I):
        return "中国银行"
    if re.search(r"工商银行|工行|ICBC", normalized, re.I):
        return "工商银行"
    if re.search(r"建设银行|建行|CCB", normalized, re.I):
        return "建设银行"
    if re.search(r"农业银行|农行|ABC", normalized, re.I):
        return "农业银行"
    if re.search(r"招商银行|招行|CMB", normalized, re.I):
        return "招商银行"
    return normalized


def _http_get(url: str, referer: str, **kwargs):
    return create_http_session(referer=referer, target_url=url).get(url, **kwargs)


def _http_post(url: str, referer: str, **kwargs):
    return create_http_session(referer=referer, target_url=url).post(url, **kwargs)


def _extract_number(text: str | None) -> float | None:
    if text is None:
        return None
    matched = re.search(r"-?\d+(?:\.\d+)?", str(text))
    if not matched:
        return None
    try:
        return float(matched.group(0))
    except Exception:
        return None


def _safe_float(value):
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


def search_funds(query: str, limit: int = 20) -> list[dict]:
    keyword = str(query or "").strip()
    if not keyword:
        return []

    fund_names = _cached_dataframe("fund_name_em", ak.fund_name_em)
    fund_daily = _cached_dataframe("fund_open_fund_daily_em", ak.fund_open_fund_daily_em)

    daily_map = {}
    if fund_daily is not None and not fund_daily.empty:
        for _, row in fund_daily.iterrows():
            code = str(row.get("基金代码") or "").strip()
            if code:
                daily_map[code] = row

    scored: list[tuple[int, dict]] = []
    for _, row in fund_names.iterrows():
        code = str(row.get("基金代码") or "").strip()
        name = str(row.get("基金简称") or "").strip()
        pinyin = str(row.get("拼音缩写") or "").strip()
        full_pinyin = str(row.get("拼音全称") or "").strip()
        if not code:
            continue

        text = f"{code} {name} {pinyin} {full_pinyin}".lower()
        needle = keyword.lower()
        if needle not in text:
            continue

        score = 20
        if code == keyword:
            score += 100
        if needle == name.lower():
            score += 80
        if name.startswith(keyword):
            score += 40
        if needle in pinyin.lower():
            score += 20

        daily_row = daily_map.get(code)
        scored.append((score, {
            "code": code,
            "name": name,
            "type": str(row.get("基金类型") or "").strip(),
            "pinyin": pinyin,
            "unitNav": _safe_float(daily_row.get(next((col for col in daily_row.index if "单位净值" in str(col)), ""))) if daily_row is not None else None,
            "cumulativeNav": _safe_float(daily_row.get(next((col for col in daily_row.index if "累计净值" in str(col)), ""))) if daily_row is not None else None,
            "dailyGrowthRate": _safe_float(daily_row.get("日增长率")) if daily_row is not None else None,
            "subscriptionStatus": str(daily_row.get("申购状态") or "").strip() if daily_row is not None else "",
            "redemptionStatus": str(daily_row.get("赎回状态") or "").strip() if daily_row is not None else "",
            "fee": str(daily_row.get("手续费") or "").strip() if daily_row is not None else "",
        }))

    scored.sort(key=lambda item: (-item[0], item[1]["code"]))
    return [item[1] for item in scored[: max(1, min(limit, 60))]]


def get_fund_rating(code: str) -> dict:
    symbol = str(code or "").strip()
    if not symbol:
        return {}

    try:
        rating_df = _cached_dataframe("fund_rating_all", ak.fund_rating_all)
        matched = rating_df[rating_df["代码"].astype(str) == symbol]
        if matched.empty:
            return {}
        row = matched.iloc[0]
        return {
            "code": symbol,
            "name": str(row.get("简称") or "").strip(),
            "manager": str(row.get("基金经理") or "").strip(),
            "company": str(row.get("基金公司") or "").strip(),
            "fiveStarCount": _safe_float(row.get("5星评级家数")),
            "shanghaiRating": _safe_float(row.get("上海证券")),
            "zhaoshangRating": _safe_float(row.get("招商证券")),
            "jianxinRating": _safe_float(row.get("济安金信")),
            "morningstarRating": _safe_float(row.get("晨星评级")),
            "fee": _safe_float(row.get("手续费")),
            "fundType": str(row.get("类型") or "").strip(),
        }
    except Exception as exc:
        print(f"[investment] fund rating error {symbol}: {exc}")
        return {}


def get_fund_history(code: str, limit: int = 60) -> list[dict]:
    symbol = str(code or "").strip()
    if not symbol:
        return []

    try:
        nav_df = ak.fund_open_fund_info_em(symbol=symbol, indicator="单位净值走势", period="3月")
        return_df = ak.fund_open_fund_info_em(symbol=symbol, indicator="累计收益率走势", period="3月")
        return_map = {
            str(row.get("日期")): _safe_float(row.get("累计收益率"))
            for _, row in return_df.iterrows()
        }

        rows: list[dict] = []
        for _, row in nav_df.tail(max(1, min(limit, 180))).iterrows():
            date = str(row.get("净值日期") or "").strip()
            if not date:
                continue
            rows.append({
                "date": date,
                "unitNav": _safe_float(row.get("单位净值")),
                "dailyGrowthRate": _safe_float(row.get("日增长率")),
                "cumulativeReturn": return_map.get(date),
            })
        return rows
    except Exception as exc:
        if hasattr(ak, "fund_money_fund_info_em"):
            try:
                with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                    money_df = ak.fund_money_fund_info_em(symbol=symbol)
                rows: list[dict] = []
                for _, row in money_df.tail(max(1, min(limit, 180))).iterrows():
                    annualized = _safe_float(row.get("7日年化收益率"))
                    rows.append({
                        "date": str(row.get("净值日期") or "").strip(),
                        "unitNav": _safe_float(row.get("每万份收益")),
                        "cumulativeReturn": annualized * 0.25 if annualized is not None else None,
                    })
                return rows
            except Exception as inner_exc:
                print(f"[investment] money fund history error {symbol}: {inner_exc}")
        print(f"[investment] fund history error {symbol}: {exc}")
        return []


def get_fund_profile(code: str) -> dict:
    symbol = str(code or "").strip()
    if not symbol:
        return {}

    matches = search_funds(symbol, limit=3)
    base = next((item for item in matches if item.get("code") == symbol), matches[0] if matches else {})
    history = get_fund_history(symbol, limit=90)
    rating = get_fund_rating(symbol)

    recent_return = None
    if history:
        last_with_return = next((item for item in reversed(history) if item.get("cumulativeReturn") is not None), None)
        if last_with_return:
            recent_return = _safe_float(last_with_return.get("cumulativeReturn"))

    return {
        **base,
        "code": symbol,
        "recentReturn3m": recent_return,
        "rating": rating,
        "historyCount": len(history),
    }


def get_bank_deposit_rates(bank: str | None) -> dict:
    normalized_bank = normalize_bank_name(bank)
    if normalized_bank != "中国银行":
        return {"bank": normalized_bank, "supported": False, "items": []}

    index_url = "https://www.bankofchina.com/fimarkets/lilv/fd31/"
    response = _http_get(index_url, referer="https://www.bankofchina.com", timeout=12)
    response.raise_for_status()
    response.encoding = response.apparent_encoding or response.encoding or "utf-8"
    html = response.text

    links = re.findall(r'href="(\.?/?\d{6}/t\d{8}_\d+\.html)"', html)
    if not links:
        return {"bank": normalized_bank, "supported": True, "items": []}

    latest_path = links[0].lstrip("./")
    article_url = f"https://www.bankofchina.com/fimarkets/lilv/fd31/{latest_path}"
    article_response = _http_get(article_url, referer=index_url, timeout=12)
    article_response.raise_for_status()
    article_response.encoding = article_response.apparent_encoding or article_response.encoding or "utf-8"
    soup = BeautifulSoup(article_response.text, "lxml")
    table = soup.find("table")
    if table is None:
        return {"bank": normalized_bank, "supported": True, "sourceUrl": article_url, "items": []}

    items: list[dict] = []
    for row in table.find_all("tr"):
        cells = [cell.get_text(" ", strip=True) for cell in row.find_all(["th", "td"])]
        if len(cells) < 2:
            continue
        term = cells[0]
        if not term or "项目" in term:
            continue
        rate = _extract_number(cells[-1])
        if rate is None:
            continue
        items.append({
            "term": term,
            "annualRate": rate,
        })

    published_at_match = re.search(r"(\d{4}-\d{2}-\d{2})", article_response.text)
    return {
        "bank": normalized_bank,
        "supported": True,
        "publishedAt": published_at_match.group(1) if published_at_match else "",
        "sourceUrl": article_url,
        "items": items,
    }


def search_bank_fund_shelf(
    bank: str | None,
    keyword: str = "",
    limit: int = 20,
    include_wealth: bool = True,
) -> dict:
    normalized_bank = normalize_bank_name(bank)
    if normalized_bank != "中国银行":
        return {"bank": normalized_bank, "supported": False, "items": []}

    search_keyword = str(keyword or "").strip()
    product_types = [("01", "fund")]
    if include_wealth:
        product_types.append(("02", "wealth"))

    items: list[dict] = []
    seen: set[str] = set()
    for ftype, category in product_types:
        url = "https://e.boc.cn/ezcms/finance/v1/query"
        payload = {
            "system": "dxcp",
            "ftype": ftype,
            "start": 0,
            "rows": max(5, min(limit, 80)),
            "query": [],
            "sort": {},
            "count": "true",
            "search": search_keyword,
        }
        response = _http_post(
            url,
            referer="https://e.boc.cn/ezcms/if/ifwb.html#/",
            json=payload,
            timeout=15,
        )
        response.raise_for_status()
        data = response.json() or {}
        rows = data.get("data", {}).get("result", []) or data.get("rows", []) or []
        for row in rows:
            product_code = str(
                row.get("productCode")
                or row.get("code")
                or row.get("fundCode")
                or ""
            ).strip()
            product_name = str(row.get("productName") or row.get("name") or "").strip()
            if not product_name:
                continue
            dedupe_key = f"{category}:{product_code}:{product_name}"
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            items.append({
                "productCode": product_code,
                "productName": product_name,
                "category": category,
                "riskLevel": str(row.get("riskLevel") or row.get("riskGrade") or "").strip(),
                "performanceBenchmark": str(row.get("performanceBenchmark") or row.get("incomeBenchmark") or "").strip(),
                "feeStandard": str(row.get("feeStandard") or "").strip(),
                "companyName": str(
                    row.get("companyName")
                    or row.get("fundCompanyName")
                    or row.get("productCompany")
                    or row.get("issuingInstitution")
                    or ""
                ).strip(),
                "salesChannel": str(row.get("productSalesChannel") or row.get("salesChannel") or "").strip(),
                "currency": str(row.get("currency") or row.get("currencySign") or "").strip(),
                "salesStatus": str(row.get("productSalesStatus") or "").strip(),
                "url": "https://e.boc.cn/ezcms/if/ifwb.html#/",
            })

    return {
        "bank": normalized_bank,
        "supported": True,
        "keyword": search_keyword,
        "sourceUrl": "https://e.boc.cn/ezcms/if/ifwb.html#/",
        "items": items[: max(1, min(limit, 80))],
    }


def bank_official_search(bank: str | None, keyword: str, limit: int = 10) -> dict:
    normalized_bank = normalize_bank_name(bank)
    query = str(keyword or "").strip()
    if normalized_bank != "中国银行" or not query:
        return {"bank": normalized_bank, "items": []}

    url = f"https://srh.bankofchina.com/search/sitesearch/index.jsp?searchword={quote(query)}"
    response = _http_get(url, referer="https://www.bankofchina.com", timeout=12)
    response.raise_for_status()
    response.encoding = response.apparent_encoding or response.encoding or "utf-8"
    soup = BeautifulSoup(response.text, "lxml")
    results: list[dict] = []
    for link in soup.select("a")[: max(1, min(limit * 3, 30))]:
        title = link.get_text(" ", strip=True)
        href = str(link.get("href") or "").strip()
        if not title or not href or "bankofchina.com" not in href:
            continue
        results.append({
            "title": title,
            "url": href,
        })
        if len(results) >= limit:
            break
    return {"bank": normalized_bank, "items": results}
