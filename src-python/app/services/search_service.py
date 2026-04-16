from __future__ import annotations

from typing import Any
from urllib.parse import quote_plus

from app.services.network_env import create_http_session

KEY_REQUIRED_PROVIDERS = {"zhipu", "brave", "tavily", "serpapi", "serper", "exa"}


def _session_for(api_url: str, proxy_id: str | None = None):
    return create_http_session(target_url=api_url, proxy_id=proxy_id)


def search_with_providers(query: str, providers: list[dict], limit: int = 8) -> list[dict]:
    normalized_query = str(query or "").strip()
    if not normalized_query:
        return []

    normalized_limit = _normalize_limit(limit)
    merged: list[dict] = []
    for provider in providers[:6]:
        if not provider.get("enabled", True):
            continue

        provider_type = str(provider.get("provider", "") or "").strip().lower()
        provider_id = str(provider.get("id", "") or provider_type or "search")
        provider_name = str(provider.get("name", "") or provider_id)
        api_url = str(provider.get("apiUrl", "") or "").strip()
        api_key = str(provider.get("apiKey", "") or "").strip()
        proxy_id = str(provider.get("proxyId", "") or "").strip() or None
        if not api_url:
            continue
        if provider_type in KEY_REQUIRED_PROVIDERS and not api_key:
            continue

        try:
            if provider_type == "zhipu":
                items = _search_zhipu(api_url, api_key, normalized_query, normalized_limit, provider_id, provider_name, proxy_id)
            elif provider_type == "searxng":
                items = _search_searxng(api_url, api_key, normalized_query, normalized_limit, provider_id, provider_name, proxy_id)
            elif provider_type == "yacy":
                items = _search_yacy(api_url, api_key, normalized_query, normalized_limit, provider_id, provider_name, proxy_id)
            elif provider_type == "brave":
                items = _search_brave(api_url, api_key, normalized_query, normalized_limit, provider_id, provider_name, proxy_id)
            elif provider_type == "tavily":
                items = _search_tavily(api_url, api_key, normalized_query, normalized_limit, provider_id, provider_name, proxy_id)
            elif provider_type == "serpapi":
                items = _search_serpapi(api_url, api_key, normalized_query, normalized_limit, provider_id, provider_name, proxy_id)
            elif provider_type == "serper":
                items = _search_serper(api_url, api_key, normalized_query, normalized_limit, provider_id, provider_name, proxy_id)
            elif provider_type == "exa":
                items = _search_exa(api_url, api_key, normalized_query, normalized_limit, provider_id, provider_name, proxy_id)
            else:
                items = _search_custom(api_url, api_key, normalized_query, normalized_limit, provider_id, provider_name, proxy_id)
            merged.extend(items)
        except Exception as exc:
            print(f"[search] provider {provider_id} failed: {exc}")

    return _dedupe_results(merged)[:normalized_limit]


def _normalize_limit(limit: int) -> int:
    try:
        numeric = int(limit)
    except Exception:
        numeric = 12
    return max(8, min(numeric, 24))


def _search_zhipu(
    api_url: str,
    api_key: str,
    query: str,
    limit: int,
    provider_id: str,
    provider_name: str,
    proxy_id: str | None = None,
) -> list[dict]:
    response = _session_for(api_url, proxy_id).post(
        api_url,
        headers=_build_json_headers(api_key),
        json={
            "search_query": query,
            "search_engine": "search_std",
            "count": max(8, min(limit, 12)),
            "search_intent": True,
        },
        timeout=18,
    )
    response.raise_for_status()
    payload = response.json()
    return _map_items(
        payload.get("search_result")
        or payload.get("results")
        or payload.get("data")
        or payload.get("searchResults")
        or [],
        provider_id,
        provider_name,
    )


def _search_searxng(
    api_url: str,
    api_key: str,
    query: str,
    limit: int,
    provider_id: str,
    provider_name: str,
    proxy_id: str | None = None,
) -> list[dict]:
    endpoint = _ensure_suffix(api_url, "/search")
    response = _session_for(endpoint, proxy_id).get(
        endpoint,
        headers=_build_json_headers(api_key),
        params={
            "q": query,
            "format": "json",
            "language": "zh-CN",
            "time_range": "day",
            "safesearch": 0,
        },
        timeout=18,
    )
    response.raise_for_status()
    payload = response.json()
    return _map_items(payload.get("results") or [], provider_id, provider_name)


