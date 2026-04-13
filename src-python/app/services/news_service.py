import json
import re
from datetime import datetime
from urllib.parse import quote

from app.services.network_env import create_http_session

_http = create_http_session()
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
]


def get_context_news(code: str, limit: int = 20) -> list[dict]:
    try:
        stock_name = _fetch_stock_name(code)
        stock_items = get_stock_news(code, max(limit, 10))
        related_market_items = []

        if stock_name:
            query_terms = [
                stock_name,
                f"{stock_name} 政策",
                f"{stock_name} 国际",
                f"{stock_name} 行业",
                f"{stock_name} 订单",
                f"{stock_name} 出口",
            ]
            for term in query_terms:
                related_market_items.extend(_search_topic_news(term, 4))

        related_market_items.extend(
            item
            for item in get_financial_news(max(40, limit * 3))
            if _is_stock_related(item, code, stock_name)
        )

        merged = _dedupe_news_items([*stock_items, *related_market_items])
        filtered = [item for item in merged if _is_stock_related(item, code, stock_name)]
        filtered.sort(
            key=lambda item: (_score_context_item(item, code, stock_name), item.get("timestamp", 0)),
            reverse=True,
        )
        return filtered[:limit] if filtered else stock_items[:limit]
    except Exception as e:
        print(f"[news] error fetching context news for {code}: {e}")
        return get_stock_news(code, limit)


def get_financial_news(limit: int = 50) -> list[dict]:
    try:
        merged = []
        merged.extend(_get_sina_roll_news(max(limit, 60)))
        for keyword in TOPIC_NEWS_KEYWORDS:
            merged.extend(_search_topic_news(keyword, 4))

        deduped = _dedupe_news_items(merged)
        today_items = [item for item in deduped if _is_today_news(item)]
        return today_items[:limit]
    except Exception as e:
        print(f"[news] error fetching financial news: {e}")
        return []


def get_stock_news(code: str, limit: int = 20) -> list[dict]:
    try:
        url = _build_eastmoney_search_url(code, limit)
        response = _http.get(url, timeout=12)
        payload = _parse_eastmoney_jsonp(response.text)
        groups = payload.get("result", {})
        items = [
            *groups.get("cmsArticleWebOld", []),
            *groups.get("cmsArticleWeb", []),
        ]

        result = []
        for item in items[:limit]:
            publish_time = item.get("date", "") or ""
            timestamp = _to_timestamp_ms(publish_time)
            title = _strip_html(item.get("title", "") or "")
            content = _strip_html(item.get("content", "") or "")
            result.append(
                {
                    "id": item.get("code", str(hash(title))),
                    "title": title,
                    "content": content,
                    "summary": content,
                    "source": item.get("mediaName", "") or "东方财富",
                    "url": item.get("url", ""),
                    "publishTime": publish_time,
                    "timestamp": timestamp,
                    "relatedStocks": [code],
                    "sentiment": None,
                    "sentimentScore": None,
                    "aiSummary": None,
                }
            )
        return result
    except Exception as e:
        print(f"[news] error fetching stock news for {code}: {e}")
        return []


def _extract_stocks(text: str) -> list[str]:
    codes = re.findall(r"\b(\d{6})\b", text)
    return codes


def _get_sina_roll_news(limit: int) -> list[dict]:
    url = f"https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2516&num={limit}&versionNumber=1.2.4"
    response = _http.get(url, timeout=10)
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
                "publishTime": datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S") if ts else "",
                "timestamp": ts * 1000,
                "relatedStocks": _extract_stocks(item.get("title", "") + " " + (item.get("intro", "") or "")),
                "sentiment": None,
                "sentimentScore": None,
                "aiSummary": None,
            }
        )
    return result


def _search_topic_news(keyword: str, limit: int = 6) -> list[dict]:
    url = _build_eastmoney_search_url(keyword, limit)
    response = _http.get(url, timeout=12)
    payload = _parse_eastmoney_jsonp(response.text)
    groups = payload.get("result", {})
    items = [
        *groups.get("cmsArticleWebOld", []),
        *groups.get("cmsArticleWeb", []),
    ]
    result = []
    for item in items[:limit]:
        publish_time = item.get("date", "") or ""
        timestamp = _to_timestamp_ms(publish_time)
        title = _strip_html(item.get("title", "") or "")
        content = _strip_html(item.get("content", "") or "")
        result.append(
            {
                "id": item.get("code", str(hash(f'{keyword}:{title}'))),
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
    return result


def _fetch_stock_name(code: str) -> str:
    raw = str(code or '').strip()
    if not raw:
        return ''
    if raw.startswith('6'):
        symbol = f"sh{raw}"
    elif raw.startswith(('0', '3')):
        symbol = f"sz{raw}"
    elif raw.startswith(('4', '8', '9')):
        symbol = f"bj{raw}"
    elif len(raw) == 5:
        symbol = f"rt_hk{raw}"
    else:
        symbol = f"gb_{raw.lower()}"

    try:
        response = _http.get(f"https://hq.sinajs.cn/list={symbol}", timeout=10)
        matched = re.search(r'"([^"]*)"', response.text)
        if not matched or not matched.group(1):
            return ''
        parts = matched.group(1).split(',')
        if len(raw) == 5:
            return parts[1] if len(parts) > 1 else ''
        if raw.isalpha():
            return parts[0] if parts else ''
        return parts[0] if parts else ''
    except Exception:
        return ''


def _dedupe_news_items(items: list[dict]) -> list[dict]:
    seen = set()
    result = []
    for item in sorted(items, key=lambda current: current.get("timestamp", 0), reverse=True):
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
    if any(keyword in title for keyword in ("公告", "订单", "业绩", "回购", "机构", "互动", "调研", "签约")):
        score += 2
    if any(keyword in content for keyword in ("公告", "订单", "业绩", "回购", "机构", "调研")):
        score += 1
    return score


def _is_today_news(item: dict) -> bool:
    publish_time = item.get("publishTime", "")
    if publish_time:
        return publish_time[:10] == datetime.now().strftime("%Y-%m-%d")
    timestamp = int(item.get("timestamp", 0) or 0)
    if not timestamp:
        return False
    return datetime.fromtimestamp(timestamp / 1000).strftime("%Y-%m-%d") == datetime.now().strftime("%Y-%m-%d")


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
        return int(datetime.strptime(value[:19], "%Y-%m-%d %H:%M:%S").timestamp() * 1000)
    except Exception:
        return 0
