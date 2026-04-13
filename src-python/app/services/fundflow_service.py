import time
from app.services.network_env import clear_proxy_env

clear_proxy_env()

import akshare as ak

_CACHE_TTL_SECONDS = 60
_fund_flow_cache = {"data": [], "updated": 0.0}


def get_fund_flow(rank: int = 50) -> list[dict]:
    if _fund_flow_cache["data"] and (time.time() - _fund_flow_cache["updated"] < _CACHE_TTL_SECONDS):
        return list(_fund_flow_cache["data"])[:rank]
    try:
        df = ak.stock_individual_fund_flow_rank(indicator="今日")
        result = []
        for _, row in df.head(rank).iterrows():
            item = {
                "code": row.get("代码", ""),
                "name": row.get("名称", ""),
                "mainNetInflow": float(row.get("主力净流入-净额", 0) or 0),
                "mainNetInflowPercent": float(row.get("主力净流入-净占比", 0) or 0),
                "superLargeNetInflow": float(row.get("超大户净流入-净额", 0) or 0),
                "largeNetInflow": float(row.get("大户净流入-净额", 0) or 0),
                "mediumNetInflow": float(row.get("中户净流入-净额", 0) or 0),
                "smallNetInflow": float(row.get("散户净流入-净额", 0) or 0),
            }
            result.append(item)
        _fund_flow_cache["data"] = result
        _fund_flow_cache["updated"] = time.time()
        return result[:rank]
    except Exception as e:
        print(f"[fundflow] error: {e}")
        return list(_fund_flow_cache["data"])[:rank]
