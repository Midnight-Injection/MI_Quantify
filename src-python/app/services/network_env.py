import os
import requests
from urllib.parse import urlparse


_PROXY_KEYS = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "http_proxy",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
)
_ORIGINAL_PROXY_ENV = {key: os.environ.get(key, "") for key in _PROXY_KEYS}
_PROXY_MODE_ENV = "MIQ_PROXY_MODE"
_DEFAULT_PROXY_ID = "__local_default_proxy_127001_7890__"
_DEFAULT_PROXY = {
    "id": _DEFAULT_PROXY_ID,
    "name": "Local Proxy 127.0.0.1:7890",
    "host": "127.0.0.1",
    "port": 7890,
    "protocol": "http",
    "username": "",
    "password": "",
    "enabled": True,
}
_DIRECT_HOST_SUFFIXES = (
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "1",
    "sina.com.cn",
    "sinajs.cn",
    "sina.cn",
    "eastmoney.com",
    "eastmoney.com.cn",
)

_PROXY_REGISTRY: dict[str, dict] = {}


def clear_proxy_env() -> None:
    for key in _PROXY_KEYS:
        os.environ.pop(key, None)
    os.environ["NO_PROXY"] = "*"
    os.environ["no_proxy"] = "*"


def resolve_proxy_mode() -> str:
    mode = str(os.environ.get(_PROXY_MODE_ENV, "auto") or "auto").strip().lower()
    if mode in {"auto", "direct", "system"}:
        return mode
    return "auto"


def has_proxy_env() -> bool:
    return any(str(os.environ.get(key, "") or "").strip() for key in _PROXY_KEYS)


def register_proxies(proxies: list[dict]) -> None:
    _PROXY_REGISTRY.clear()
    for p in proxies:
        if p.get("id"):
            _PROXY_REGISTRY[p["id"]] = p


def build_proxy_url(proxy: dict) -> str | None:
    host = (proxy.get("host") or "").strip()
    if not host:
        return None
    port = proxy.get("port", 7890)
    protocol = proxy.get("protocol", "http")
    username = (proxy.get("username") or "").strip()
    password = (proxy.get("password") or "").strip()
    if username and password:
        return f"{protocol}://{username}:{password}@{host}:{port}"
    return f"{protocol}://{host}:{port}"


def resolve_proxy_for_id(proxy_id: str | None) -> dict | None:
    if not proxy_id:
        return None
    proxy = _PROXY_REGISTRY.get(proxy_id)
    if proxy is None and proxy_id == _DEFAULT_PROXY_ID:
        proxy = _DEFAULT_PROXY
    if not proxy or not proxy.get("enabled", True):
        return None
    url = build_proxy_url(proxy)
    if not url:
        return None
    return {"http": url, "https": url}


def _get_default_proxy_id() -> str | None:
    for proxy in _PROXY_REGISTRY.values():
        if proxy.get("enabled", True) and str(proxy.get("host", "")).strip():
            return str(proxy.get("id"))
    if _DEFAULT_PROXY.get("enabled") and _DEFAULT_PROXY.get("host"):
        return _DEFAULT_PROXY_ID
    return None


def should_use_proxy_for_url(target_url: str | None) -> bool:
    if not target_url:
        return False
    try:
        hostname = (urlparse(target_url).hostname or "").strip().lower()
    except Exception:
        return False
    if not hostname:
        return False
    if hostname in {"localhost", "127.0.0.1", "0.0.0.0"}:
        return False
    return not any(
        hostname == suffix or hostname.endswith(f".{suffix}")
        for suffix in _DIRECT_HOST_SUFFIXES
    )


def resolve_proxy_for_target(
    target_url: str | None = None, proxy_id: str | None = None
) -> dict | None:
    if proxy_id:
        return resolve_proxy_for_id(proxy_id)
    if should_use_proxy_for_url(target_url):
        return resolve_proxy_for_id(_get_default_proxy_id())
    return None


def create_http_session(
    referer: str = "https://finance.sina.com.cn",
    proxy_id: str | None = None,
    target_url: str | None = None,
) -> requests.Session:
    session = requests.Session()
    proxy_mode = resolve_proxy_mode()
    use_system_proxy = proxy_mode == "system" or (
        proxy_mode == "auto" and has_proxy_env()
    )

    proxy_dict = resolve_proxy_for_target(target_url, proxy_id)
    if proxy_dict:
        session.trust_env = False
        session.proxies.update(proxy_dict)
    elif target_url and not should_use_proxy_for_url(target_url):
        session.trust_env = False
        session.proxies.clear()
    elif use_system_proxy:
        session.trust_env = True
    else:
        session.trust_env = False
        session.proxies.clear()
    session.headers.update(
        {
            "Referer": referer,
            "User-Agent": "Mozilla/5.0",
        }
    )
    return session


def get_original_proxy_env() -> dict[str, str]:
    return {key: value for key, value in _ORIGINAL_PROXY_ENV.items() if value}
