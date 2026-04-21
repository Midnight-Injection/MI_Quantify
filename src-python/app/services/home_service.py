import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from app.services.fundflow_service import get_fund_flow, get_stock_fund_flow
from app.services.market_service import (
    get_advance_decline,
    get_market_indices,
    get_realtime_quotes,
    get_stock_list,
)
from app.services.news_service import get_financial_news
from app.services.sector_service import (
    get_concept_rank,
    get_sector_members,
    get_sector_rank,
)
from app.services.stock_service import get_stock_finance, get_stock_info


HOME_CACHE_TTL_SECONDS = 20
HOME_HEATMAP_LIMIT = 14
HOME_STOCK_SAMPLE_LIMIT = 36
HOME_NEWS_LIMIT = 60

OVERSEAS_THEME_PRESETS = {
    "hk": [
        {"title": "科技互联网", "symbols": ["00700", "09988", "03690", "01810", "09618"]},
        {"title": "金融红利", "symbols": ["00005", "00939", "01398", "02318", "01299"]},
        {"title": "消费医药", "symbols": ["02319", "02269", "01093", "02331", "09626"]},
        {"title": "能源制造", "symbols": ["00883", "00857", "00386", "01772", "09868"]},
    ],
    "us": [
        {"title": "科技巨头", "symbols": ["AAPL", "MSFT", "AMZN", "META", "GOOGL"]},
        {"title": "半导体 AI", "symbols": ["NVDA", "AMD", "AVGO", "TSM", "SMCI"]},
        {"title": "中概互联网", "symbols": ["BABA", "PDD", "JD", "BIDU", "TME"]},
        {"title": "新能源出行", "symbols": ["TSLA", "NIO", "LI", "XPEV"]},
    ],
}

STYLE_GROUPS = {
    "a": [
        ("AI科技", ["人工智能", "算力", "芯片", "半导体", "软件", "通信", "CPO", "机器人"]),
        ("先进制造", ["军工", "航空", "装备", "制造", "工业母机", "高端装备"]),
        ("金融地产", ["银行", "证券", "保险", "地产", "房地产"]),
        ("消费医药", ["消费", "食品", "饮料", "零售", "医药", "医疗"]),
        ("资源周期", ["煤炭", "有色", "钢铁", "化工", "石油", "天然气", "电力"]),
    ],
    "hk": [
        ("科技互联网", ["科技互联网"]),
        ("金融红利", ["金融红利"]),
        ("消费医药", ["消费医药"]),
        ("能源制造", ["能源制造"]),
    ],
    "us": [
        ("科技巨头", ["科技巨头"]),
        ("半导体 AI", ["半导体 AI"]),
        ("中概互联网", ["中概互联网"]),
        ("新能源出行", ["新能源出行"]),
    ],
}

NEWS_TOPIC_RULES = [
    ("政策宏观", ["国务院", "证监会", "央行", "财政部", "发改委", "宏观", "政策", "降准", "降息"]),
    ("AI科技", ["人工智能", "算力", "芯片", "半导体", "英伟达", "特斯拉", "微软", "谷歌"]),
    ("业绩财报", ["财报", "业绩", "预告", "利润", "营收", "回购", "分红"]),
    ("出海与地缘", ["美联储", "关税", "中东", "伊朗", "俄乌", "原油", "汇率", "非农", "CPI"]),
]

EVENT_KEYWORDS = ["财报", "业绩", "美联储", "CPI", "非农", "国务院", "证监会", "发布会", "路演", "公告"]

_home_cache: dict[str, dict] = {}


def _cache_get(key: str):
    cached = _home_cache.get(key)
    if cached and time.time() - cached.get("updated", 0.0) < HOME_CACHE_TTL_SECONDS:
        return cached.get("data")
    return None


def _cache_set(key: str, data):
    _home_cache[key] = {"data": data, "updated": time.time()}
    return data


def _safe_float(value) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _tone_from_value(value: float, flat_threshold: float = 0.2) -> str:
    if value >= flat_threshold:
        return "up"
    if value <= -flat_threshold:
        return "down"
    return "flat"


