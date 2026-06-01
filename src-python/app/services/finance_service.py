"""
财务报表服务 - 支持多数据源调度

内置源: akshare (A股财报)
远程源: fmp, alphavantage, finnhub, eodhd, tushare, jqdata, rqdata
"""
import akshare as ak
from functools import lru_cache
from app.services.datasource_registry import get_sources_for_tool
from app.services.finance_remote_fetchers import (
    BALANCE_SHEET_REMOTE_FETCHERS,
    INCOME_STATEMENT_REMOTE_FETCHERS,
    CASHFLOW_STATEMENT_REMOTE_FETCHERS,
)

_SYMBOL_MAP = {
    "资产负债表": "资产负债表",
    "利润表": "利润表",
    "现金流量表": "现金流量表",
}


@lru_cache(maxsize=64)
def _get_balance_sheet_akshare(code: str) -> list[dict]:
    """akshare 资产负债表"""
    try:
        ak_symbol = _SYMBOL_MAP.get("资产负债表", "资产负债表")
        df = ak.stock_financial_report_sina(stock=code, symbol=ak_symbol)
        if df is None or df.empty:
            return []
        df = df.head(4)
        df = df.fillna(0)
        result = []
        for _, row in df.iterrows():
            entry = {"reportDate": str(row.get("报告日", ""))}
            entry["totalAssets"] = _to_num(row.get("资产总计"))
            entry["totalLiabilities"] = _to_num(row.get("负债合计"))
            entry["totalEquity"] = _to_num(row.get("所有者权益(或股东权益)合计"))
            entry["currentAssets"] = _to_num(row.get("流动资产合计"))
            entry["currentLiabilities"] = _to_num(row.get("流动负债合计"))
            entry["cash"] = _to_num(row.get("货币资金"))
            entry["accountsReceivable"] = _to_num(row.get("应收账款"))
            entry["inventory"] = _to_num(row.get("存货"))
            entry["fixedAssets"] = _to_num(row.get("固定资产净额"))
            entry["goodwill"] = _to_num(row.get("商誉"))
            entry["longTermInvestment"] = _to_num(row.get("长期股权投资"))
            entry["shortTermBorrowings"] = _to_num(row.get("短期借款"))
            entry["longTermBorrowings"] = _to_num(row.get("长期借款"))
            entry["paidInCapital"] = _to_num(row.get("实收资本(或股本)"))
            entry["capitalReserve"] = _to_num(row.get("资本公积"))
            entry["surplusReserve"] = _to_num(row.get("盈余公积"))
            entry["retainedEarnings"] = _to_num(row.get("未分配利润"))
            entry["isAudited"] = str(row.get("是否审计", ""))
            entry["announcementDate"] = str(row.get("公告日期", ""))
            result.append(entry)
        return result
    except Exception as e:
        print(f"[finance] error fetching balance sheet for {code}: {e}")
        return []


@lru_cache(maxsize=64)
def _get_income_statement_akshare(code: str) -> list[dict]:
    """akshare 利润表"""
    try:
        ak_symbol = _SYMBOL_MAP.get("利润表", "利润表")
        df = ak.stock_financial_report_sina(stock=code, symbol=ak_symbol)
        if df is None or df.empty:
            return []
        df = df.head(4)
        df = df.fillna(0)
        result = []
        for _, row in df.iterrows():
            entry = {"reportDate": str(row.get("报告日", ""))}
            entry["totalRevenue"] = _to_num(row.get("营业总收入"))
            entry["operatingRevenue"] = _to_num(row.get("营业收入"))
            entry["totalCost"] = _to_num(row.get("营业总成本"))
            entry["operatingCost"] = _to_num(row.get("营业成本"))
            entry["sellingExpense"] = _to_num(row.get("销售费用"))
            entry["adminExpense"] = _to_num(row.get("管理费用"))
            entry["financeExpense"] = _to_num(row.get("财务费用"))
            entry["rdExpense"] = _to_num(row.get("研发费用"))
            entry["operatingProfit"] = _to_num(row.get("营业利润"))
            entry["totalProfit"] = _to_num(row.get("利润总额"))
            entry["netProfit"] = _to_num(row.get("净利润"))
            entry["netProfitAttributable"] = _to_num(
                row.get("归属于母公司所有者的净利润")
            )
            entry["eps"] = _to_num(row.get("每股收益"))
            result.append(entry)
        return result
    except Exception as e:
        print(f"[finance] error fetching income statement for {code}: {e}")
        return []


