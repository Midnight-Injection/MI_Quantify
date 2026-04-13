from fastapi import APIRouter, Query
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

router = APIRouter()


@router.get("/quotes")
async def quotes(codes: str = Query(default="")):
    code_list = codes.split(",") if codes else []
    data = get_realtime_quotes(code_list)
    return {"data": data}


@router.get("/indices")
async def indices(market: str = Query(default="a")):
    data = get_market_indices(market)
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
async def search(keyword: str = Query(default="")):
    data = search_stocks(keyword)
    return {"data": data}


@router.get("/stock/{code}/info")
async def stock_info(code: str):
    info = get_stock_info(code)
    finance = get_stock_finance(code)
    return {"info": info, "finance": finance}


@router.get("/stock/{code}/news")
async def stock_news(code: str):
    data = get_stock_news_feed(code, 15)
    return {"data": data}