def _build_breadth(market: str, stocks: list[dict]) -> dict:
    if market == "a":
        breadth = get_advance_decline()
        positive = breadth.get("advance", 0)
        negative = breadth.get("decline", 0)
        flat = breadth.get("flat", 0)
        total = breadth.get("total", 0)
        total_amount = _safe_float(breadth.get("totalAmount"))
        return {
            "advance": positive,
            "decline": negative,
            "flat": flat,
            "total": total,
            "positiveRatio": round((positive / total) * 100, 2) if total else 0,
            "negativeRatio": round((negative / total) * 100, 2) if total else 0,
            "totalAmount": total_amount,
            "sourceLabel": "全市场实时股票池",
        }

    positive = sum(1 for item in stocks if _safe_float(item.get("changePercent")) > 0)
    negative = sum(1 for item in stocks if _safe_float(item.get("changePercent")) < 0)
    total = len(stocks)
    flat = max(0, total - positive - negative)
    total_amount = sum(_safe_float(item.get("amount")) for item in stocks)
    return {
        "advance": positive,
        "decline": negative,
        "flat": flat,
        "total": total,
        "positiveRatio": round((positive / total) * 100, 2) if total else 0,
        "negativeRatio": round((negative / total) * 100, 2) if total else 0,
        "totalAmount": total_amount,
        "sourceLabel": "首页活跃样本代理",
    }


def _build_theme_groups(market: str, stocks: list[dict]) -> list[dict]:
    presets = OVERSEAS_THEME_PRESETS.get(market, [])
    groups = []
    for preset in presets:
        symbols = set(preset["symbols"])
        members = [item for item in stocks if str(item.get("code", "")).upper() in symbols]
        if not members:
            continue
        leader = sorted(
            members,
            key=lambda item: (
                _safe_float(item.get("changePercent")),
                _safe_float(item.get("amount")),
            ),
            reverse=True,
        )[0]
        groups.append(
            {
                "code": preset["title"],
                "name": preset["title"],
                "changePercent": round(
                    sum(_safe_float(item.get("changePercent")) for item in members) / len(members),
                    2,
                ),
                "amount": round(sum(_safe_float(item.get("amount")) for item in members), 2),
                "volume": round(sum(_safe_float(item.get("volume")) for item in members), 2),
                "companyCount": len(members),
                "leadingStock": leader.get("name", ""),
                "leadingCode": leader.get("code", ""),
                "members": members[:8],
            }
        )
    groups.sort(key=lambda item: (item.get("changePercent", 0), item.get("amount", 0)), reverse=True)
    return groups


def _load_sector_universe(market: str, stocks: list[dict]) -> dict:
    if market == "a":
        industry = get_sector_rank()
        concept = get_concept_rank()
        combined = [*industry, *concept]
        combined.sort(key=lambda item: (item.get("changePercent", 0), item.get("amount", 0)), reverse=True)
        return {
            "leaders": combined[:12],
            "industry": industry[:10],
            "concept": concept[:10],
            "focus": combined[0] if combined else None,
        }

    themes = _build_theme_groups(market, stocks)
    return {
        "leaders": themes[:12],
        "industry": themes[:6],
        "concept": [],
        "focus": themes[0] if themes else None,
    }


def _build_heatmap(groups: list[dict]) -> list[dict]:
    cells = []
    for item in groups[:HOME_HEATMAP_LIMIT]:
        cells.append(
            {
                "code": item.get("code", ""),
                "label": item.get("name", ""),
                "changePercent": round(_safe_float(item.get("changePercent")), 2),
                "amount": round(_safe_float(item.get("amount")), 2),
                "weight": max(1, int(_safe_float(item.get("companyCount")) or 1)),
                "detail": item.get("leadingStock") or "",
            }
        )
    return cells


def _build_style_matrix(market: str, leaders: list[dict]) -> list[dict]:
    groups = STYLE_GROUPS.get(market, [])
    matrix = []
    for label, keywords in groups:
        matched = [
            item
            for item in leaders
            if any(keyword in str(item.get("name", "")) for keyword in keywords)
        ]
        if not matched:
            continue
        avg_change = sum(_safe_float(item.get("changePercent")) for item in matched) / len(matched)
        matrix.append(
            {
                "label": label,
                "changePercent": round(avg_change, 2),
                "tone": _tone_from_value(avg_change, 0.4),
                "leader": matched[0].get("leadingStock") or matched[0].get("name", ""),
                "detail": f"{len(matched)} 个主题共振",
            }
        )
    return matrix[:5]


