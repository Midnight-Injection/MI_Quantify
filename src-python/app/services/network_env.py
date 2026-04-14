import os
import requests


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


def create_http_session(referer: str = "https://finance.sina.com.cn") -> requests.Session:
    session = requests.Session()
    proxy_mode = resolve_proxy_mode()
    use_system_proxy = proxy_mode == "system" or (proxy_mode == "auto" and has_proxy_env())

    if use_system_proxy:
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
