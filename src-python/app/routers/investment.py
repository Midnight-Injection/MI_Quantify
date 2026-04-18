from fastapi import APIRouter, Query

from app.services.investment_service import (
    bank_official_search,
    get_bank_deposit_rates,
    get_fund_history,
    get_fund_profile,
    get_fund_rating,
    search_bank_fund_shelf,
    search_funds,
)

router = APIRouter()


@router.get("/funds/search")
async def funds_search(
    query: str = Query(default=""),
    limit: int = Query(default=20),
):
    return {"data": search_funds(query, limit)}


@router.get("/funds/profile/{code}")
async def funds_profile(code: str):
    return {"data": get_fund_profile(code)}


@router.get("/funds/history/{code}")
async def funds_history(code: str, limit: int = Query(default=60)):
    return {"data": get_fund_history(code, limit)}


@router.get("/funds/rating/{code}")
async def funds_rating(code: str):
    return {"data": get_fund_rating(code)}


@router.get("/bank/deposit-rates")
async def bank_deposit_rates(bank: str = Query(default="中国银行")):
    return {"data": get_bank_deposit_rates(bank)}


@router.get("/bank/fund-shelf")
async def bank_fund_shelf(
    bank: str = Query(default="中国银行"),
    keyword: str = Query(default=""),
    limit: int = Query(default=20),
    includeWealth: bool = Query(default=True),
):
    return {"data": search_bank_fund_shelf(bank, keyword, limit, includeWealth)}


@router.get("/bank/official-search")
async def official_search(
    bank: str = Query(default="中国银行"),
    keyword: str = Query(default=""),
    limit: int = Query(default=10),
):
    return {"data": bank_official_search(bank, keyword, limit)}
