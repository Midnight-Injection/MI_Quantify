import akshare as ak
from functools import lru_cache

_SYMBOL_MAP = {
    "资产负债表": "资产负债表",
    "利润表": "利润表",
    "现金流量表": "现金流量表",
}


@lru_cache(maxsize=64)
def get_financial_report(code: str, symbol: str = "资产负债表") -> list[dict]:
    try:
        ak_symbol = _SYMBOL_MAP.get(symbol, symbol)
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
def get_income_statement(code: str) -> list[dict]:
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
def get_cashflow_statement(code: str) -> list[dict]:
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


def get_financial_summary(code: str) -> dict:
    balance = get_financial_report(code, "资产负债表")
    income = get_income_statement(code)
    cashflow = get_cashflow_statement(code)
    return {
        "balanceSheet": balance,
        "incomeStatement": income,
        "cashflowStatement": cashflow,
    }


def _to_num(val):
    try:
        v = float(val)
        return v if v == v else 0
    except Exception:
        return 0
