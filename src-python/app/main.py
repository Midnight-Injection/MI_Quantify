import os
from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from app.routers import market, kline, sector, fundflow, news, openclaw, finance, investment, home
from app.services.network_env import register_proxies

for k in [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
]:
    os.environ.pop(k, None)
os.environ["no_proxy"] = "*"
os.environ["NO_PROXY"] = "*"

app = FastAPI(title="MI Quantify Sidecar", version="0.1.1")

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


@app.get("/health")
async def health():
    return {"status": "ok", "service": "mi-quantify-sidecar"}


@app.post("/api/proxy/register")
async def proxy_register(payload: dict = Body(default={})):
    proxies = payload.get("proxies", []) or []
    register_proxies(proxies)
    return {"status": "ok", "count": len(proxies)}
