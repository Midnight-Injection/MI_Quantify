from fastapi import APIRouter, Query
from typing import Optional
from app.services.market_service import (
    get_realtime_quotes,
    get_market_indices,
    get_advance_decline,
    ensure_ad_thread,
    get_stock_list,
    search_stocks,
)
from app.services.stock_service import get_stock_info, get_stock_finance
from app.services.news_service import get_stock_news as get_stock_news_feed
from app.services.sector_service import search_sectors

router = APIRouter()


@router.get("/quotes")
async def quotes(codes: str = Query(default=""), source: Optional[str] = Query(default=None)):
    code_list = codes.split(",") if codes else []
    data = get_realtime_quotes(code_list, preferred_source=source)
    return {"data": data}


@router.get("/indices")
async def indices(market: str = Query(default="a"), source: Optional[str] = Query(default=None)):
    data = get_market_indices(market, preferred_source=source)
    return {"data": data}


@router.get("/advance-decline")
async def advance_decline():
    ensure_ad_thread()
    data = get_advance_decline()
    return {"data": data}


@router.get("/stocks")
async def stock_list(
    market: str = Query(default="a"),
    page: int = Query(default=1),
    pageSize: int = Query(default=50),
):
    data = get_stock_list(market, page, pageSize)
    return data


@router.get("/search")
async def search(
    keyword: str = Query(default=""),
    limit: int = Query(default=8),
    lite: bool = Query(default=False),
    include_sectors: bool = Query(default=False),
):
    data = search_stocks(keyword, limit=limit, with_quotes=not lite)
    result: dict = {"data": data}
    if include_sectors and keyword:
        result["sectors"] = search_sectors(keyword, limit=5)
    return result


@router.get("/stock/{code}/info")
async def stock_info(code: str):
    info = get_stock_info(code)
    finance = get_stock_finance(code)
    return {"info": info, "finance": finance}


@router.get("/stock/{code}/news")
async def stock_news(code: str, source: Optional[str] = Query(default=None)):
    data = get_stock_news_feed(code, 15, preferred_source=source)
    return {"data": data}
