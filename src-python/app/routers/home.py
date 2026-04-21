from fastapi import APIRouter, Query

from app.services.home_service import (
    get_home_ai_context,
    get_home_fundflow,
    get_home_news,
    get_home_overview,
    get_home_sectors,
    get_home_stocks,
)

router = APIRouter()


@router.get("/overview")
async def overview(market: str = Query(default="a")):
    return {"data": get_home_overview(market)}


@router.get("/fundflow")
async def fundflow(market: str = Query(default="a")):
    return {"data": get_home_fundflow(market)}


@router.get("/sectors")
async def sectors(market: str = Query(default="a")):
    return {"data": get_home_sectors(market)}


@router.get("/stocks")
async def stocks(market: str = Query(default="a")):
    return {"data": get_home_stocks(market)}


@router.get("/news")
async def news(market: str = Query(default="a")):
    return {"data": get_home_news(market)}


@router.get("/ai-context")
async def ai_context(market: str = Query(default="a")):
    return {"data": get_home_ai_context(market)}
