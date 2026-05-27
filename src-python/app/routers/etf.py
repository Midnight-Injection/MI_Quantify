from fastapi import APIRouter, Query
from app.services.etf_service import get_etf_spot, get_etf_kline

router = APIRouter()


@router.get("/spot")
async def etf_spot():
    data = get_etf_spot()
    return {"data": data}


@router.get("/kline/{code}")
async def etf_kline(
    code: str,
    period: str = Query(default="daily"),
    adjust: str = Query(default="qfq"),
    limit: int = Query(default=0),
):
    data = get_etf_kline(code, period, adjust, limit or None)
    return {"data": data}