@lru_cache(maxsize=64)
def _get_cashflow_statement_akshare(code: str) -> list[dict]:
    """akshare 现金流量表"""
    try:
        ak_symbol = _SYMBOL_MAP.get("现金流量表", "现金流量表")
        df = ak.stock_financial_report_sina(stock=code, symbol=ak_symbol)
        if df is None or df.empty:
            return []
        df = df.head(4)
        df = df.fillna(0)
        result = []
        for _, row in df.iterrows():
            entry = {"reportDate": str(row.get("报告日", ""))}
            entry["operatingCashFlow"] = _to_num(row.get("经营活动产生的现金流量净额"))
            entry["investingCashFlow"] = _to_num(row.get("投资活动产生的现金流量净额"))
            entry["financingCashFlow"] = _to_num(row.get("筹资活动产生的现金流量净额"))
            entry["cashReceipts"] = _to_num(row.get("收到的其他与经营活动有关的现金"))
            entry["cashPayments"] = _to_num(row.get("支付的其他与经营活动有关的现金"))
            entry["capex"] = _to_num(
                row.get("购建固定资产、无形资产和其他长期资产所支付的现金")
            )
            result.append(entry)
        return result
    except Exception as e:
        print(f"[finance] error fetching cashflow for {code}: {e}")
        return []


def _dispatch_finance(code: str, statement_type: str, fetcher_map: dict) -> list[dict]:
    """
    多源调度财务报表

    Args:
        code: 股票代码
        statement_type: 报表类型标识 (e.g. "balance_sheet")
        fetcher_map: 远程 fetcher 映射字典
    """
    sources = get_sources_for_tool("load_finance_report")
    for source in sources:
        source_id = source.get("id", "")
        api_key = source.get("apiKey")
        proxy_id = source.get("proxyId")
        if source_id == "akshare":
            try:
                if statement_type == "balance_sheet":
                    result = _get_balance_sheet_akshare(code)
                elif statement_type == "income_statement":
                    result = _get_income_statement_akshare(code)
                elif statement_type == "cashflow_statement":
                    result = _get_cashflow_statement_akshare(code)
                else:
                    continue
                if result:
                    return result
            except Exception as e:
                print(f"[finance] akshare {statement_type} failed for {code}: {e}")
        else:
            remote_fn = fetcher_map.get(source_id)
            if remote_fn:
                try:
                    result = remote_fn(code, api_key=api_key, proxy_id=proxy_id)
                    if result:
                        return result
                except Exception as e:
                    print(f"[finance] {source_id} {statement_type} failed for {code}: {e}")

    if statement_type == "balance_sheet":
        return _get_balance_sheet_akshare(code)
    elif statement_type == "income_statement":
        return _get_income_statement_akshare(code)
    elif statement_type == "cashflow_statement":
        return _get_cashflow_statement_akshare(code)
    return []


def get_financial_report(code: str, symbol: str = "资产负债表") -> list[dict]:
    """获取资产负债表（兼容旧接口）"""
    return _dispatch_finance(code, "balance_sheet", BALANCE_SHEET_REMOTE_FETCHERS)


def get_income_statement(code: str) -> list[dict]:
    """获取利润表"""
    return _dispatch_finance(code, "income_statement", INCOME_STATEMENT_REMOTE_FETCHERS)


def get_cashflow_statement(code: str) -> list[dict]:
    """获取现金流量表"""
    return _dispatch_finance(code, "cashflow_statement", CASHFLOW_STATEMENT_REMOTE_FETCHERS)


def get_financial_summary(code: str) -> dict:
    """
    获取财务报表摘要（资产负债表 + 利润表 + 现金流量表）
    """
    balance = _dispatch_finance(code, "balance_sheet", BALANCE_SHEET_REMOTE_FETCHERS)
    income = _dispatch_finance(code, "income_statement", INCOME_STATEMENT_REMOTE_FETCHERS)
    cashflow = _dispatch_finance(code, "cashflow_statement", CASHFLOW_STATEMENT_REMOTE_FETCHERS)
    return {
        "balanceSheet": balance,
        "incomeStatement": income,
        "cashflowStatement": cashflow,
    }


def _to_num(val):
    try:
        v = float(val)
        if v != v:  # NaN check
            return 0
        import math
        if math.isinf(v):
            return 0
        return v
    except Exception:
        return 0
