import json
import re
import time
import threading
from typing import Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
from email.utils import parsedate_to_datetime
from datetime import datetime, timedelta
from urllib.parse import quote
from xml.etree import ElementTree as ET

from app.services.network_env import create_http_session
from app.services.datasource_registry import get_sources_for_tool
from app.services.news_remote_fetchers import STOCK_NEWS_REMOTE_FETCHERS, FINANCIAL_NEWS_REMOTE_FETCHERS

TOPIC_NEWS_KEYWORDS = [
    "国务院",
    "国家发改委",
    "财政部",
    "央行",
    "证监会",
    "工信部",
    "经济会议",
    "扩内需",
    "消费刺激",
    "地产政策",
    "美联储",
    "CPI",
    "非农",
    "伊朗",
    "中东",
    "原油",
    "俄乌",
    "关税",
    "降准",
    "降息",
    "地缘政治",
    "出口管制",
    "业绩预告",
    "监管",
    "人工智能",
    "芯片",
    "新能源",
    "港股",
    "美股",
]
RSS_TOPIC_NEWS_KEYWORDS = [
    "A股",
    "港股",
    "美股",
    "美联储",
    "人民币汇率",
    "芯片",
    "人工智能",
    "新能源",
]


def _http_get(url: str, referer: str = "https://finance.sina.com.cn", proxy_id: str | None = None, **kwargs):
    return create_http_session(referer=referer, target_url=url, proxy_id=proxy_id).get(url, **kwargs)


