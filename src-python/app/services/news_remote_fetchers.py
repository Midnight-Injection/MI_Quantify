"""
新闻远程数据源适配器

支持的源：rsshub, gnews, newsapi, mediastack, finnhub

标准输出格式：
{id, title, content, source, url, publishTime, timestamp,
 relatedStocks, sentiment, sentimentScore, aiSummary}
"""

import hashlib
import logging
import time as _time
import xml.etree.ElementTree as ET

from .remote_api import remote_get, safe_float

logger = logging.getLogger(__name__)


def _make_id(text: str) -> str:
    """根据文本生成唯一 ID"""
    return hashlib.md5(text.encode("utf-8", errors="ignore")).hexdigest()[:12]


def _build_news(
    title: str,
    url: str,
    source: str = "",
    content: str = "",
    publish_time: str = "",
    related_stocks: list[str] | None = None,
) -> dict:
    ts = 0
    if publish_time:
        try:
            from datetime import datetime
            for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%SZ",
                        "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S",
                        "%a, %d %b %Y %H:%M:%S %z", "%a, %d %b %Y %H:%M:%S"):
                try:
                    dt = datetime.strptime(publish_time[:26], fmt)
                    ts = int(dt.timestamp() * 1000)
                    break
                except ValueError:
                    continue
        except Exception:
            pass
    if not ts:
        ts = int(_time.time() * 1000)

    return {
        "id": _make_id(url or title),
        "title": title,
        "content": content,
        "source": source,
        "url": url,
        "publishTime": publish_time,
        "timestamp": ts,
        "relatedStocks": related_stocks or [],
        "sentiment": "neutral",
        "sentimentScore": 0,
        "aiSummary": "",
    }


def _parse_rss_feed(xml_text: str, source_name: str, limit: int = 20) -> list[dict]:
    """通用 RSS/Atom feed 解析"""
    results = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    ns = {"atom": "http://www.w3.org/2005/Atom"}
    items = root.findall(".//item") or root.findall(".//atom:entry", ns)
    for item in items[:limit]:
        title_el = item.find("title")
        link_el = item.find("link") or item.find("atom:link", ns)
        desc_el = item.find("description") or item.find("summary") or item.find("atom:summary", ns)
        date_el = item.find("pubDate") or item.find("published") or item.find("atom:published", ns)

        title = (title_el.text or "").strip() if title_el is not None and title_el.text else ""
        link = ""
        if link_el is not None:
            link = link_el.text.strip() if link_el.text else (link_el.get("href", "") or "").strip()
        desc = (desc_el.text or "").strip() if desc_el is not None and desc_el.text else ""
        pub = (date_el.text or "").strip() if date_el is not None and date_el.text else ""

        if not title:
            continue
        results.append(_build_news(title=title, url=link, source=source_name, content=desc, publish_time=pub))
    return results


# ─── RSSHub ───

