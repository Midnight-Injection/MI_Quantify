from fastapi import APIRouter, Query
from app.services.fundflow_service import get_fund_flow

router = APIRouter()


@router.get("/rank")
async def fund_flow_rank(limit: int = Query(default=50)):
    data = get_fund_flow(limit)
    return {"data": data}