def _build_overview_summary(
    market: str,
    breadth: dict,
    indices: list[dict],
    leaders: list[dict],
    stocks: list[dict],
) -> list[dict]:
    lead_index = indices[0] if indices else {}
    second_index = indices[1] if len(indices) > 1 else {}
    top_sector = leaders[0] if leaders else {}
    top_stock = stocks[0] if stocks else {}
    rise_fall_ratio = (
        round(_safe_float(breadth.get("advance")) / max(1, _safe_float(breadth.get("decline"))), 2)
        if breadth.get("total")
        else 0
    )
    avg_turnover = 0.0
    if stocks:
        avg_turnover = sum(_safe_float(item.get("turnover")) for item in stocks[:18]) / min(len(stocks[:18]), 18)
    return [
        {
            "label": "上涨占比",
            "value": f"{_safe_float(breadth.get('positiveRatio')):.1f}%",
            "detail": f"上涨 {_safe_float(breadth.get('advance')):.0f} / 下跌 {_safe_float(breadth.get('decline')):.0f}",
            "tone": "up" if _safe_float(breadth.get("positiveRatio")) >= 55 else "down" if _safe_float(breadth.get("positiveRatio")) <= 45 else "flat",
        },
        {
            "label": "涨跌家数比",
            "value": f"{rise_fall_ratio:.2f}" if rise_fall_ratio else "--",
            "detail": breadth.get("sourceLabel", ""),
            "tone": "up" if rise_fall_ratio >= 1.2 else "down" if rise_fall_ratio <= 0.8 else "flat",
        },
        {
            "label": "成交脉冲",
            "value": str(int(round(_safe_float(breadth.get("totalAmount")) / 100000000))),
            "detail": "亿",
            "tone": "flat",
        },
        {
            "label": "核心指数",
            "value": lead_index.get("name", "--"),
            "detail": f"{_safe_float(lead_index.get('changePercent')):+.2f}%",
            "tone": _tone_from_value(_safe_float(lead_index.get("changePercent")), 0.3),
        },
        {
            "label": "第二参考",
            "value": second_index.get("name", "--"),
            "detail": f"{_safe_float(second_index.get('changePercent')):+.2f}%",
            "tone": _tone_from_value(_safe_float(second_index.get("changePercent")), 0.3),
        },
        {
            "label": "主线板块",
            "value": top_sector.get("name", "--"),
            "detail": top_sector.get("leadingStock") or "",
            "tone": _tone_from_value(_safe_float(top_sector.get("changePercent")), 0.5),
        },
        {
            "label": "热点龙头",
            "value": top_stock.get("name", "--"),
            "detail": f"{_safe_float(top_stock.get('changePercent')):+.2f}% / {_safe_float(top_stock.get('amount')) / 100000000:.1f}亿",
            "tone": _tone_from_value(_safe_float(top_stock.get("changePercent")), 0.5),
        },
        {
            "label": "热点换手",
            "value": f"{avg_turnover:.2f}%" if avg_turnover else "--",
            "detail": "活跃样本平均换手",
            "tone": "up" if avg_turnover >= 6 else "flat" if avg_turnover >= 3 else "down",
        },
    ]


def _build_movers(stocks: list[dict]) -> dict:
    sorted_by_change = sorted(stocks, key=lambda item: _safe_float(item.get("changePercent")), reverse=True)
    sorted_by_amount = sorted(stocks, key=lambda item: _safe_float(item.get("amount")), reverse=True)
    sorted_by_turnover = sorted(stocks, key=lambda item: _safe_float(item.get("turnover")), reverse=True)
    return {
        "gainers": sorted_by_change[:6],
        "losers": sorted_by_change[-6:][::-1],
        "active": sorted_by_amount[:6],
        "turnover": sorted_by_turnover[:6],
    }


def _latest_flow_snapshot(code: str) -> dict:
    flows = get_stock_fund_flow(code, 5)
    if not flows:
        return {
            "code": code,
            "mainNetInflow": 0,
            "mainNetInflowPercent": 0,
            "history": [],
        }
    latest = flows[-1]
    return {
        "code": code,
        "mainNetInflow": _safe_float(latest.get("mainNetInflow")),
        "mainNetInflowPercent": _safe_float(latest.get("mainNetInflowPercent")),
        "history": flows[-5:],
    }