def _search_yacy(
    api_url: str,
    api_key: str,
    query: str,
    limit: int,
    provider_id: str,
    provider_name: str,
    proxy_id: str | None = None,
) -> list[dict]:
    endpoint = api_url.rstrip("/")
    if not endpoint.endswith(".json"):
        endpoint = _ensure_suffix(endpoint, "/yacysearch.json")
    response = _session_for(endpoint, proxy_id).get(
        endpoint,
        headers=_build_json_headers(api_key),
        params={
            "query": query,
            "maximumRecords": max(8, min(limit, 12)),
            "resource": "global",
            "verify": "false",
            "contentdom": "text",
        },
        timeout=18,
    )
    response.raise_for_status()
    payload = response.json()
    items: list[dict[str, Any]] = []
    if isinstance(payload.get("channels"), list):
        for channel in payload["channels"]:
            if isinstance(channel, dict) and isinstance(channel.get("items"), list):
                items.extend(channel["items"])
    if not items and isinstance(payload.get("items"), list):
        items.extend(payload["items"])
    return _map_items(items, provider_id, provider_name)


def _search_brave(
    api_url: str,
    api_key: str,
    query: str,
    limit: int,
    provider_id: str,
    provider_name: str,
    proxy_id: str | None = None,
) -> list[dict]:
    response = _session_for(api_url, proxy_id).get(
        api_url.rstrip("/"),
        headers={
            "Accept": "application/json",
            "X-Subscription-Token": api_key,
        },
        params={
            "q": query,
            "count": max(8, min(limit, 20)),
            "search_lang": "zh-hans",
            "result_filter": "web,news",
            "safesearch": "off",
        },
        timeout=18,
    )
    response.raise_for_status()
    payload = response.json()
    items = [
        *[item for item in payload.get("web", {}).get("results", []) if isinstance(item, dict)],
        *[item for item in payload.get("news", {}).get("results", []) if isinstance(item, dict)],
    ]
    return _map_items(items, provider_id, provider_name)


def _search_tavily(
    api_url: str,
    api_key: str,
    query: str,
    limit: int,
    provider_id: str,
    provider_name: str,
    proxy_id: str | None = None,
) -> list[dict]:
    response = _session_for(api_url, proxy_id).post(
        api_url.rstrip("/"),
        headers=_build_json_headers(),
        json={
            "api_key": api_key,
            "query": query,
            "topic": "news",
            "search_depth": "advanced",
            "max_results": max(8, min(limit, 15)),
            "include_answer": False,
            "include_images": False,
            "include_raw_content": False,
        },
        timeout=20,
    )
    response.raise_for_status()
    payload = response.json()
    return _map_items(payload.get("results") or [], provider_id, provider_name)


def _search_serpapi(
    api_url: str,
    api_key: str,
    query: str,
    limit: int,
    provider_id: str,
    provider_name: str,
    proxy_id: str | None = None,
) -> list[dict]:
    response = _session_for(api_url, proxy_id).get(
        api_url.rstrip("/"),
        params={
            "q": query,
            "api_key": api_key,
            "engine": "google",
            "google_domain": "google.com",
            "hl": "zh-cn",
            "gl": "cn",
            "num": max(8, min(limit, 20)),
        },
        timeout=18,
    )
    response.raise_for_status()
    payload = response.json()
    items = [
        *[item for item in payload.get("organic_results", []) if isinstance(item, dict)],
        *[item for item in payload.get("news_results", []) if isinstance(item, dict)],
    ]
    return _map_items(items, provider_id, provider_name)


def _search_serper(
    api_url: str,
    api_key: str,
    query: str,
    limit: int,
    provider_id: str,
    provider_name: str,
    proxy_id: str | None = None,
) -> list[dict]:
    response = _session_for(api_url, proxy_id).post(
        api_url.rstrip("/"),
        headers={
            "Content-Type": "application/json",
            "X-API-KEY": api_key,
        },
        json={
            "q": query,
            "gl": "cn",
            "hl": "zh-cn",
            "num": max(8, min(limit, 20)),
            "autocorrect": True,
            "tbs": "qdr:d",
        },
        timeout=18,
    )
    response.raise_for_status()
    payload = response.json()
    items = [
        *[item for item in payload.get("organic", []) if isinstance(item, dict)],
        *[item for item in payload.get("news", []) if isinstance(item, dict)],
    ]
    return _map_items(items, provider_id, provider_name)


