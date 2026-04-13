from fastapi import APIRouter, Query
from typing import Optional
from app.services.kline_service import get_kline

router = APIRouter()


@router.get("/{code}")
async def kline(
    code: str,
    period: str = Query(default="daily"),
    start_date: Optional[str] = Query(default=None),
    end_date: Optional[str] = Query(default=None),
    adjust: str = Query(default="qfq"),
    limit: Optional[int] = Query(default=None),
):
    data = get_kline(code, period, start_date, end_date, adjust, limit)
    return {"data": data}