def _build_board_flow_proxy(sectors: list[dict]) -> list[dict]:
    targets = [item for item in sectors[:6] if item.get("code")]
    if not targets:
        return []

    def load_one(sector: dict) -> dict:
        members = get_sector_members([sector.get("code", "")], 8)[:6]
        total_flow = 0.0
        positive = 0
        samples = []
        for member in members:
            flow = _latest_flow_snapshot(str(member.get("code", "")))
            total_flow += _safe_float(flow.get("mainNetInflow"))
            if _safe_float(flow.get("mainNetInflow")) > 0:
                positive += 1
            samples.append(
                {
                    "code": member.get("code", ""),
                    "name": member.get("name", ""),
                    "mainNetInflow": _safe_float(flow.get("mainNetInflow")),
                }
            )
        return {
            "code": sector.get("code", ""),
            "name": sector.get("name", ""),
            "changePercent": _safe_float(sector.get("changePercent")),
            "amount": _safe_float(sector.get("amount")),
            "netFlowProxy": round(total_flow, 2),
            "positiveCount": positive,
            "samples": sorted(samples, key=lambda item: item.get("mainNetInflow", 0), reverse=True)[:3],
        }

    results = []
    with ThreadPoolExecutor(max_workers=min(4, len(targets))) as executor:
        futures = [executor.submit(load_one, sector) for sector in targets]
        for future in as_completed(futures):
            results.append(future.result())
    results.sort(key=lambda item: item.get("netFlowProxy", 0), reverse=True)
    return results


def _build_news_groups(news_items: list[dict]) -> tuple[list[dict], list[dict], list[dict]]:
    groups = []
    timeline = []
    for label, keywords in NEWS_TOPIC_RULES:
        matched = []
        for item in news_items:
            text = f"{item.get('title', '')} {item.get('content', '')}"
            if any(keyword in text for keyword in keywords):
                matched.append(item)
        if matched:
            groups.append(
                {
                    "label": label,
                    "count": len(matched),
                    "tone": "up" if label in ("AI科技", "业绩财报") else "flat",
                    "items": matched[:6],
                }
            )
    for item in news_items:
        text = f"{item.get('title', '')} {item.get('content', '')}"
        if any(keyword in text for keyword in EVENT_KEYWORDS):
            timeline.append(item)
    hot_topics = []
    for group in groups[:6]:
        hot_topics.append(
            {
                "label": group["label"],
                "count": group["count"],
                "headline": group["items"][0].get("title", ""),
            }
        )
    return groups[:4], timeline[:8], hot_topics


def get_home_overview(market: str = "a") -> dict:
    cache_key = f"overview:{market}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    indices = get_market_indices(market)
    stocks = get_stock_list(market, 1, HOME_STOCK_SAMPLE_LIMIT).get("data", [])
    breadth = _build_breadth(market, stocks)
    sector_bundle = _load_sector_universe(market, stocks)
    leaders = sector_bundle["leaders"]
    payload = {
        "updatedAt": int(time.time() * 1000),
        "summaryCards": _build_overview_summary(market, breadth, indices, leaders, stocks),
        "indices": indices[:8],
        "breadth": breadth,
        "heatmap": _build_heatmap(leaders),
        "styleMatrix": _build_style_matrix(market, leaders),
        "movers": _build_movers(stocks),
    }
    return _cache_set(cache_key, payload)