def get_news_rsshub(
    code: str = "",
    limit: int = 20,
    stock_name: str = "",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """
    RSSHub 新闻获取

    RSSHub 需要用户自建或使用公共实例，api_key 用于实例认证
    """
    base_url = (api_key or "https://rsshub.app").rstrip("/")

    feeds = []
    if code:
        feeds.append(f"{base_url}/eastmoney/report/{code}")
    feeds.append(f"{base_url}/cls/telegraph")
    feeds.append(f"{base_url}/36kr/newsflashes")

    results = []
    for feed_url in feeds:
        try:
            resp = remote_get(feed_url, proxy_id=proxy_id, referer=base_url, timeout=10)
            items = _parse_rss_feed(resp.text, "RSSHub", limit)
            results.extend(items)
        except Exception as e:
            logger.warning("rsshub feed failed %s: %s", feed_url, e)

    return results[:limit]


def get_financial_news_rsshub(
    limit: int = 20,
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """RSSHub 财经新闻"""
    base_url = (api_key or "https://rsshub.app").rstrip("/")
    feeds = [
        f"{base_url}/cls/telegraph",
        f"{base_url}/wallstreetcn/live",
        f"{base_url}/caixin/latest",
    ]
    results = []
    for feed_url in feeds:
        try:
            resp = remote_get(feed_url, proxy_id=proxy_id, referer=base_url, timeout=10)
            items = _parse_rss_feed(resp.text, "RSSHub", limit)
            results.extend(items)
        except Exception as e:
            logger.warning("rsshub financial news failed %s: %s", feed_url, e)
    return results[:limit]


# ─── GNews ───

def get_news_gnews(
    code: str = "",
    limit: int = 20,
    stock_name: str = "",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """GNews 新闻获取"""
    if not api_key:
        return []

    query = stock_name or code or "stock market"
    try:
        resp = remote_get(
            "https://gnews.io/api/v4/search",
            api_key=api_key,
            proxy_id=proxy_id,
            params={"q": query, "lang": "zh", "max": min(limit, 10), "in": "title,content"},
        )
        data = resp.json()
        articles = data.get("articles") or []
        return [
            _build_news(
                title=a.get("title", ""),
                url=a.get("url", ""),
                source=(a.get("source") or {}).get("name", "GNews"),
                content=a.get("description", a.get("content", "")),
                publish_time=a.get("publishedAt", ""),
            )
            for a in articles
        ]
    except Exception as e:
        logger.warning("gnews failed: %s", e)
        return []


def get_financial_news_gnews(
    limit: int = 20,
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """GNews 财经新闻"""
    if not api_key:
        return []
    try:
        resp = remote_get(
            "https://gnews.io/api/v4/top-headlines",
            api_key=api_key,
            proxy_id=proxy_id,
            params={"category": "business", "lang": "zh", "max": min(limit, 10)},
        )
        data = resp.json()
        articles = data.get("articles") or []
        return [
            _build_news(
                title=a.get("title", ""),
                url=a.get("url", ""),
                source=(a.get("source") or {}).get("name", "GNews"),
                content=a.get("description", a.get("content", "")),
                publish_time=a.get("publishedAt", ""),
            )
            for a in articles
        ]
    except Exception as e:
        logger.warning("gnews financial failed: %s", e)
        return []


# ─── NewsAPI ───

def get_news_newsapi(
    code: str = "",
    limit: int = 20,
    stock_name: str = "",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """NewsAPI 新闻获取"""
    if not api_key:
        return []

    query = stock_name or code or "stock"
    try:
        resp = remote_get(
            "https://newsapi.org/v2/everything",
            api_key=api_key,
            proxy_id=proxy_id,
            params={"q": query, "language": "zh", "pageSize": min(limit, 100), "sortBy": "publishedAt"},
        )
        data = resp.json()
        articles = data.get("articles") or []
        return [
            _build_news(
                title=a.get("title", ""),
                url=a.get("url", ""),
                source=(a.get("source") or {}).get("name", "NewsAPI"),
                content=a.get("description", ""),
                publish_time=a.get("publishedAt", ""),
            )
            for a in articles
        ]
    except Exception as e:
        logger.warning("newsapi failed: %s", e)
        return []


def get_financial_news_newsapi(
    limit: int = 20,
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """NewsAPI 财经头条"""
    if not api_key:
        return []
    try:
        resp = remote_get(
            "https://newsapi.org/v2/top-headlines",
            api_key=api_key,
            proxy_id=proxy_id,
            params={"category": "business", "language": "zh", "pageSize": min(limit, 100)},
        )
        data = resp.json()
        articles = data.get("articles") or []
        return [
            _build_news(
                title=a.get("title", ""),
                url=a.get("url", ""),
                source=(a.get("source") or {}).get("name", "NewsAPI"),
                content=a.get("description", ""),
                publish_time=a.get("publishedAt", ""),
            )
            for a in articles
        ]
    except Exception as e:
        logger.warning("newsapi financial failed: %s", e)
        return []


# ─── Mediastack ───

def get_news_mediastack(
    code: str = "",
    limit: int = 20,
    stock_name: str = "",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """Mediastack 新闻获取"""
    if not api_key:
        return []

    query = stock_name or code or "stock"
    try:
        resp = remote_get(
            "http://api.mediastack.com/v1/news",
            api_key=api_key,
            proxy_id=proxy_id,
            params={"keywords": query, "categories": "business", "languages": "zh", "limit": min(limit, 100)},
        )
        data = resp.json()
        articles = data.get("data") or []
        return [
            _build_news(
                title=a.get("title", ""),
                url=a.get("url", ""),
                source=a.get("source", "Mediastack"),
                content=a.get("description", ""),
                publish_time=a.get("published_at", ""),
            )
            for a in articles
        ]
    except Exception as e:
        logger.warning("mediastack failed: %s", e)
        return []


def get_financial_news_mediastack(
    limit: int = 20,
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """Mediastack 财经新闻"""
    if not api_key:
        return []
    try:
        resp = remote_get(
            "http://api.mediastack.com/v1/news",
            api_key=api_key,
            proxy_id=proxy_id,
            params={"categories": "business", "languages": "zh", "limit": min(limit, 100)},
        )
        data = resp.json()
        articles = data.get("data") or []
        return [
            _build_news(
                title=a.get("title", ""),
                url=a.get("url", ""),
                source=a.get("source", "Mediastack"),
                content=a.get("description", ""),
                publish_time=a.get("published_at", ""),
            )
            for a in articles
        ]
    except Exception as e:
        logger.warning("mediastack financial failed: %s", e)
        return []


# ─── Finnhub ───

def get_news_finnhub(
    code: str = "",
    limit: int = 20,
    stock_name: str = "",
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """Finnhub 公司新闻"""
    if not api_key:
        return []

    from datetime import datetime, timedelta

    symbol = code.strip().upper()
    today = datetime.now().strftime("%Y-%m-%d")
    week_ago = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

    try:
        resp = remote_get(
            "https://finnhub.io/api/v1/company-news",
            api_key=api_key,
            proxy_id=proxy_id,
            params={"symbol": symbol, "from": week_ago, "to": today},
        )
        articles = resp.json()
        if not isinstance(articles, list):
            return []
        return [
            _build_news(
                title=a.get("headline", ""),
                url=a.get("url", ""),
                source=a.get("source", "Finnhub"),
                content=a.get("summary", ""),
                publish_time=datetime.utcfromtimestamp(a.get("datetime", 0)).strftime("%Y-%m-%dT%H:%M:%SZ") if a.get("datetime") else "",
            )
            for a in articles[:limit]
        ]
    except Exception as e:
        logger.warning("finnhub news failed: %s", e)
        return []


def get_financial_news_finnhub(
    limit: int = 20,
    api_key: str | None = None,
    proxy_id: str | None = None,
    **kwargs,
) -> list[dict]:
    """Finnhub 市场新闻"""
    if not api_key:
        return []

    try:
        resp = remote_get(
            "https://finnhub.io/api/v1/news",
            api_key=api_key,
            proxy_id=proxy_id,
            params={"category": "general"},
        )
        articles = resp.json()
        if not isinstance(articles, list):
            return []
        from datetime import datetime
        return [
            _build_news(
                title=a.get("headline", ""),
                url=a.get("url", ""),
                source=a.get("source", "Finnhub"),
                content=a.get("summary", ""),
                publish_time=datetime.utcfromtimestamp(a.get("datetime", 0)).strftime("%Y-%m-%dT%H:%M:%SZ") if a.get("datetime") else "",
            )
            for a in articles[:limit]
        ]
    except Exception as e:
        logger.warning("finnhub financial news failed: %s", e)
        return []


# ─── Dispatch 映射 ───

STOCK_NEWS_REMOTE_FETCHERS: dict[str, callable] = {
    "rsshub": get_news_rsshub,
    "gnews": get_news_gnews,
    "newsapi": get_news_newsapi,
    "finnhub": get_news_finnhub,
}

FINANCIAL_NEWS_REMOTE_FETCHERS: dict[str, callable] = {
    "rsshub": get_financial_news_rsshub,
    "gnews": get_financial_news_gnews,
    "newsapi": get_financial_news_newsapi,
    "mediastack": get_financial_news_mediastack,
    "finnhub": get_financial_news_finnhub,
}
