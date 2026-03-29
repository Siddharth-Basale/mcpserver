"""Run the MCP server with streamable HTTP so browser clients can connect."""

from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from mcp_server.main import mcp


def _normalize_origin(origin: str) -> str:
    """Browsers send Origin without a trailing slash; strip whitespace and trailing '/'."""
    o = origin.strip()
    while len(o) > 1 and o.endswith("/"):
        o = o[:-1]
    return o


def _cors_origins() -> list[str]:
    raw = os.getenv(
        "MCP_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    )
    return [_normalize_origin(x) for x in raw.split(",") if x.strip()]


def _cors_origin_regex() -> str | None:
    """Optional regex (e.g. https://.*\\.onrender\\.com) so SPA origins need not be listed one-by-one."""
    r = os.getenv("MCP_CORS_ORIGIN_REGEX", "").strip()
    return r or None


def main() -> None:
    load_dotenv()
    origins = _cors_origins()
    origin_regex = _cors_origin_regex()
    middleware = [
        Middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_origin_regex=origin_regex,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["*"],
        ),
    ]
    host = "0.0.0.0"
    port = int(os.environ.get("PORT", 8000))

    asyncio.run(
        mcp.run_http_async(
            host=host,
            port=port,
            transport="streamable-http",
            path="/mcp",
            middleware=middleware,
        )
    )


if __name__ == "__main__":
    main()
