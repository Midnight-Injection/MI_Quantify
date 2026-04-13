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


def clear_proxy_env() -> None:
    for key in _PROXY_KEYS:
        os.environ.pop(key, None)
    os.environ["NO_PROXY"] = "*"
    os.environ["no_proxy"] = "*"


def create_http_session(referer: str = "https://finance.sina.com.cn") -> requests.Session:
    clear_proxy_env()
    session = requests.Session()
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
