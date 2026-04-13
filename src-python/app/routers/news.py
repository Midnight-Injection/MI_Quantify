from fastapi import APIRouter, Body, Query
from app.services.news_service import get_context_news, get_financial_news, get_stock_news
from app.services.search_service import search_with_providers

router = APIRouter()


@router.get("/financial")
async def financial_news(limit: int = Query(default=50)):
    data = get_financial_news(limit)
    return {"data": data}


@router.get("/stock/{code}")
async def stock_news(code: str, limit: int = Query(default=20)):
    data = get_stock_news(code, limit)
    return {"data": data}


@router.get("/context/{code}")
async def context_news(code: str, limit: int = Query(default=20)):
    data = get_context_news(code, limit)
    return {"data": data}


@router.post("/search")
async def search_news(payload: dict = Body(default={})):
    query = str(payload.get("query", "") or "").strip()
    providers = payload.get("providers", []) or []
    limit = int(payload.get("limit", 8) or 8)
    if not query or not providers:
        return {"data": []}
    data = search_with_providers(query, providers, limit)
    return {"data": data}