def get_home_fundflow(market: str = "a") -> dict:
    cache_key = f"fundflow:{market}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    stocks = get_stock_list(market, 1, HOME_STOCK_SAMPLE_LIMIT).get("data", [])
    breadth = _build_breadth(market, stocks)
    market_summary = [
        {
            "label": "样本成交额",
            "value": round(sum(_safe_float(item.get("amount")) for item in stocks) / 100000000, 2),
            "detail": "亿",
            "tone": "flat",
        },
        {
            "label": "上涨覆盖",
            "value": f"{_safe_float(breadth.get('positiveRatio')):.1f}%",
            "detail": breadth.get("sourceLabel", ""),
            "tone": "up" if _safe_float(breadth.get("positiveRatio")) >= 55 else "flat",
        },
    ]

    if market == "a":
        flows = get_fund_flow(24)
        has_live_flow = bool(flows) and any(abs(_safe_float(item.get("mainNetInflow"))) > 0 for item in flows[:10])
        industry = get_sector_rank()[:6]
        concept = get_concept_rank()[:6]
        fallback_active = sorted(stocks, key=lambda item: _safe_float(item.get("amount")), reverse=True)
        negative_flows = [item for item in flows if _safe_float(item.get("mainNetInflow")) < 0]
        inflow_rows = flows[:10] if has_live_flow else fallback_active[:10]
        outflow_rows = (
            sorted(negative_flows, key=lambda item: _safe_float(item.get("mainNetInflow")))[:6]
            if has_live_flow and negative_flows
            else sorted(stocks, key=lambda item: _safe_float(item.get("changePercent")))[:6]
        )
        focus_code = str(inflow_rows[0].get("code", "")) if inflow_rows else ""
        payload = {
            "updatedAt": int(time.time() * 1000),
            "summaryCards": [
                *market_summary,
                {
                    "label": has_live_flow and "主力净流入样本" or "成交额代理样本",
                    "value": round(
                        (
                            sum(_safe_float(item.get("mainNetInflow")) for item in flows[:10])
                            if has_live_flow
                            else sum(_safe_float(item.get("amount")) for item in fallback_active[:10])
                        ) / 100000000,
                        2,
                    ),
                    "detail": has_live_flow and "亿 / TOP10" or "亿 / TOP10 成交额",
                    "tone": "up",
                },
                {
                    "label": has_live_flow and "偏暖占比" or "上涨代理占比",
                    "value": f"{(sum(1 for item in inflow_rows if (_safe_float(item.get('mainNetInflow')) if has_live_flow else _safe_float(item.get('changePercent'))) > 0) / max(1, len(inflow_rows)) * 100):.0f}%",
                    "detail": has_live_flow and "TOP10 主力净流入" or "TOP10 样本上涨占比",
                    "tone": "flat",
                },
            ],
            "stockFlows": {
                "inflow": inflow_rows,
                "outflow": outflow_rows,
            },
            "boardFlows": {
                "industry": _build_board_flow_proxy(industry),
                "concept": _build_board_flow_proxy(concept),
            },
            "focusStock": {
                "code": focus_code,
                "history": has_live_flow and focus_code and get_stock_fund_flow(focus_code, 5) or [],
            },
        }
        return _cache_set(cache_key, payload)

    sorted_by_amount = sorted(stocks, key=lambda item: _safe_float(item.get("amount")), reverse=True)
    grouped = _build_theme_groups(market, stocks)
    payload = {
        "updatedAt": int(time.time() * 1000),
        "summaryCards": [
            *market_summary,
            {
                "label": "量能集中",
                "value": round(
                    sum(_safe_float(item.get("amount")) for item in sorted_by_amount[:3])
                    / max(1, sum(_safe_float(item.get("amount")) for item in stocks))
                    * 100,
                    2,
                ),
                "detail": "TOP3 样本成交占比%",
                "tone": "flat",
            },
            {
                "label": "代理资金方向",
                "value": grouped[0].get("name", "--") if grouped else "--",
                "detail": "主题成交额代理",
                "tone": "up",
            },
        ],
        "stockFlows": {
            "inflow": sorted_by_amount[:10],
            "outflow": sorted(stocks, key=lambda item: _safe_float(item.get("changePercent")))[:6],
        },
        "boardFlows": {
            "industry": grouped[:6],
            "concept": [],
        },
        "focusStock": {
            "code": sorted_by_amount[0].get("code", "") if sorted_by_amount else "",
            "history": [],
        },
    }
    return _cache_set(cache_key, payload)


