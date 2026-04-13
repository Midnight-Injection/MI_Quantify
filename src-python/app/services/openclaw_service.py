import re
from statistics import mean

from app.services.fundflow_service import get_fund_flow
from app.services.kline_service import get_kline
from app.services.market_service import get_market_indices
from app.services.news_service import get_financial_news
from app.services.sector_service import get_concept_rank, get_sector_rank
from app.services.stock_service import get_stock_finance, get_stock_info, get_stock_news


def _safe_mean(values: list[float]) -> float:
    clean = [v for v in values if isinstance(v, (int, float))]
    return round(mean(clean), 4) if clean else 0


def _build_technical_summary(kline_data: list[dict]) -> dict:
    if not kline_data:
        return {
            "ma5": 0,
            "ma10": 0,
            "ma20": 0,
            "supportPrice": 0,
            "resistancePrice": 0,
            "trend": "neutral",
            "momentum": "weak",
        }

    closes = [float(item.get("close", 0) or 0) for item in kline_data]
    lows = [float(item.get("low", 0) or 0) for item in kline_data[-20:]]
    highs = [float(item.get("high", 0) or 0) for item in kline_data[-20:]]
    latest = closes[-1]
    ma5 = _safe_mean(closes[-5:])
    ma10 = _safe_mean(closes[-10:])
    ma20 = _safe_mean(closes[-20:])
    trend = "bullish" if latest > ma5 > ma10 else "bearish" if latest < ma5 < ma10 else "neutral"
    momentum = "strong" if latest >= ma5 and ma5 >= ma10 else "weak" if latest < ma5 else "moderate"

    return {
        "ma5": round(ma5, 2),
        "ma10": round(ma10, 2),
        "ma20": round(ma20, 2),
        "supportPrice": round(min(lows) if lows else latest * 0.97, 2),
        "resistancePrice": round(max(highs) if highs else latest * 1.04, 2),
        "trend": trend,
        "momentum": momentum,
    }


def extract_stock_code(text: str) -> str | None:
    if not text:
        return None
    matched = re.search(r"(?<!\d)(\d{6})(?!\d)", text)
    return matched.group(1) if matched else None


def build_diagnosis_context(code: str) -> dict:
    info = get_stock_info(code)
    finance = get_stock_finance(code)
    kline_data = get_kline(code, "daily", adjust="qfq")[:120]
    technical = _build_technical_summary(kline_data)
    stock_news = get_stock_news(code)[:8]
    macro_news = get_financial_news(8)[:8]
    fund_flow = next((item for item in get_fund_flow(100) if item.get("code") == code), None)

    return {
        "stock": info,
        "finance": finance,
        "technical": technical,
        "kline": kline_data[-60:],
        "fundFlow": fund_flow,
        "marketIndices": get_market_indices("a")[:8],
        "topIndustries": get_sector_rank()[:8],
        "topConcepts": get_concept_rank()[:8],
        "stockNews": stock_news,
        "macroNews": macro_news,
    }


def build_openclaw_reply(context: dict) -> str:
    stock = context.get("stock", {})
    technical = context.get("technical", {})
    price = float(stock.get("price", 0) or 0)
    support = float(technical.get("supportPrice", 0) or 0)
    resistance = float(technical.get("resistancePrice", 0) or 0)
    trend = technical.get("trend", "neutral")
    momentum = technical.get("momentum", "weak")

    if not stock.get("code"):
        return "没有识别到股票代码，请发送例如“诊股 600519”或“分析 000001”。"

    if trend == "bullish":
        recommendation = "偏强，优先等回踩支撑后再分批参与。"
    elif trend == "bearish":
        recommendation = "结构偏弱，先观察量能和支撑是否失守。"
    else:
        recommendation = "仍处于震荡区间，适合低吸高抛，避免追价。"

    return (
        f"{stock.get('name', stock.get('code'))}({stock.get('code')}) 当前价 {price:.2f}，"
        f"趋势 {trend} / 动量 {momentum}。支撑位 {support:.2f}，压力位 {resistance:.2f}。"
        f"{recommendation} 这只是研究辅助，不代表收益承诺。"
    )


def build_openclaw_prompt(context: dict) -> str:
    stock = context.get("stock", {})
    return (
        "你是 OpenClaw 中的 A 股诊股代理。请只基于提供的 JSON 上下文给出简洁回复，"
        "必须说明买入观察区间、卖出观察区间、风险提示，不能承诺收益率或胜率。"
        f" 当前股票：{stock.get('name', '')}({stock.get('code', '')})。"
    )


def diagnose_from_text(text: str, code: str | None = None) -> dict:
    resolved_code = code or extract_stock_code(text)
    if not resolved_code:
        return {
            "ok": False,
            "message": "未识别到股票代码，请发送 6 位股票代码，例如 600519。",
        }

    context = build_diagnosis_context(resolved_code)
    return {
        "ok": True,
        "code": resolved_code,
        "reply": build_openclaw_reply(context),
        "analysisPrompt": build_openclaw_prompt(context),
        "context": context,
    }
