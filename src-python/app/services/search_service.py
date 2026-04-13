from __future__ import annotations

from typing import Any

from app.services.network_env import create_http_session

_http = create_http_session()


def search_with_providers(query: str, providers: list[dict], limit: int = 8) -> list[dict]:
    normalized_query = str(query or "").strip()
    if not normalized_query:
        return []

    merged: list[dict] = []
    for provider in providers[:4]:
        if not provider.get("enabled", True):
            continue

        provider_type = str(provider.get("provider", "") or "").strip().lower()
        provider_id = str(provider.get("id", "") or provider_type or "search")
        provider_name = str(provider.get("name", "") or provider_id)
        api_url = str(provider.get("apiUrl", "") or "").strip()
        api_key = str(provider.get("apiKey", "") or "").strip()
        if not api_url:
            continue

        try:
            if provider_type == "zhipu":
                items = _search_zhipu(api_url, api_key, normalized_query, limit, provider_id, provider_name)
            elif provider_type == "searxng":
                items = _search_searxng(api_url, api_key, normalized_query, limit, provider_id, provider_name)
            elif provider_type == "yacy":
                items = _search_yacy(api_url, api_key, normalized_query, limit, provider_id, provider_name)
            else:
                items = _search_custom(api_url, api_key, normalized_query, limit, provider_id, provider_name)
            merged.extend(items)
        except Exception as exc:
            print(f"[search] provider {provider_id} failed: {exc}")

    return _dedupe_results(merged)[: max(1, min(limit, 12))]


def _search_zhipu(
    api_url: str,
    api_key: str,
    query: str,
    limit: int,
    provider_id: str,
    provider_name: str,
) -> list[dict]:
    response = _http.post(
        api_url,
        headers=_build_headers(api_key),
        json={
            "search_query": query,
            "search_engine": "search_std",
            "count": max(4, min(limit, 10)),
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
) -> list[dict]:
    endpoint = _ensure_suffix(api_url, "/search")
    response = _http.get(
        endpoint,
        headers=_build_headers(api_key),
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
) -> list[dict]:
    endpoint = api_url.rstrip("/")
    if not endpoint.endswith(".json"):
        endpoint = _ensure_suffix(endpoint, "/yacysearch.json")
    response = _http.get(
        endpoint,
        headers=_build_headers(api_key),
        params={
            "query": query,
            "maximumRecords": max(4, min(limit, 10)),
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


def _search_custom(
    api_url: str,
    api_key: str,
    query: str,
    limit: int,
    provider_id: str,
    provider_name: str,
) -> list[dict]:
    headers = _build_headers(api_key)
    if "{query}" in api_url or "{limit}" in api_url:
        endpoint = api_url.replace("{query}", query).replace("{limit}", str(limit))
        response = _http.get(endpoint, headers=headers, timeout=18)
        response.raise_for_status()
        return _map_items(_extract_items(response.json()), provider_id, provider_name)

    response = _http.post(
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

    fallback = _http.get(
        api_url,
        headers=headers,
        params={"q": query, "query": query, "limit": limit},
        timeout=18,
    )
    fallback.raise_for_status()
    return _map_items(_extract_items(fallback.json()), provider_id, provider_name)


def _build_headers(api_key: str) -> dict:
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
        title = str(item.get("title") or item.get("name") or item.get("subject") or "").strip()
        link = str(item.get("link") or item.get("url") or item.get("guid") or "").strip()
        content = str(
            item.get("content")
            or item.get("snippet")
            or item.get("summary")
            or item.get("description")
            or "",
        ).strip()
        media = str(
            item.get("media")
            or item.get("source")
            or item.get("engine")
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