def get_home_sectors(market: str = "a") -> dict:
    cache_key = f"sectors:{market}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    stocks = get_stock_list(market, 1, HOME_STOCK_SAMPLE_LIMIT).get("data", [])
    sector_bundle = _load_sector_universe(market, stocks)
    leaders = sector_bundle["leaders"]
    focus = sector_bundle["focus"]
    members = []
    if focus:
        if market == "a":
            members = get_sector_members([focus.get("code", "")], 12)[:12]
        else:
            members = focus.get("members", [])[:12]
    payload = {
        "updatedAt": int(time.time() * 1000),
        "summaryCards": [
            {
                "label": "当前主线",
                "value": focus.get("name", "--") if focus else "--",
                "detail": focus.get("leadingStock", "") if focus else "",
                "tone": _tone_from_value(_safe_float(focus.get("changePercent")) if focus else 0, 0.5),
            },
            {
                "label": "热区数量",
                "value": len(leaders),
                "detail": "可观察主题",
                "tone": "flat",
            },
            {
                "label": "主线强度",
                "value": f"{_safe_float(focus.get('changePercent')):+.2f}%" if focus else "--",
                "detail": "领先主题涨跌幅",
                "tone": _tone_from_value(_safe_float(focus.get("changePercent")) if focus else 0, 0.5),
            },
        ],
        "leaders": leaders[:12],
        "industry": sector_bundle["industry"],
        "concept": sector_bundle["concept"],
        "heatmap": _build_heatmap(leaders),
        "focusSector": focus,
        "focusMembers": members,
    }
    return _cache_set(cache_key, payload)


def _build_stock_groups(market: str, stocks: list[dict]) -> dict:
    by_change = sorted(stocks, key=lambda item: _safe_float(item.get("changePercent")), reverse=True)
    by_amount = sorted(stocks, key=lambda item: _safe_float(item.get("amount")), reverse=True)
    by_turnover = sorted(stocks, key=lambda item: _safe_float(item.get("turnover")), reverse=True)
    return {
        "leaders": by_change[:8],
        "losers": by_change[-8:][::-1],
        "active": by_amount[:10],
        "turnover": by_turnover[:8],
        "breakouts": [
            item
            for item in by_change
            if _safe_float(item.get("changePercent")) >= 3 and _safe_float(item.get("amount")) > 0
        ][:8],
        "defensive": [
            item
            for item in stocks
            if abs(_safe_float(item.get("changePercent"))) <= 1.5 and _safe_float(item.get("amount")) > 0
        ][:8],
    }


def get_home_stocks(market: str = "a") -> dict:
    cache_key = f"stocks:{market}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    stocks = get_stock_list(market, 1, HOME_STOCK_SAMPLE_LIMIT).get("data", [])
    groups = _build_stock_groups(market, stocks)
    focus = groups["active"][0] if groups["active"] else (stocks[0] if stocks else {})
    focus_code = str(focus.get("code", ""))
    focus_profile = {}
    if focus_code:
        info = get_stock_info(focus_code)
        finance = get_stock_finance(focus_code)
        focus_profile = {
            "code": focus_code,
            "info": info,
            "finance": finance,
            "fundflow": get_stock_fund_flow(focus_code, 5) if market == "a" else [],
        }
    payload = {
        "updatedAt": int(time.time() * 1000),
        "summaryCards": [
            {
                "label": "最强个股",
                "value": focus.get("name", "--"),
                "detail": f"{_safe_float(focus.get('changePercent')):+.2f}% / {_safe_float(focus.get('amount')) / 100000000:.1f}亿" if focus else "",
                "tone": _tone_from_value(_safe_float(focus.get("changePercent")) if focus else 0, 0.5),
            },
            {
                "label": "异动样本",
                "value": len([item for item in stocks if abs(_safe_float(item.get('changePercent'))) >= 2]),
                "detail": "涨跌幅绝对值 >= 2%",
                "tone": "flat",
            },
            {
                "label": "高换手样本",
                "value": len([item for item in stocks if _safe_float(item.get('turnover')) >= 8]),
                "detail": "换手 >= 8%",
                "tone": "up",
            },
        ],
        "boards": groups,
        "focusStock": focus_profile,
    }
    return _cache_set(cache_key, payload)


