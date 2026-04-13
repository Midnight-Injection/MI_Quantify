from fastapi import APIRouter, Query
from app.services.sector_service import get_sector_rank, get_concept_rank, get_sector_members

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