def get_context_news(code: str, limit: int = 20, stock_name: str = "", preferred_source: Optional[str] = None) -> list[dict]:
    try:
        stock_name = str(stock_name or "").strip() or _fetch_stock_name(code)
        stock_items = get_stock_news(code, max(limit, 8), stock_name, preferred_source=preferred_source)
        related_market_items = []
        sources_list = get_sources_for_tool("load_stock_news", preferred_source)
        proxy_map: dict[str, str | None] = {s.get("id", ""): s.get("proxyId") for s in sources_list}
        em_proxy = proxy_map.get("eastmoney")
        goog_proxy = proxy_map.get("google-news-rss")

        if stock_name:
            query_terms = [
                f"{stock_name} 政策",
                f"{stock_name} 国际",
                f"{stock_name} 行业",
            ]
            for term in query_terms:
                related_market_items.extend(_search_topic_news(term, max(4, limit // 2), proxy_id=em_proxy))
                if len(_dedupe_news_items(related_market_items)) < max(4, limit):
                    related_market_items.extend(_search_google_news_rss(term, 3, proxy_id=goog_proxy))
                if len(_dedupe_news_items(related_market_items)) >= max(6, limit + 2):
                    break

        if len(_dedupe_news_items(related_market_items)) < max(4, limit):
            related_market_items.extend(
                item
                for item in get_financial_news(max(20, limit * 2), preferred_source=preferred_source)
                if _is_stock_related(item, code, stock_name)
            )

        merged = _dedupe_news_items([*stock_items, *related_market_items])
        filtered = [
            item for item in merged if _is_stock_related(item, code, stock_name)
        ]
        filtered = _prefer_recent_news(filtered, limit)
        filtered.sort(
            key=lambda item: (
                _score_context_item(item, code, stock_name),
                item.get("timestamp", 0),
            ),
            reverse=True,
        )
        return filtered[:limit] if filtered else stock_items[:limit]
    except Exception as e:
        print(f"[news] error fetching context news for {code}: {e}")
        return get_stock_news(code, limit)


_FINANCIAL_NEWS_TIMEOUT = 15.0
_FINANCIAL_NEWS_EARLY_STOP = 100


def get_financial_news(limit: int = 50, preferred_source: Optional[str] = None) -> list[dict]:
    deadline = time.monotonic() + _FINANCIAL_NEWS_TIMEOUT
    try:
        sources_list = get_sources_for_tool("load_financial_news", preferred_source)
        source_ids = [s.get("id", "") for s in sources_list]
        proxy_map: dict[str, str | None] = {s.get("id", ""): s.get("proxyId") for s in sources_list}
        api_key_map: dict[str, str | None] = {s.get("id", ""): s.get("apiKey") for s in sources_list}
        merged: list[dict] = []

        use_eastmoney = not source_ids or "eastmoney" in source_ids
        use_google = not source_ids or "google-news-rss" in source_ids
        em_pid = proxy_map.get("eastmoney")
        goog_pid = proxy_map.get("google-news-rss")

        if use_eastmoney:
            try:
                merged.extend(_get_sina_roll_news(max(limit * 2, 120), proxy_id=em_pid))
            except Exception as e:
                print(f"[news] sina roll failed: {e}")

        if time.monotonic() > deadline:
            return _finalize_news(merged, limit)

        em_keywords = TOPIC_NEWS_KEYWORDS if use_eastmoney else []
        goog_keywords = RSS_TOPIC_NEWS_KEYWORDS if use_google else []

        if em_keywords or goog_keywords:
            all_keywords = [(kw, "em") for kw in em_keywords] + [(kw, "goog") for kw in goog_keywords]
            collected_count = len(merged)
            max_workers = min(8, len(all_keywords))

            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                futures = {}
                for kw, src in all_keywords:
                    if collected_count >= _FINANCIAL_NEWS_EARLY_STOP:
                        break
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        break
                    if src == "em":
                        futures[pool.submit(_search_topic_news, kw, 8, em_pid)] = kw
                    else:
                        futures[pool.submit(_search_google_news_rss, kw, 6, goog_pid)] = kw

                for future in as_completed(futures, timeout=max(0.1, deadline - time.monotonic())):
                    try:
                        items = future.result(timeout=3.0)
                        merged.extend(items)
                        collected_count += len(items)
                        if collected_count >= _FINANCIAL_NEWS_EARLY_STOP:
                            break
                    except Exception:
                        pass

        if time.monotonic() > deadline:
            return _finalize_news(merged, limit)

        for source_id in source_ids:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            pid = proxy_map.get(source_id)
            ak = api_key_map.get(source_id)
            remote_fn = FINANCIAL_NEWS_REMOTE_FETCHERS.get(source_id)
            if remote_fn:
                try:
                    merged.extend(remote_fn(limit=limit, api_key=ak, proxy_id=pid))
                except Exception as e:
                    print(f"[news] {source_id} financial news failed: {e}")

        return _finalize_news(merged, limit)
    except Exception as e:
        print(f"[news] error fetching financial news: {e}")
        return []


def _finalize_news(merged: list[dict], limit: int) -> list[dict]:
    deduped = _dedupe_news_items(merged)
    today_items = [item for item in deduped if _is_recent_news(item, 2)]
    source = today_items if len(today_items) >= max(12, limit // 2) else deduped
    return source[:limit]


def get_stock_news(code: str, limit: int = 20, stock_name: str = "", preferred_source: Optional[str] = None) -> list[dict]:
    try:
        stock_name = str(stock_name or "").strip() or _fetch_stock_name(code)
        sources_list = get_sources_for_tool("load_stock_news", preferred_source)
        source_ids = [s.get("id", "") for s in sources_list]
        proxy_map: dict[str, str | None] = {s.get("id", ""): s.get("proxyId") for s in sources_list}
        api_key_map: dict[str, str | None] = {s.get("id", ""): s.get("apiKey") for s in sources_list}
        use_eastmoney = not source_ids or "eastmoney" in source_ids
        use_google_rss = not source_ids or "google-news-rss" in source_ids
        use_yahoo = not source_ids or "yahoo-finance-rss" in source_ids
        sources: list[dict] = []
        em_proxy = proxy_map.get("eastmoney")
        goog_proxy = proxy_map.get("google-news-rss")
        yh_proxy = proxy_map.get("yahoo-finance-rss")

        if use_eastmoney:
            announce_items = _fetch_stock_announcements(code, min(max(limit, 8), 12), proxy_id=em_proxy)
            sources.extend(announce_items)

        def enough_items() -> bool:
            current = _prefer_recent_news(_dedupe_news_items(sources), limit)
            return len(current) >= max(6, min(limit, 10))

        if stock_name and use_eastmoney:
            sources.extend(_search_topic_news(stock_name, max(limit, 12), proxy_id=em_proxy))
            if not enough_items() and use_google_rss:
                sources.extend(_search_google_news_rss(stock_name, max(4, min(6, limit // 2 or 4)), proxy_id=goog_proxy))
            for suffix in ("公告", "财报", "订单"):
                if enough_items():
                    break
                if use_eastmoney:
                    sources.extend(_search_topic_news(f"{stock_name} {suffix}", max(4, limit // 3), proxy_id=em_proxy))

        if code and code.isdigit() and not enough_items():
            if use_eastmoney:
                sources.extend(_search_topic_news(code, max(4, min(limit, 8)), proxy_id=em_proxy))
            if not enough_items() and use_yahoo:
                sources.extend(_fetch_yahoo_finance_symbol_news(code, stock_name, max(3, min(5, limit // 2 or 3)), proxy_id=yh_proxy))

        if not enough_items():
            for source_id in source_ids:
                remote_fn = STOCK_NEWS_REMOTE_FETCHERS.get(source_id)
                if remote_fn:
                    try:
                        items = remote_fn(code=code, limit=limit, stock_name=stock_name, api_key=api_key_map.get(source_id), proxy_id=proxy_map.get(source_id))
                        sources.extend(items)
                        if enough_items():
                            break
                    except Exception as e:
                        print(f"[news] remote {source_id} stock news failed: {e}")

        merged = _dedupe_news_items(sources)
        if stock_name or code:
            filtered = [
                item for item in merged if _is_stock_related(item, code, stock_name)
            ]
            if len(filtered) >= max(3, limit // 2):
                merged = filtered
        return _prefer_recent_news(merged, limit)[:limit]
    except Exception as e:
        print(f"[news] error fetching stock news for {code}: {e}")
        return []


def search_news(query: str, limit: int = 8) -> list[dict]:
    normalized_query = str(query or "").strip()
    if not normalized_query:
        return []

    sources: list[dict] = []
    sources.extend(_search_topic_news(normalized_query, max(limit, 10)))
    if len(_dedupe_news_items(sources)) < max(4, limit):
        sources.extend(_search_google_news_rss(normalized_query, max(4, min(6, limit))))

    terms = [term for term in re.split(r"\s+", normalized_query) if len(term) >= 2][:2]
    for term in terms:
        if len(_prefer_recent_news(_dedupe_news_items(sources), limit)) >= max(6, min(limit, 10)):
            break
        sources.extend(_search_topic_news(term, max(4, limit // 2)))

    return _prefer_recent_news(_dedupe_news_items(sources), limit)[:limit]


def _extract_stocks(text: str) -> list[str]:
    codes = re.findall(r"\b(\d{6})\b", text)
    return codes


def _search_google_news_rss(keyword: str, limit: int = 6, proxy_id: str | None = None) -> list[dict]:
    normalized_keyword = str(keyword or "").strip()
    if not normalized_keyword:
        return []
    encoded_query = quote(f"{normalized_keyword} when:7d")
    url = f"https://news.google.com/rss/search?q={encoded_query}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans"
    return _fetch_rss_items(url, "Google News", limit, proxy_id=proxy_id)


def _fetch_yahoo_finance_symbol_news(code: str, stock_name: str = "", limit: int = 6, proxy_id: str | None = None) -> list[dict]:
    symbol = _to_yahoo_symbol(code)
    if not symbol:
        return []
    query_symbol = quote(symbol)
    url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={query_symbol}&region=US&lang=en-US"
    return _fetch_rss_items(url, "Yahoo Finance", limit, proxy_id=proxy_id)


def _fetch_rss_items(url: str, source_name: str, limit: int = 6, proxy_id: str | None = None) -> list[dict]:
    try:
        response = _http_get(url, timeout=12, proxy_id=proxy_id)
        response.raise_for_status()
        root = ET.fromstring(response.content)
        result = []
        for item in root.findall(".//item")[: max(1, min(limit, 12))]:
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            description = _strip_html(item.findtext("description") or "")
            pub_date = (item.findtext("pubDate") or "").strip()
            timestamp = _parse_rss_timestamp(pub_date)
            result.append(
                {
                    "id": item.findtext("guid") or str(hash(f"{source_name}:{title}:{link}")),
                    "title": title,
                    "content": description,
                    "source": source_name,
                    "url": link,
                    "publishTime": _format_timestamp(timestamp, pub_date),
                    "timestamp": timestamp,
                    "relatedStocks": _extract_stocks(f"{title} {description}"),
                    "sentiment": None,
                    "sentimentScore": None,
                    "aiSummary": None,
                }
            )
        return result
    except Exception as e:
        print(f"[news] error fetching rss {source_name}: {e}")
        return []


def _parse_rss_timestamp(value: str) -> int:
    if not value:
        return 0
    try:
        return int(parsedate_to_datetime(value).timestamp() * 1000)
    except Exception:
        return 0


def _format_timestamp(timestamp: int, fallback: str = "") -> str:
    if timestamp > 0:
        return datetime.fromtimestamp(timestamp / 1000).strftime("%Y-%m-%d %H:%M:%S")
    return fallback


def _to_yahoo_symbol(code: str) -> str:
    raw = str(code or "").strip().upper()
    if not raw:
        return ""
    if raw.isalpha():
        return raw
    if len(raw) == 5 and raw.isdigit():
        return f"{raw}.HK"
    if len(raw) == 6 and raw.isdigit():
        if raw.startswith("6"):
            return f"{raw}.SS"
        if raw.startswith(("0", "3")):
            return f"{raw}.SZ"
        if raw.startswith(("4", "8", "9")):
            return f"{raw}.BJ"
    return ""


def _get_sina_roll_news(limit: int, proxy_id: str | None = None) -> list[dict]:
    url = f"https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num={limit}&versionNumber=1.2.4"
    response = _http_get(url, timeout=10, proxy_id=proxy_id)
    payload = response.json()
    items = payload.get("result", {}).get("data", [])
    result = []
    for item in items:
        ts = int(item.get("ctime", 0))
        result.append(
            {
                "id": item.get("docid", str(hash(item.get("title", "")))),
                "title": item.get("title", ""),
                "content": item.get("intro", "") or item.get("summary", ""),
                "source": item.get("media_name", "") or "新浪财经",
                "url": item.get("url", ""),
                "publishTime": datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")
                if ts
                else "",
                "timestamp": ts * 1000,
                "relatedStocks": _extract_stocks(
                    item.get("title", "") + " " + (item.get("intro", "") or "")
                ),
                "sentiment": None,
                "sentimentScore": None,
                "aiSummary": None,
            }
        )
    return result


def _search_topic_news(keyword: str, limit: int = 6, proxy_id: str | None = None) -> list[dict]:
    url = _build_eastmoney_search_url(keyword, max(limit * 4, 36))
    response = _http_get(url, referer="https://so.eastmoney.com/", timeout=12, proxy_id=proxy_id)
    payload = _parse_eastmoney_jsonp(response.text)
    groups = payload.get("result", {})
    items = [
        *groups.get("cmsArticleWebOld", []),
        *groups.get("cmsArticleWeb", []),
    ]
    result = []
    for item in items:
        publish_time = item.get("date", "") or ""
        timestamp = _to_timestamp_ms(publish_time)
        title = _strip_html(item.get("title", "") or "")
        content = _strip_html(item.get("content", "") or "")
        result.append(
            {
                "id": item.get("code", str(hash(f"{keyword}:{title}"))),
                "title": title,
                "content": content,
                "source": item.get("mediaName", "") or "东方财富",
                "url": item.get("url", ""),
                "publishTime": publish_time,
                "timestamp": timestamp,
                "relatedStocks": _extract_stocks(f"{title} {content}"),
                "sentiment": None,
                "sentimentScore": None,
                "aiSummary": None,
            }
        )
    result = _prefer_recent_news(_dedupe_news_items(result), limit)
    return result[:limit]


def _fetch_stock_name(code: str) -> str:
    raw = str(code or "").strip()
    if not raw:
        return ""
    if raw.startswith("6"):
        symbol = f"sh{raw}"
    elif raw.startswith(("0", "3")):
        symbol = f"sz{raw}"
    elif raw.startswith(("4", "8", "9")):
        symbol = f"bj{raw}"
    elif len(raw) == 5:
        symbol = f"rt_hk{raw}"
    else:
        symbol = f"gb_{raw.lower()}"

    try:
        response = _http_get(f"https://hq.sinajs.cn/list={symbol}", timeout=10)
        matched = re.search(r'"([^"]*)"', response.text)
        if not matched or not matched.group(1):
            return ""
        parts = matched.group(1).split(",")
        if len(raw) == 5:
            return parts[1] if len(parts) > 1 else ""
        if raw.isalpha():
            return parts[0] if parts else ""
        return parts[0] if parts else ""
    except Exception:
        return ""


def _fetch_stock_announcements(code: str, limit: int = 10, proxy_id: str | None = None) -> list[dict]:
    raw = str(code or "").strip()
    if not raw or not raw.isdigit():
        return []
    ann_type = (
        "SHA" if raw.startswith("6") else "SZA" if raw.startswith(("0", "3")) else "BJA"
    )
    try:
        url = f"https://np-anotice-stock.eastmoney.com/api/security/ann?page_size={min(limit, 20)}&page_index=1&ann_type={ann_type}&stock_list={raw}&f_node=0&s_node=0"
        response = _http_get(url, referer="https://data.eastmoney.com/", timeout=10, proxy_id=proxy_id)
        payload = response.json()
        items = payload.get("data", {}).get("list", [])
        result = []
        for item in items:
            title = str(item.get("title", "") or "").strip()
            if not title:
                continue
            notice_date = str(item.get("notice_date", "") or "").strip()[:19]
            columns = item.get("columns", [])
            col_name = (
                columns[0].get("column_name", "")
                if isinstance(columns, list) and columns
                else ""
            )
            ts = _to_timestamp_ms(notice_date)
            result.append(
                {
                    "id": f"ann_{item.get('art_code', hash(title))}",
                    "title": title,
                    "content": col_name,
                    "source": "公司公告",
                    "url": f"https://np-anotice-stock.eastmoney.com/{item.get('art_code', '')}"
                    if item.get("art_code")
                    else "",
                    "publishTime": notice_date,
                    "timestamp": ts,
                    "relatedStocks": [raw],
                    "sentiment": None,
                    "sentimentScore": None,
                    "aiSummary": None,
                }
            )
        return result
    except Exception as e:
        print(f"[news] error fetching announcements for {code}: {e}")
        return []
    if raw.startswith("6"):
        market = "1"
    elif raw.startswith(("0", "3")):
        market = "2"
    else:
        market = "0"
    try:
        url = f"https://guba.eastmoney.com/interface/GetData.aspx?path=guba/newlist&param=ps%3D{min(limit, 20)}%26p%3D1%26code%3D{raw}%26market%3D{market}%26type%3D0"
        response = _http_get(url, referer="https://guba.eastmoney.com/", timeout=10, proxy_id=proxy_id)
        payload = response.json()
        items = payload.get("Data", []) or payload.get("data", []) or []
        if isinstance(items, dict):
            items = items.get("list", []) or []
        result = []
        for item in items:
            title = str(
                item.get("title", "") or item.get("post_title", "") or ""
            ).strip()
            if not title:
                continue
            content = str(
                item.get("content", "") or item.get("post_content", "") or ""
            ).strip()
            ts = int(item.get("post_last_time", 0) or item.get("last_time", 0) or 0)
            if not ts:
                ts = int(item.get("post_created", 0) or item.get("created", 0) or 0)
            publish_time = (
                datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S") if ts else ""
            )
            result.append(
                {
                    "id": f"guba_{item.get('post_id', '') or item.get('id', hash(title))}",
                    "title": title,
                    "content": content[:500] if content else "",
                    "source": item.get("post_user", "")
                    or item.get("source", "")
                    or "股吧",
                    "url": f"https://guba.eastmoney.com/news,{raw},{item.get('post_id', '')}.html"
                    if item.get("post_id")
                    else "",
                    "publishTime": publish_time,
                    "timestamp": ts * 1000 if ts else 0,
                    "relatedStocks": [raw],
                    "sentiment": None,
                    "sentimentScore": None,
                    "aiSummary": None,
                }
            )
        return result
    except Exception as e:
        print(f"[news] error fetching guba news for {code}: {e}")
        return []


def _dedupe_news_items(items: list[dict]) -> list[dict]:
    seen = set()
    result = []
    for item in sorted(
        items, key=lambda current: current.get("timestamp", 0), reverse=True
    ):
        key = item.get("url") or item.get("title") or item.get("id")
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def _is_stock_related(item: dict, code: str, stock_name: str) -> bool:
    title = str(item.get("title", "") or "")
    content = str(item.get("content", "") or "")
    related_codes = item.get("relatedStocks", []) or []
    haystack = f"{title} {content}"
    if code and code in related_codes:
        return True
    if code and code in haystack:
        return True
    if stock_name and stock_name in haystack:
        return True
    return False


def _score_context_item(item: dict, code: str, stock_name: str) -> int:
    title = str(item.get("title", "") or "")
    content = str(item.get("content", "") or "")
    score = 0
    if stock_name and stock_name in title:
        score += 8
    if stock_name and stock_name in content:
        score += 4
    if code and code in title:
        score += 6
    if code and code in content:
        score += 3
    if any(
        keyword in title
        for keyword in ("公告", "订单", "业绩", "回购", "机构", "互动", "调研", "签约")
    ):
        score += 2
    if any(
        keyword in content
        for keyword in ("公告", "订单", "业绩", "回购", "机构", "调研")
    ):
        score += 1
    return score


def _is_today_news(item: dict) -> bool:
    publish_time = item.get("publishTime", "")
    if publish_time:
        return publish_time[:10] == datetime.now().strftime("%Y-%m-%d")
    timestamp = int(item.get("timestamp", 0) or 0)
    if not timestamp:
        return False
    return datetime.fromtimestamp(timestamp / 1000).strftime(
        "%Y-%m-%d"
    ) == datetime.now().strftime("%Y-%m-%d")


def _is_recent_news(item: dict, days: int = 2) -> bool:
    publish_time = item.get("publishTime", "")
    if publish_time:
        try:
            return datetime.strptime(publish_time[:19], "%Y-%m-%d %H:%M:%S") >= datetime.now() - timedelta(days=days)
        except Exception:
            try:
                return datetime.strptime(publish_time[:10], "%Y-%m-%d") >= datetime.now() - timedelta(days=days)
            except Exception:
                pass
    timestamp = int(item.get("timestamp", 0) or 0)
    if not timestamp:
        return False
    return datetime.fromtimestamp(timestamp / 1000) >= datetime.now() - timedelta(days=days)


def _prefer_recent_news(
    items: list[dict], limit: int, recent_days: int = 180
) -> list[dict]:
    if not items:
        return []
    now = datetime.now()
    threshold = now - timedelta(days=recent_days)
    recent = [
        item
        for item in items
        if int(item.get("timestamp", 0) or 0)
        and datetime.fromtimestamp(int(item.get("timestamp", 0)) / 1000) >= threshold
    ]
    if len(recent) >= max(3, min(limit, 6)):
        return sorted(recent, key=lambda item: item.get("timestamp", 0), reverse=True)
    return sorted(items, key=lambda item: item.get("timestamp", 0), reverse=True)


def _build_eastmoney_search_url(keyword: str, limit: int) -> str:
    page_size = max(1, min(limit, 20))
    params = {
        "uid": "",
        "keyword": keyword,
        "type": ["cmsArticleWebOld", "cmsArticleWeb"],
        "client": "web",
        "clientType": "web",
        "clientVersion": "curr",
        "param": {
            "cmsArticleWebOld": {
                "searchScope": "default",
                "sort": "default",
                "pageIndex": 1,
                "pageSize": page_size,
                "preTag": "<em>",
                "postTag": "</em>",
            },
            "cmsArticleWeb": {
                "searchScope": "default",
                "sort": "default",
                "pageIndex": 1,
                "pageSize": page_size,
                "preTag": "<em>",
                "postTag": "</em>",
            },
        },
    }
    return (
        "https://search-api-web.eastmoney.com/search/jsonp"
        f"?cb=jQuery1123&param={quote(json.dumps(params, ensure_ascii=False, separators=(',', ':')))}"
    )


def _parse_eastmoney_jsonp(raw: str) -> dict:
    matched = re.search(r"\((.*)\)\s*$", raw, re.S)
    if not matched:
        raise ValueError("invalid eastmoney jsonp payload")
    return json.loads(matched.group(1))


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").replace("&nbsp;", " ").strip()


def _to_timestamp_ms(value: str) -> int:
    if not value:
        return 0
    try:
        return int(
            datetime.strptime(value[:19], "%Y-%m-%d %H:%M:%S").timestamp() * 1000
        )
    except Exception:
        return 0
