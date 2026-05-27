from fastapi import APIRouter, Query
from app.services.sector_service import (
    get_sector_rank,
    get_concept_rank,
    get_sector_members,
    get_industry_kline,
    get_concept_kline,
    get_sector_fund_flow,
)

router = APIRouter()


@router.get("/industry")
async def industry_rank():
    data = get_sector_rank()
    return {"data": data}


@router.get("/concept")
async def concept_rank():
    data = get_concept_rank()
    return {"data": data}


@router.get("/members")
async def sector_members(
    codes: str = Query(default=""),
    pageSize: int = Query(default=120),
):
    data = get_sector_members(codes.split(",") if codes else [], pageSize)
    return {"data": data}


@router.get("/industry/kline")
async def industry_kline(
    name: str = Query(default=""),
    period: str = Query(default="daily"),
    adjust: str = Query(default="qfq"),
):
    if not name:
        return {"data": []}
    data = get_industry_kline(name, period, adjust)
    return {"data": data}


@router.get("/concept/kline")
async def concept_kline(
    name: str = Query(default=""),
    period: str = Query(default="daily"),
    adjust: str = Query(default="qfq"),
):
    if not name:
        return {"data": []}
    data = get_concept_kline(name, period, adjust)
    return {"data": data}


@router.get("/fund-flow")
async def sector_fund_flow(
    indicator: str = Query(default="今日"),
    sectorType: str = Query(default="行业资金流"),
):
    data = get_sector_fund_flow(indicator, sectorType)
    return {"data": data}
