from fastapi import APIRouter, Body, Query
from app.services.news_service import (
    get_context_news,
    get_financial_news,
    get_stock_news,
    search_news as fallback_search_news,
)
from app.services.search_service import search_with_providers

router = APIRouter()


@router.get("/financial")
async def financial_news(limit: int = Query(default=50)):
    data = get_financial_news(limit)
    return {"data": data}


@router.get("/stock/{code}")
async def stock_news(
    code: str, limit: int = Query(default=20), name: str = Query(default="")
):
    data = get_stock_news(code, limit, name)
    return {"data": data}


@router.get("/context/{code}")
async def context_news(
    code: str, limit: int = Query(default=20), name: str = Query(default="")
):
    data = get_context_news(code, limit, name)
    return {"data": data}


@router.post("/search")
async def search_news(payload: dict = Body(default={})):
    query = str(payload.get("query", "") or "").strip()
    providers = payload.get("providers", []) or []
    limit = int(payload.get("limit", 8) or 8)
    if not query:
        return {"data": []}
    data = search_with_providers(query, providers, limit) if providers else []
    if not data:
        data = fallback_search_news(query, limit)
    return {"data": [_normalize_search_item(item) for item in data]}


def _normalize_search_item(item: dict) -> dict:
    return {
        "title": item.get("title", ""),
        "content": item.get("content", ""),
        "link": item.get("link") or item.get("url", ""),
        "media": item.get("media") or item.get("source", ""),
        "providerId": item.get("providerId") or item.get("source", "fallback"),
        "providerName": item.get("providerName") or item.get("source", "fallback"),
    }