def get_home_news(market: str = "a") -> dict:
    cache_key = f"news:{market}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    news_items = get_financial_news(HOME_NEWS_LIMIT)
    groups, timeline, hot_topics = _build_news_groups(news_items)
    payload = {
        "updatedAt": int(time.time() * 1000),
        "summaryCards": [
            {
                "label": "快讯样本",
                "value": len(news_items),
                "detail": "最近抓取样本数",
                "tone": "flat",
            },
            {
                "label": "主题簇",
                "value": len(groups),
                "detail": "新闻主题分组",
                "tone": "up",
            },
            {
                "label": "事件线索",
                "value": len(timeline),
                "detail": "含财报/政策/宏观关键词",
                "tone": "flat",
            },
        ],
        "latest": news_items[:16],
        "groups": groups,
        "timeline": timeline,
        "hotTopics": hot_topics,
    }
    return _cache_set(cache_key, payload)


def get_home_ai_context(market: str = "a") -> dict:
    cache_key = f"ai:{market}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    overview = get_home_overview(market)
    sectors = get_home_sectors(market)
    stocks = get_home_stocks(market)
    news_payload = get_home_news(market)
    fundflow = get_home_fundflow(market)
    breadth = overview.get("breadth", {})
    focus_sector = sectors.get("focusSector") or {}
    focus_stock = (stocks.get("focusStock") or {}).get("info") or {}
    evidence_cards = [
        {
            "label": "市场宽度",
            "value": f"{_safe_float(breadth.get('positiveRatio')):.1f}%",
            "detail": f"上涨 {_safe_float(breadth.get('advance')):.0f} / 下跌 {_safe_float(breadth.get('decline')):.0f}",
            "tone": "up" if _safe_float(breadth.get("positiveRatio")) >= 55 else "flat" if _safe_float(breadth.get("positiveRatio")) >= 45 else "down",
        },
        {
            "label": "成交脉冲",
            "value": f"{_safe_float(breadth.get('totalAmount')) / 100000000:.0f}亿",
            "detail": breadth.get("sourceLabel", ""),
            "tone": "flat",
        },
        {
            "label": "主线板块",
            "value": focus_sector.get("name", "--"),
            "detail": focus_sector.get("leadingStock") or "",
            "tone": _tone_from_value(_safe_float(focus_sector.get("changePercent")), 0.5),
        },
        {
            "label": "焦点个股",
            "value": focus_stock.get("name", "--"),
            "detail": f"{_safe_float(focus_stock.get('changePercent')):+.2f}%" if focus_stock else "",
            "tone": _tone_from_value(_safe_float(focus_stock.get("changePercent")), 0.5),
        },
        {
            "label": "新闻温度",
            "value": news_payload.get("groups", [{}])[0].get("label", "中性") if news_payload.get("groups") else "中性",
            "detail": news_payload.get("latest", [{}])[0].get("title", "") if news_payload.get("latest") else "",
            "tone": "flat",
        },
        {
            "label": "资金偏暖",
            "value": fundflow.get("summaryCards", [{}])[-1].get("value", "--"),
            "detail": fundflow.get("summaryCards", [{}])[-1].get("detail", ""),
            "tone": "up",
        },
    ]
    payload = {
        "updatedAt": int(time.time() * 1000),
        "evidenceCards": evidence_cards,
        "focusThemes": sectors.get("leaders", [])[:4],
        "scenarioCards": [
            {
                "label": "延续",
                "value": "主线继续扩散",
                "detail": "上涨覆盖继续维持，主线板块和龙头成交不掉队。",
            },
            {
                "label": "分歧",
                "value": "轮动切换加快",
                "detail": "热点板块强弱差扩大，成交向少数龙头集中。",
            },
            {
                "label": "退潮",
                "value": "高位兑现增强",
                "detail": "上涨覆盖回落，活跃股回撤样本增加，消息端缺少新催化。",
            },
        ],
        "candidates": stocks.get("boards", {}).get("active", [])[:12],
        "facts": [
            f"上涨 {_safe_float(breadth.get('advance')):.0f} 家，下跌 {_safe_float(breadth.get('decline')):.0f} 家。",
            f"当前主线 {focus_sector.get('name', '待同步')}，代表股 {focus_sector.get('leadingStock', '待同步')}。",
            f"焦点个股 {focus_stock.get('name', '待同步')} 当前涨跌幅 {_safe_float(focus_stock.get('changePercent')):+.2f}%。",
            f"最近新闻主题聚焦 {news_payload.get('groups', [{}])[0].get('label', '中性')}。",
        ],
    }
    return _cache_set(cache_key, payload)
