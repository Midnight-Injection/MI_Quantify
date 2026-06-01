"""
财务报表远程数据源适配器

支持的源：fmp, alphavantage, finnhub, eodhd, tushare, jqdata, rqdata

标准输出格式（资产负债表）：
{reportDate, totalAssets, totalLiabilities, totalEquity, currentAssets,
 currentLiabilities, cash, accountsReceivable, inventory, fixedAssets,
 goodwill, longTermInvestment, shortTermBorrowings, longTermBorrowings,
 paidInCapital, capitalReserve, surplusReserve, retainedEarnings,
 isAudited, announcementDate}

标准输出格式（利润表）：
{reportDate, totalRevenue, operatingRevenue, totalCost, operatingCost,
 sellingExpense, adminExpense, financeExpense, rdExpense, operatingProfit,
 totalProfit, netProfit, netProfitAttributable, eps}

标准输出格式（现金流量表）：
{reportDate, operatingCashFlow, investingCashFlow, financingCashFlow,
 cashReceipts, cashPayments, capex}
"""

import json
import logging
from datetime import datetime
from typing import Optional

from .remote_api import (
    remote_get,
    remote_post,
    safe_float,
    code_to_alphavantage_symbol,
    code_to_eodhd_symbol,
    code_to_fmp_symbol,
)

logger = logging.getLogger(__name__)


def _to_num(val) -> float:
    import math
    try:
        v = float(val)
        if math.isnan(v) or math.isinf(v):
            return 0
        return v
    except Exception:
        return 0


# ═══════════════════════════════════════
# FMP (Financial Modeling Prep)
# ═══════════════════════════════════════

