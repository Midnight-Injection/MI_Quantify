# -*- mode: python ; coding: utf-8 -*-
import importlib
import os

def _pkg_data_glob(pkg_name: str, subdir: str) -> list[tuple[str, str]]:
    """Resolve (source, dest) pairs for a package's data subdirectory."""
    mod = importlib.import_module(pkg_name.replace('/', '.'))
    pkg_dir = os.path.dirname(mod.__file__)
    src = os.path.join(pkg_dir, subdir)
    if not os.path.isdir(src):
        raise SystemExit(f"ERROR: data dir not found: {src}")
    return [(src, os.path.join(pkg_name, subdir))]

akshare_datas = _pkg_data_glob('akshare', 'file_fold')

# 排除不需要的子包以减小体积
EXCLUDE_LIST = [
    'numpy.distutils',
    'numpy.f2py',
    'numpy.tests',
    'scipy.tests',
]

a = Analysis(
    ['run.py'],
    pathex=['.'],
    binaries=[],
    datas=akshare_datas,
    hiddenimports=[
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'uvicorn.lifespan.off',
        'yfinance',
        'pandas',
        'numpy',
        'numpy._core',
        'numpy._core._methods',
        'numpy._core._dtype_ctypes',
        'scipy',
        'scipy._lib',
        'scipy._lib.messagestream',
        'peewee',
        'multitasking',
        'websockets',
        'platformdirs',
        'pytz',
        'app',
        'app.main',
        'app.routers',
        'app.routers.finance',
        'app.routers.fundflow',
        'app.routers.home',
        'app.routers.investment',
        'app.routers.kline',
        'app.routers.market',
        'app.routers.news',
        'app.routers.openclaw',
        'app.routers.etf',
        'app.routers.sector',
        'app.services',
        'app.services.etf_service',
        'app.services.datasource_registry',
        'app.services.finance_remote_fetchers',
        'app.services.finance_service',
        'app.services.fundflow_service',
        'app.services.home_service',
        'app.services.investment_service',
        'app.services.kline_remote_fetchers',
        'app.services.kline_service',
        'app.services.market_remote_fetchers',
        'app.services.market_service',
        'app.services.network_env',
        'app.services.news_remote_fetchers',
        'app.services.news_service',
        'app.services.openclaw_service',
        'app.services.remote_api',
        'app.services.search_service',
        'app.services.sector_service',
        'app.services.stock_service',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=EXCLUDE_LIST,
    noarchive=False,
)

pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='mi-quantify-sidecar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
)
