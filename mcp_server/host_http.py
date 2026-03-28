"""Run the MCP server with streamable HTTP so browser clients can connect."""

from __future__ import annotations

import asyncio
import os

from dotenv import load_dotenv
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware

from mcp_server.main import mcp


def _cors_origins() -> list[str]:
    raw = os.getenv(
        "MCP_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    )
    return [x.strip() for x in raw.split(",") if x.strip()]


def main() -> None:
    load_dotenv()
    origins = _cors_origins()
    middleware = [
        Middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
            expose_headers=["*"],
        ),
    ]
    host = os.getenv("MCP_HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.getenv("MCP_PORT", "8000"))

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