def get_balance_sheet_fmp(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    symbol = code_to_fmp_symbol(code)
    resp = remote_get(
        f"https://financialmodelingprep.com/api/v3/balance-sheet-statement/{symbol}",
        api_key=api_key, proxy_id=proxy_id, params={"limit": "4"},
    )
    rows = resp.json()
    result = []
    for item in rows[:4]:
        entry = {"reportDate": item.get("date", "")}
        entry["totalAssets"] = _to_num(item.get("totalAssets"))
        entry["totalLiabilities"] = _to_num(item.get("totalLiabilities"))
        entry["totalEquity"] = _to_num(item.get("totalStockholdersEquity"))
        entry["currentAssets"] = _to_num(item.get("totalCurrentAssets"))
        entry["currentLiabilities"] = _to_num(item.get("totalCurrentLiabilities"))
        entry["cash"] = _to_num(item.get("cashAndCashEquivalents"))
        entry["accountsReceivable"] = _to_num(item.get("netReceivables"))
        entry["inventory"] = _to_num(item.get("inventory"))
        entry["fixedAssets"] = _to_num(item.get("propertyPlantEquipmentNet"))
        entry["goodwill"] = _to_num(item.get("goodwill"))
        entry["longTermInvestment"] = _to_num(item.get("longTermInvestments"))
        entry["shortTermBorrowings"] = _to_num(item.get("shortTermDebt"))
        entry["longTermBorrowings"] = _to_num(item.get("longTermDebt"))
        entry["paidInCapital"] = _to_num(item.get("commonStock"))
        entry["capitalReserve"] = _to_num(item.get("additionalPaidInCapital"))
        entry["retainedEarnings"] = _to_num(item.get("retainedEarnings"))
        entry["surplusReserve"] = 0
        entry["isAudited"] = ""
        entry["announcementDate"] = item.get("fillingDate", "")
        result.append(entry)
    return result


def get_income_statement_fmp(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    symbol = code_to_fmp_symbol(code)
    resp = remote_get(
        f"https://financialmodelingprep.com/api/v3/income-statement/{symbol}",
        api_key=api_key, proxy_id=proxy_id, params={"limit": "4"},
    )
    rows = resp.json()
    result = []
    for item in rows[:4]:
        entry = {"reportDate": item.get("date", "")}
        entry["totalRevenue"] = _to_num(item.get("revenue"))
        entry["operatingRevenue"] = _to_num(item.get("revenue"))
        entry["totalCost"] = _to_num(item.get("costAndExpenses"))
        entry["operatingCost"] = _to_num(item.get("costOfRevenue"))
        entry["sellingExpense"] = _to_num(item.get("sellingGeneralAndAdministrativeExpenses"))
        entry["adminExpense"] = 0
        entry["financeExpense"] = _to_num(item.get("interestExpense"))
        entry["rdExpense"] = _to_num(item.get("researchAndDevelopmentExpenses"))
        entry["operatingProfit"] = _to_num(item.get("operatingIncome"))
        entry["totalProfit"] = _to_num(item.get("incomeBeforeTax"))
        entry["netProfit"] = _to_num(item.get("netIncome"))
        entry["netProfitAttributable"] = _to_num(item.get("netIncome"))
        entry["eps"] = _to_num(item.get("eps"))
        result.append(entry)
    return result


def get_cashflow_statement_fmp(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    symbol = code_to_fmp_symbol(code)
    resp = remote_get(
        f"https://financialmodelingprep.com/api/v3/cash-flow-statement/{symbol}",
        api_key=api_key, proxy_id=proxy_id, params={"limit": "4"},
    )
    rows = resp.json()
    result = []
    for item in rows[:4]:
        entry = {"reportDate": item.get("date", "")}
        entry["operatingCashFlow"] = _to_num(item.get("netCashProvidedByOperatingActivities"))
        entry["investingCashFlow"] = _to_num(item.get("netCashUsedForInvestingActivites"))
        entry["financingCashFlow"] = _to_num(item.get("netCashUsedProvidedByFinancingActivities"))
        entry["cashReceipts"] = 0
        entry["cashPayments"] = 0
        entry["capex"] = _to_num(item.get("capitalExpenditure"))
        result.append(entry)
    return result


# ═══════════════════════════════════════
# Alpha Vantage
# ═══════════════════════════════════════

def get_balance_sheet_alphavantage(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    symbol = code_to_alphavantage_symbol(code)
    resp = remote_get(
        "https://www.alphavantage.co/query",
        api_key=api_key, proxy_id=proxy_id,
        params={"function": "BALANCE_SHEET", "symbol": symbol},
    )
    data = resp.json()
    reports = data.get("annualReports", [])[:4]
    result = []
    for item in reports:
        entry = {"reportDate": item.get("fiscalDateEnding", "")}
        entry["totalAssets"] = _to_num(item.get("totalAssets"))
        entry["totalLiabilities"] = _to_num(item.get("totalLiabilities"))
        entry["totalEquity"] = _to_num(item.get("totalShareholderEquity"))
        entry["currentAssets"] = _to_num(item.get("totalCurrentAssets"))
        entry["currentLiabilities"] = _to_num(item.get("totalCurrentLiabilities"))
        entry["cash"] = _to_num(item.get("cashAndCashEquivalentsAtEndOfPeriod"))
        entry["accountsReceivable"] = _to_num(item.get("currentAccountsReceivable"))
        entry["inventory"] = _to_num(item.get("inventory"))
        entry["fixedAssets"] = _to_num(item.get("propertyPlantEquipment"))
        entry["goodwill"] = _to_num(item.get("goodwill"))
        entry["longTermInvestment"] = _to_num(item.get("longTermInvestments"))
        entry["shortTermBorrowings"] = _to_num(item.get("shortTermDebt"))
        entry["longTermBorrowings"] = _to_num(item.get("longTermDebt"))
        entry["paidInCapital"] = _to_num(item.get("commonStock"))
        entry["capitalReserve"] = _to_num(item.get("additionalPaidInCapital"))
        entry["retainedEarnings"] = _to_num(item.get("retainedEarnings"))
        entry["surplusReserve"] = 0
        entry["isAudited"] = item.get("audited", "")
        entry["announcementDate"] = ""
        result.append(entry)
    return result


def get_income_statement_alphavantage(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    symbol = code_to_alphavantage_symbol(code)
    resp = remote_get(
        "https://www.alphavantage.co/query",
        api_key=api_key, proxy_id=proxy_id,
        params={"function": "INCOME_STATEMENT", "symbol": symbol},
    )
    data = resp.json()
    reports = data.get("annualReports", [])[:4]
    result = []
    for item in reports:
        entry = {"reportDate": item.get("fiscalDateEnding", "")}
        entry["totalRevenue"] = _to_num(item.get("totalRevenue"))
        entry["operatingRevenue"] = _to_num(item.get("totalRevenue"))
        entry["totalCost"] = _to_num(item.get("totalOperatingExpense"))
        entry["operatingCost"] = _to_num(item.get("costOfRevenue"))
        entry["sellingExpense"] = _to_num(item.get("sellingGeneralAndAdministrative"))
        entry["adminExpense"] = 0
        entry["financeExpense"] = _to_num(item.get("interestExpense"))
        entry["rdExpense"] = _to_num(item.get("researchAndDevelopment"))
        entry["operatingProfit"] = _to_num(item.get("operatingIncome"))
        entry["totalProfit"] = _to_num(item.get("incomeBeforeTax"))
        entry["netProfit"] = _to_num(item.get("netIncome"))
        entry["netProfitAttributable"] = _to_num(item.get("netIncome"))
        entry["eps"] = _to_num(item.get("eps"))
        result.append(entry)
    return result


def get_cashflow_statement_alphavantage(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    symbol = code_to_alphavantage_symbol(code)
    resp = remote_get(
        "https://www.alphavantage.co/query",
        api_key=api_key, proxy_id=proxy_id,
        params={"function": "CASH_FLOW", "symbol": symbol},
    )
    data = resp.json()
    reports = data.get("annualReports", [])[:4]
    result = []
    for item in reports:
        entry = {"reportDate": item.get("fiscalDateEnding", "")}
        entry["operatingCashFlow"] = _to_num(item.get("operatingCashflow"))
        entry["investingCashFlow"] = _to_num(item.get("cashflowFromInvestment"))
        entry["financingCashFlow"] = _to_num(item.get("cashflowFromFinancing"))
        entry["cashReceipts"] = 0
        entry["cashPayments"] = 0
        entry["capex"] = _to_num(item.get("capitalExpenditures"))
        result.append(entry)
    return result


# ═══════════════════════════════════════
# Finnhub
# ═══════════════════════════════════════

def get_balance_sheet_finnhub(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    symbol = code_to_fmp_symbol(code)
    resp = remote_get(
        "https://finnhub.io/api/v1/stock/financials",
        api_key=api_key, header_api_key_name="X-Finnhub-Token",
        proxy_id=proxy_id,
        params={"symbol": symbol, "statement": "bs", "freq": "annual"},
    )
    data = resp.json()
    items = data.get("financials", [])[:4]
    result = []
    for item in items:
        entry = {"reportDate": item.get("period", "")}
        entry["totalAssets"] = _to_num(item.get("totalAssets"))
        entry["totalLiabilities"] = _to_num(item.get("totalLiabilities"))
        entry["totalEquity"] = _to_num(item.get("totalEquity"))
        entry["currentAssets"] = 0
        entry["currentLiabilities"] = 0
        entry["cash"] = _to_num(item.get("cash"))
        entry["accountsReceivable"] = 0
        entry["inventory"] = 0
        entry["fixedAssets"] = 0
        entry["goodwill"] = 0
        entry["longTermInvestment"] = 0
        entry["shortTermBorrowings"] = 0
        entry["longTermBorrowings"] = _to_num(item.get("longTermDebt"))
        entry["paidInCapital"] = 0
        entry["capitalReserve"] = 0
        entry["retainedEarnings"] = 0
        entry["surplusReserve"] = 0
        entry["isAudited"] = ""
        entry["announcementDate"] = item.get("filed", "")
        result.append(entry)
    return result


def get_income_statement_finnhub(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    symbol = code_to_fmp_symbol(code)
    resp = remote_get(
        "https://finnhub.io/api/v1/stock/financials",
        api_key=api_key, header_api_key_name="X-Finnhub-Token",
        proxy_id=proxy_id,
        params={"symbol": symbol, "statement": "ic", "freq": "annual"},
    )
    data = resp.json()
    items = data.get("financials", [])[:4]
    result = []
    for item in items:
        entry = {"reportDate": item.get("period", "")}
        entry["totalRevenue"] = _to_num(item.get("revenue"))
        entry["operatingRevenue"] = _to_num(item.get("revenue"))
        entry["totalCost"] = _to_num(item.get("costOfRevenue"))
        entry["operatingCost"] = _to_num(item.get("costOfRevenue"))
        entry["sellingExpense"] = _to_num(item.get("sellingGeneralAndAdministrative"))
        entry["adminExpense"] = 0
        entry["financeExpense"] = _to_num(item.get("interestExpense"))
        entry["rdExpense"] = _to_num(item.get("researchAndDevelopment"))
        entry["operatingProfit"] = _to_num(item.get("operatingIncome"))
        entry["totalProfit"] = _to_num(item.get("incomeBeforeTax"))
        entry["netProfit"] = _to_num(item.get("netIncome"))
        entry["netProfitAttributable"] = 0
        entry["eps"] = _to_num(item.get("eps"))
        result.append(entry)
    return result


def get_cashflow_statement_finnhub(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    symbol = code_to_fmp_symbol(code)
    resp = remote_get(
        "https://finnhub.io/api/v1/stock/financials",
        api_key=api_key, header_api_key_name="X-Finnhub-Token",
        proxy_id=proxy_id,
        params={"symbol": symbol, "statement": "cf", "freq": "annual"},
    )
    data = resp.json()
    items = data.get("financials", [])[:4]
    result = []
    for item in items:
        entry = {"reportDate": item.get("period", "")}
        entry["operatingCashFlow"] = _to_num(item.get("cashFlowFromOperatingActivities"))
        entry["investingCashFlow"] = _to_num(item.get("cashFlowFromInvestingActivities"))
        entry["financingCashFlow"] = _to_num(item.get("cashFlowFromFinancingActivities"))
        entry["cashReceipts"] = 0
        entry["cashPayments"] = 0
        entry["capex"] = _to_num(item.get("capitalExpenditure"))
        result.append(entry)
    return result


# ═══════════════════════════════════════
# EODHD
# ═══════════════════════════════════════

def get_balance_sheet_eodhd(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    symbol = code_to_eodhd_symbol(code)
    resp = remote_get(
        f"https://eodhistoricaldata.com/api/fundamentals/{symbol}",
        api_key=api_key, proxy_id=proxy_id,
        params={"filter": "Financials::Balance_Sheet::yearly"},
    )
    data = resp.json()
    result = []
    for _date, item in (data.items() if isinstance(data, dict) else []):
        if len(result) >= 4:
            break
        entry = {"reportDate": item.get("date", _date if isinstance(_date, str) else "")}
        entry["totalAssets"] = _to_num(item.get("totalAssets"))
        entry["totalLiabilities"] = _to_num(item.get("totalLiabilities"))
        entry["totalEquity"] = _to_num(item.get("totalStockholdersEquity"))
        entry["currentAssets"] = _to_num(item.get("totalCurrentAssets"))
        entry["currentLiabilities"] = _to_num(item.get("totalCurrentLiabilities"))
        entry["cash"] = _to_num(item.get("cash"))
        entry["accountsReceivable"] = 0
        entry["inventory"] = 0
        entry["fixedAssets"] = 0
        entry["goodwill"] = 0
        entry["longTermInvestment"] = 0
        entry["shortTermBorrowings"] = _to_num(item.get("shortLongTermDebt"))
        entry["longTermBorrowings"] = _to_num(item.get("longTermDebt"))
        entry["paidInCapital"] = 0
        entry["capitalReserve"] = 0
        entry["retainedEarnings"] = _to_num(item.get("retainedEarnings"))
        entry["surplusReserve"] = 0
        entry["isAudited"] = ""
        entry["announcementDate"] = ""
        result.append(entry)
    return result


def get_income_statement_eodhd(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    symbol = code_to_eodhd_symbol(code)
    resp = remote_get(
        f"https://eodhistoricaldata.com/api/fundamentals/{symbol}",
        api_key=api_key, proxy_id=proxy_id,
        params={"filter": "Financials::Income_Statement::yearly"},
    )
    data = resp.json()
    result = []
    for _date, item in (data.items() if isinstance(data, dict) else []):
        if len(result) >= 4:
            break
        entry = {"reportDate": item.get("date", _date if isinstance(_date, str) else "")}
        entry["totalRevenue"] = _to_num(item.get("totalRevenue"))
        entry["operatingRevenue"] = _to_num(item.get("totalRevenue"))
        entry["totalCost"] = _to_num(item.get("totalOperatingExpenses"))
        entry["operatingCost"] = _to_num(item.get("costOfRevenue"))
        entry["sellingExpense"] = 0
        entry["adminExpense"] = 0
        entry["financeExpense"] = _to_num(item.get("interestExpense"))
        entry["rdExpense"] = _to_num(item.get("researchDevelopment"))
        entry["operatingProfit"] = _to_num(item.get("operatingIncome"))
        entry["totalProfit"] = _to_num(item.get("incomeBeforeTax"))
        entry["netProfit"] = _to_num(item.get("netIncome"))
        entry["netProfitAttributable"] = 0
        entry["eps"] = _to_num(item.get("eps"))
        result.append(entry)
    return result


def get_cashflow_statement_eodhd(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    symbol = code_to_eodhd_symbol(code)
    resp = remote_get(
        f"https://eodhistoricaldata.com/api/fundamentals/{symbol}",
        api_key=api_key, proxy_id=proxy_id,
        params={"filter": "Financials::Cash_Flow::yearly"},
    )
    data = resp.json()
    result = []
    for _date, item in (data.items() if isinstance(data, dict) else []):
        if len(result) >= 4:
            break
        entry = {"reportDate": item.get("date", _date if isinstance(_date, str) else "")}
        entry["operatingCashFlow"] = _to_num(item.get("totalCashFromOperatingActivities"))
        entry["investingCashFlow"] = _to_num(item.get("totalCashflowsFromInvestingActivities"))
        entry["financingCashFlow"] = _to_num(item.get("totalCashFromFinancingActivities"))
        entry["cashReceipts"] = 0
        entry["cashPayments"] = 0
        entry["capex"] = _to_num(item.get("capitalExpenditures"))
        result.append(entry)
    return result


# ═══════════════════════════════════════
# Tushare
# ═══════════════════════════════════════

def _tushare_post(
    api_name: str, token: str, params: dict,
    *, proxy_id: str | None = None,
) -> dict:
    resp = remote_post(
        "https://api.tushare.pro",
        proxy_id=proxy_id,
        json_body={
            "api_name": api_name,
            "token": token,
            "params": params,
            "fields": "",
        },
    )
    return resp.json()


def _tushare_code(code: str) -> str:
    c = code.strip()
    if c.startswith(("6", "5")):
        return c + ".SH"
    if c.startswith(("0", "3")):
        return c + ".SZ"
    return c


def get_balance_sheet_tushare(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    data = _tushare_post("balancesheet", api_key, {"ts_code": _tushare_code(code)}, proxy_id=proxy_id)
    fields = data.get("data", {}).get("fields", [])
    items = data.get("data", {}).get("items", [])[:4]
    result = []
    for row in items:
        item = dict(zip(fields, row))
        entry = {"reportDate": str(item.get("end_date", ""))}
        entry["totalAssets"] = _to_num(item.get("total_assets"))
        entry["totalLiabilities"] = _to_num(item.get("total_liab"))
        entry["totalEquity"] = _to_num(item.get("total_hldr_eqy_exc_min_int"))
        entry["currentAssets"] = _to_num(item.get("total_cur_assets"))
        entry["currentLiabilities"] = _to_num(item.get("total_cur_liab"))
        entry["cash"] = _to_num(item.get("monetary_cap"))
        entry["accountsReceivable"] = _to_num(item.get("accounts_rece"))
        entry["inventory"] = _to_num(item.get("inventory"))
        entry["fixedAssets"] = _to_num(item.get("fix_assets"))
        entry["goodwill"] = _to_num(item.get("goodwill"))
        entry["longTermInvestment"] = _to_num(item.get("lt_equi_invest"))
        entry["shortTermBorrowings"] = _to_num(item.get("st_borr"))
        entry["longTermBorrowings"] = _to_num(item.get("lt_borr"))
        entry["paidInCapital"] = _to_num(item.get("capital_rese"))
        entry["capitalReserve"] = _to_num(item.get("surplus_rese"))
        entry["retainedEarnings"] = _to_num(item.get("undistr_profit"))
        entry["surplusReserve"] = 0
        entry["isAudited"] = ""
        entry["announcementDate"] = ""
        result.append(entry)
    return result


def get_income_statement_tushare(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    data = _tushare_post("income", api_key, {"ts_code": _tushare_code(code)}, proxy_id=proxy_id)
    fields = data.get("data", {}).get("fields", [])
    items = data.get("data", {}).get("items", [])[:4]
    result = []
    for row in items:
        item = dict(zip(fields, row))
        entry = {"reportDate": str(item.get("end_date", ""))}
        entry["totalRevenue"] = _to_num(item.get("total_revenue"))
        entry["operatingRevenue"] = _to_num(item.get("total_revenue"))
        entry["totalCost"] = _to_num(item.get("total_cogs"))
        entry["operatingCost"] = _to_num(item.get("oper_cost"))
        entry["sellingExpense"] = _to_num(item.get("sell_exp"))
        entry["adminExpense"] = _to_num(item.get("admin_exp"))
        entry["financeExpense"] = _to_num(item.get("fin_exp"))
        entry["rdExpense"] = _to_num(item.get("rd_exp"))
        entry["operatingProfit"] = _to_num(item.get("operate_profit"))
        entry["totalProfit"] = _to_num(item.get("total_profit"))
        entry["netProfit"] = _to_num(item.get("netprofit"))
        entry["netProfitAttributable"] = _to_num(item.get("netprofit excl min int"))
        entry["eps"] = _to_num(item.get("basic_eps"))
        result.append(entry)
    return result


def get_cashflow_statement_tushare(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    data = _tushare_post("cashflow", api_key, {"ts_code": _tushare_code(code)}, proxy_id=proxy_id)
    fields = data.get("data", {}).get("fields", [])
    items = data.get("data", {}).get("items", [])[:4]
    result = []
    for row in items:
        item = dict(zip(fields, row))
        entry = {"reportDate": str(item.get("end_date", ""))}
        entry["operatingCashFlow"] = _to_num(item.get("n_cashflow_act"))
        entry["investingCashFlow"] = _to_num(item.get("n_cashflow_inv_act"))
        entry["financingCashFlow"] = _to_num(item.get("n_cashflow_fnc_act"))
        entry["cashReceipts"] = 0
        entry["cashPayments"] = 0
        entry["capex"] = _to_num(item.get("c_pay_acq_const_fiolta"))
        result.append(entry)
    return result


# ═══════════════════════════════════════
# JQData (聚宽)
# ═══════════════════════════════════════

def _jqdata_get_token(api_key: str, proxy_id: str | None = None) -> str:
    creds = json.loads(api_key)
    resp = remote_post(
        "https://dataapi.joinquant.com/apis",
        proxy_id=proxy_id,
        json_body={
            "method": "get_current_token",
            "mob": creds["username"],
            "pwd": creds["password"],
        },
    )
    return str(resp.json()).strip('"')


def _jqdata_query(
    api_name: str, token: str, params: dict,
    *, proxy_id: str | None = None,
) -> list[dict]:
    resp = remote_post(
        "https://dataapi.joinquant.com/apis",
        proxy_id=proxy_id,
        json_body={
            "method": api_name,
            "token": token,
            **params,
        },
    )
    return resp.json()


def _jqdata_code(code: str) -> str:
    c = code.strip()
    if c.startswith(("6", "5")):
        return c + ".XSHG"
    if c.startswith(("0", "3")):
        return c + ".XSHE"
    return c


def get_balance_sheet_jqdata(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    token = _jqdata_get_token(api_key, proxy_id)
    data = _jqdata_query(
        "get_fundamentals", token,
        {
            "id": "JQData",
            "code": _jqdata_code(code),
            "count": 4,
            "table": "balance",
        },
        proxy_id=proxy_id,
    )
    if not isinstance(data, list):
        return []
    result = []
    for item in data[:4]:
        entry = {"reportDate": str(item.get("pubDate", item.get("statDate", "")))}
        entry["totalAssets"] = _to_num(item.get("totalAssets"))
        entry["totalLiabilities"] = _to_num(item.get("totalLiability"))
        entry["totalEquity"] = _to_num(item.get("totalOwnerEquities"))
        entry["currentAssets"] = _to_num(item.get("totalCurrentAssets"))
        entry["currentLiabilities"] = _to_num(item.get("totalCurrentLiability"))
        entry["cash"] = _to_num(item.get("cash"))
        entry["accountsReceivable"] = 0
        entry["inventory"] = 0
        entry["fixedAssets"] = _to_num(item.get("fixedAssets"))
        entry["goodwill"] = 0
        entry["longTermInvestment"] = 0
        entry["shortTermBorrowings"] = 0
        entry["longTermBorrowings"] = 0
        entry["paidInCapital"] = 0
        entry["capitalReserve"] = 0
        entry["retainedEarnings"] = 0
        entry["surplusReserve"] = 0
        entry["isAudited"] = ""
        entry["announcementDate"] = str(item.get("pubDate", ""))
        result.append(entry)
    return result


def get_income_statement_jqdata(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    token = _jqdata_get_token(api_key, proxy_id)
    data = _jqdata_query(
        "get_fundamentals", token,
        {
            "id": "JQData",
            "code": _jqdata_code(code),
            "count": 4,
            "table": "income",
        },
        proxy_id=proxy_id,
    )
    if not isinstance(data, list):
        return []
    result = []
    for item in data[:4]:
        entry = {"reportDate": str(item.get("pubDate", item.get("statDate", "")))}
        entry["totalRevenue"] = _to_num(item.get("totalRevenue"))
        entry["operatingRevenue"] = _to_num(item.get("totalRevenue"))
        entry["totalCost"] = _to_num(item.get("totalOperatingCost"))
        entry["operatingCost"] = _to_num(item.get("operatingCost"))
        entry["sellingExpense"] = _to_num(item.get("saleExpense"))
        entry["adminExpense"] = _to_num(item.get("adminExpense"))
        entry["financeExpense"] = _to_num(item.get("financialExpense"))
        entry["rdExpense"] = 0
        entry["operatingProfit"] = _to_num(item.get("operatingProfit"))
        entry["totalProfit"] = _to_num(item.get("totalProfit"))
        entry["netProfit"] = _to_num(item.get("netProfit"))
        entry["netProfitAttributable"] = 0
        entry["eps"] = _to_num(item.get("eps"))
        result.append(entry)
    return result


def get_cashflow_statement_jqdata(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    token = _jqdata_get_token(api_key, proxy_id)
    data = _jqdata_query(
        "get_fundamentals", token,
        {
            "id": "JQData",
            "code": _jqdata_code(code),
            "count": 4,
            "table": "cash_flow",
        },
        proxy_id=proxy_id,
    )
    if not isinstance(data, list):
        return []
    result = []
    for item in data[:4]:
        entry = {"reportDate": str(item.get("pubDate", item.get("statDate", "")))}
        entry["operatingCashFlow"] = _to_num(item.get("netOperateCashFlow"))
        entry["investingCashFlow"] = _to_num(item.get("netInvestCashFlow"))
        entry["financingCashFlow"] = _to_num(item.get("netFinanceCashFlow"))
        entry["cashReceipts"] = 0
        entry["cashPayments"] = 0
        entry["capex"] = _to_num(item.get("fixAssetAcquiCash", 0))
        result.append(entry)
    return result


# ═══════════════════════════════════════
# RQData (米筐)
# ═══════════════════════════════════════

def _rqdata_get_token(api_key: str, proxy_id: str | None = None) -> str:
    creds = json.loads(api_key)
    resp = remote_post(
        "https://rqdatad-prod.ricequant.com/passport/login",
        proxy_id=proxy_id,
        json_body={
            "username": creds["username"],
            "password": creds["password"],
        },
    )
    return resp.json().get("access_token", "")


def _rqdata_code(code: str) -> str:
    c = code.strip()
    if c.startswith(("6", "5")):
        return c + ".XSHG"
    if c.startswith(("0", "3")):
        return c + ".XSHE"
    return c


def get_balance_sheet_rqdata(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    token = _rqdata_get_token(api_key, proxy_id)
    resp = remote_get(
        "https://rqdatad-prod.ricequant.com/api/finance",
        header_api_key_name="Authorization",
        api_key=f"Bearer {token}",
        proxy_id=proxy_id,
        params={
            "codes": _rqdata_code(code),
            "statement": "balance_sheet",
            "count": 4,
        },
    )
    items = resp.json().get("data", [])[:4] if isinstance(resp.json(), dict) else []
    result = []
    for item in items:
        entry = {"reportDate": str(item.get("announce_date", item.get("end_date", "")))}
        entry["totalAssets"] = _to_num(item.get("total_assets"))
        entry["totalLiabilities"] = _to_num(item.get("total_liability"))
        entry["totalEquity"] = _to_num(item.get("total_owner_equity"))
        entry["currentAssets"] = 0
        entry["currentLiabilities"] = 0
        entry["cash"] = 0
        entry["accountsReceivable"] = 0
        entry["inventory"] = 0
        entry["fixedAssets"] = 0
        entry["goodwill"] = 0
        entry["longTermInvestment"] = 0
        entry["shortTermBorrowings"] = 0
        entry["longTermBorrowings"] = 0
        entry["paidInCapital"] = 0
        entry["capitalReserve"] = 0
        entry["retainedEarnings"] = 0
        entry["surplusReserve"] = 0
        entry["isAudited"] = ""
        entry["announcementDate"] = ""
        result.append(entry)
    return result


def get_income_statement_rqdata(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    token = _rqdata_get_token(api_key, proxy_id)
    resp = remote_get(
        "https://rqdatad-prod.ricequant.com/api/finance",
        header_api_key_name="Authorization",
        api_key=f"Bearer {token}",
        proxy_id=proxy_id,
        params={
            "codes": _rqdata_code(code),
            "statement": "income_statement",
            "count": 4,
        },
    )
    items = resp.json().get("data", [])[:4] if isinstance(resp.json(), dict) else []
    result = []
    for item in items:
        entry = {"reportDate": str(item.get("announce_date", item.get("end_date", "")))}
        entry["totalRevenue"] = _to_num(item.get("total_operating_revenue"))
        entry["operatingRevenue"] = _to_num(item.get("operating_revenue"))
        entry["totalCost"] = _to_num(item.get("total_operating_cost"))
        entry["operatingCost"] = _to_num(item.get("operating_cost"))
        entry["sellingExpense"] = 0
        entry["adminExpense"] = 0
        entry["financeExpense"] = _to_num(item.get("financial_expense"))
        entry["rdExpense"] = 0
        entry["operatingProfit"] = _to_num(item.get("operating_profit"))
        entry["totalProfit"] = _to_num(item.get("total_profit"))
        entry["netProfit"] = _to_num(item.get("net_profit"))
        entry["netProfitAttributable"] = 0
        entry["eps"] = 0
        result.append(entry)
    return result


def get_cashflow_statement_rqdata(
    code: str, *, api_key: str, proxy_id: str | None = None, **_kw
) -> list[dict]:
    token = _rqdata_get_token(api_key, proxy_id)
    resp = remote_get(
        "https://rqdatad-prod.ricequant.com/api/finance",
        header_api_key_name="Authorization",
        api_key=f"Bearer {token}",
        proxy_id=proxy_id,
        params={
            "codes": _rqdata_code(code),
            "statement": "cash_flow_statement",
            "count": 4,
        },
    )
    items = resp.json().get("data", [])[:4] if isinstance(resp.json(), dict) else []
    result = []
    for item in items:
        entry = {"reportDate": str(item.get("announce_date", item.get("end_date", "")))}
        entry["operatingCashFlow"] = _to_num(item.get("net_operate_cash_flow"))
        entry["investingCashFlow"] = _to_num(item.get("net_invest_cash_flow"))
        entry["financingCashFlow"] = _to_num(item.get("net_finance_cash_flow"))
        entry["cashReceipts"] = 0
        entry["cashPayments"] = 0
        entry["capex"] = 0
        result.append(entry)
    return result


# ─── Dispatch 映射 ───

BALANCE_SHEET_REMOTE_FETCHERS: dict[str, callable] = {
    "fmp": get_balance_sheet_fmp,
    "alphavantage": get_balance_sheet_alphavantage,
    "finnhub": get_balance_sheet_finnhub,
    "eodhd": get_balance_sheet_eodhd,
    "tushare": get_balance_sheet_tushare,
    "jqdata": get_balance_sheet_jqdata,
    "rqdata": get_balance_sheet_rqdata,
}

INCOME_STATEMENT_REMOTE_FETCHERS: dict[str, callable] = {
    "fmp": get_income_statement_fmp,
    "alphavantage": get_income_statement_alphavantage,
    "finnhub": get_income_statement_finnhub,
    "eodhd": get_income_statement_eodhd,
    "tushare": get_income_statement_tushare,
    "jqdata": get_income_statement_jqdata,
    "rqdata": get_income_statement_rqdata,
}

CASHFLOW_STATEMENT_REMOTE_FETCHERS: dict[str, callable] = {
    "fmp": get_cashflow_statement_fmp,
    "alphavantage": get_cashflow_statement_alphavantage,
    "finnhub": get_cashflow_statement_finnhub,
    "eodhd": get_cashflow_statement_eodhd,
    "tushare": get_cashflow_statement_tushare,
    "jqdata": get_cashflow_statement_jqdata,
    "rqdata": get_cashflow_statement_rqdata,
}