def _search_exa(
    api_url: str,
    api_key: str,
    query: str,
    limit: int,
    provider_id: str,
    provider_name: str,
    proxy_id: str | None = None,
) -> list[dict]:
    response = _session_for(api_url, proxy_id).post(
        api_url.rstrip("/"),
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
        },
        json={
            "query": query,
            "type": "auto",
            "numResults": max(8, min(limit, 10)),
            "contents": {
                "text": True,
                "highlights": {
                    "numSentences": 2,
                    "highlightsPerUrl": 2,
                },
            },
        },
        timeout=18,
    )
    response.raise_for_status()
    payload = response.json()
    return _map_items(payload.get("results") or [], provider_id, provider_name)


def _search_custom(
    api_url: str,
    api_key: str,
    query: str,
    limit: int,
    provider_id: str,
    provider_name: str,
    proxy_id: str | None = None,
) -> list[dict]:
    headers = _build_json_headers(api_key)
    if "{query}" in api_url or "{limit}" in api_url:
        endpoint = (
            api_url.replace("{query}", quote_plus(query))
            .replace("{query_raw}", query)
            .replace("{limit}", str(limit))
        )
        response = _session_for(endpoint, proxy_id).get(endpoint, headers=headers, timeout=18)
        response.raise_for_status()
        return _map_items(_extract_items(response.json()), provider_id, provider_name)

    response = _session_for(api_url, proxy_id).post(
        api_url,
        headers=headers,
        json={
            "query": query,
            "limit": limit,
            "search_query": query,
            "count": limit,
        },
        timeout=18,
    )

    if response.ok:
        return _map_items(_extract_items(response.json()), provider_id, provider_name)

    fallback = _session_for(api_url, proxy_id).get(
        api_url,
        headers=headers,
        params={"q": query, "query": query, "limit": limit},
        timeout=18,
    )
    fallback.raise_for_status()
    return _map_items(_extract_items(fallback.json()), provider_id, provider_name)


def _build_json_headers(api_key: str = "") -> dict:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _ensure_suffix(api_url: str, suffix: str) -> str:
    endpoint = api_url.rstrip("/")
    return endpoint if endpoint.endswith(suffix.lstrip("/")) else f"{endpoint}{suffix}"


def _extract_items(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    if isinstance(payload.get("channels"), list):
        items: list[dict] = []
        for channel in payload["channels"]:
            if isinstance(channel, dict) and isinstance(channel.get("items"), list):
                items.extend(item for item in channel["items"] if isinstance(item, dict))
        if items:
            return items
    for key in ("search_result", "results", "data", "searchResults", "items"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _map_items(items: list[dict], provider_id: str, provider_name: str) -> list[dict]:
    mapped: list[dict] = []
    for item in items:
        highlights = item.get("highlights")
        highlights_text = " ".join(highlights[:2]) if isinstance(highlights, list) else ""
        title = str(item.get("title") or item.get("name") or item.get("subject") or "").strip()
        link = str(item.get("link") or item.get("url") or item.get("guid") or item.get("href") or "").strip()
        content = str(
            item.get("content")
            or item.get("snippet")
            or item.get("summary")
            or item.get("description")
            or item.get("text")
            or highlights_text
            or "",
        ).strip()
        media = str(
            item.get("media")
            or item.get("source")
            or item.get("engine")
            or item.get("published_source")
            or provider_name
        ).strip()
        if not title and not content:
            continue
        mapped.append(
            {
                "title": title or "外部搜索结果",
                "content": content,
                "link": link,
                "media": media or provider_name,
                "providerId": provider_id,
                "providerName": provider_name,
            }
        )
    return mapped


def _dedupe_results(items: list[dict]) -> list[dict]:
    seen = set()
    result: list[dict] = []
    for item in items:
        key = item.get("link") or item.get("title") or f"{item.get('providerId')}:{item.get('content')}"
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result
