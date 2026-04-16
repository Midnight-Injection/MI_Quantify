from fastapi import APIRouter
from app.services.finance_service import (
    get_financial_summary,
    get_financial_report,
    get_income_statement,
    get_cashflow_statement,
)

router = APIRouter()


@router.get("/summary/{code}")
async def financial_summary(code: str):
    data = get_financial_summary(code)
    return {"data": data}


@router.get("/balance/{code}")
async def balance_sheet(code: str):
    data = get_financial_report(code, "资产负债表")
    return {"data": data}


@router.get("/income/{code}")
async def income_statement(code: str):
    data = get_income_statement(code)
    return {"data": data}


@router.get("/cashflow/{code}")
async def cashflow_statement(code: str):
    data = get_cashflow_statement(code)
    return {"data": data}
