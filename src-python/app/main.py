import json
import math
import os
from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.routers import market, kline, sector, fundflow, news, openclaw, finance, investment, home, etf
from app.services.network_env import clear_proxy_env, register_proxies
from app.services.datasource_registry import register_sources

clear_proxy_env()


class _SafeEncoder(json.JSONEncoder):
    """将 NaN / Infinity 等非标准 JSON 值转为 None，防止序列化报错"""

    def default(self, o):
        return super().default(o)

    def encode(self, o):
        return super().encode(self._sanitize(o))

    def iterencode(self, o, _one_shot=False):
        return super().iterencode(self._sanitize(o), _one_shot)

    @staticmethod
    def _sanitize(obj):
        if isinstance(obj, float):
            if math.isnan(obj) or math.isinf(obj):
                return None
            return obj
        if isinstance(obj, dict):
            return {k: _SafeEncoder._sanitize(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [_SafeEncoder._sanitize(v) for v in obj]
        return obj


class SafeJSONResponse(JSONResponse):
    def render(self, content) -> bytes:
        return json.dumps(
            content,
            ensure_ascii=False,
            allow_nan=False,
            cls=_SafeEncoder,
        ).encode("utf-8")


app = FastAPI(
    title="MI Quantify Sidecar",
    version="0.2.1",
    default_response_class=SafeJSONResponse,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(market.router, prefix="/api/market", tags=["market"])
app.include_router(kline.router, prefix="/api/kline", tags=["kline"])
app.include_router(sector.router, prefix="/api/sector", tags=["sector"])
app.include_router(fundflow.router, prefix="/api/fundflow", tags=["fundflow"])
app.include_router(news.router, prefix="/api/news", tags=["news"])
app.include_router(openclaw.router, prefix="/api/openclaw", tags=["openclaw"])
app.include_router(finance.router, prefix="/api/finance", tags=["finance"])
app.include_router(investment.router, prefix="/api/investment", tags=["investment"])
app.include_router(home.router, prefix="/api/home", tags=["home"])
app.include_router(etf.router, prefix="/api/etf", tags=["etf"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "mi-quantify-sidecar", "version": "0.2.1"}


@app.post("/api/proxy/register")
async def proxy_register(payload: dict = Body(default={})):
    proxies = payload.get("proxies", []) or []
    register_proxies(proxies)
    return {"status": "ok", "count": len(proxies)}


@app.post("/api/datasource/register")
async def datasource_register(payload: dict = Body(default={})):
    sources = payload.get("sources", []) or []
    register_sources(sources)
    return {"status": "ok", "count": len(sources)}
