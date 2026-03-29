# Agentic CI/CD MCP Orchestrator

Python MCP server for GitHub Actions failure diagnosis, LLM-driven unified-diff auto-repair PR creation, and governed release orchestration.

## What this provides

- MCP tooling to inspect failed workflow runs using commit, logs, and test signals.
- LLM diagnosis flow powered by OpenAI `gpt-4o-mini`.
- Governance layer to auto-fix low-risk issues and require human review for risky changes.
- Generic model-driven repair loop (up to 3 attempts) using unified diff patches.
- GitHub Actions workflows for CI, repair orchestration, and release policy gating.

## Project layout

- `mcp_server/main.py` - MCP tools and orchestration entrypoints
- `mcp_server/host_http.py` - streamable HTTP MCP server for browser clients
- `mcp_server/run_repair.py` - workflow-safe command runner
- `frontend/` - Vite + React MCP client UI
- `mcp_server/config.py` - typed environment config
- `mcp_server/tools/*` - GitHub, diagnosis, risk, and PR automation modules
- `.github/workflows/*` - CI/CD automation workflows

## Setup

1. Create and activate a virtual environment.
2. Install dependencies:
   - `pip install -r requirements.txt`
3. Copy environment defaults:
   - `cp .env.example .env` (or create `.env` manually on Windows)
4. Fill in required values (`OPENAI_API_KEY`, `GITHUB_TOKEN`).

## Run MCP server locally

- **stdio (Cursor / Claude Desktop):** `python -m mcp_server.main`

## Web UI (browser MCP client + hosted server)

The `frontend` app is a real MCP client using streamable HTTP. Secrets stay on the server; the browser only talks MCP.

1. **Terminal A — MCP over HTTP** (from repo root, with `.env` configured):

   ```bash
   python -m mcp_server.host_http
   ```

   Listens on `0.0.0.0` and **`PORT`** from the environment (Render sets this). Path: `/mcp`.

2. **Terminal B — SPA dev server:**

   ```bash
   cd frontend
   npm install
   cp .env.example .env
   npm run dev
   ```

   Configure `frontend/.env`: **`VITE_MCP_URL`** is the MCP endpoint (default `http://127.0.0.1:8000/mcp`). It pre-fills the UI and sets the Vite dev proxy target origin. Clear the field to use same-origin `/mcp` (proxied to that origin).

3. Open the Vite URL (usually `http://localhost:5173`).

**Production CORS:** the browser sends an `Origin` header; the MCP server must allow it or preflight (`OPTIONS`) fails (often surfaced as **Failed to fetch**).

- Set **`MCP_CORS_ORIGINS`** to a comma-separated list of **exact** SPA origins (for example `https://your-frontend.onrender.com`).
- Or set **`MCP_CORS_ORIGIN_REGEX`** (for example `https://.*\.onrender\.com`) to allow all Render app URLs without listing each one (tighter regex is better for production).

**Render (two services):** one Web Service should run **`python -m mcp_server.host_http`** (the MCP API). A second service or Static Site can serve the built SPA (`npm run build` output). Set **`VITE_MCP_URL`** at **frontend build time** to the **MCP service URL** (for example `https://your-mcp-api.onrender.com/mcp`), not the static site URL, unless you use a reverse proxy that mounts both. If you only run **`vite preview`** on Render, that process does **not** expose the Python MCP server — `/mcp` will not work there.

**GET /mcp → 406** in logs usually means something opened `/mcp` in a normal browser tab (wrong `Accept` header); the MCP client uses POST/SSE and is unaffected.

**MCP tools exposed:** `resolve_latest_failed_run`, `inspect_pipeline_failure`, `orchestrate_autofix` (same behavior as the CLI, with `resolve_latest_failed_run` matching `run_repair` when `RUN_ID` is omitted).

**Client timeouts:** The MCP TypeScript SDK defaults to **60 seconds** per request. `orchestrate_autofix` often runs longer (LLMs, GitHub). The SPA uses **15 minutes** for `orchestrate_autofix` and **2 minutes** for `resolve_latest_failed_run` unless you set `VITE_MCP_ORCHESTRATE_TIMEOUT_MS` / `VITE_MCP_RESOLVE_TIMEOUT_MS` in `frontend/.env` (milliseconds).

## Use in Cursor as MCP

- MCP config is included at `.cursor/mcp.json`.
- Restart Cursor so it loads the MCP server definition.
- Ensure your `.env` has `OPENAI_API_KEY` and `GITHUB_TOKEN`.
- In Cursor chat, call tools from `agentic-cicd-orchestrator` with:
  - `repository`: `owner/repo`
  - `run_id`: workflow run id (integer)
- Main tools:
  - `inspect_pipeline_failure`
  - `resolve_latest_failed_run`
  - `orchestrate_autofix`

## Run repair orchestration manually

- Set `REPOSITORY` (for example `org/repo`).
- Optional:
  - `RUN_ID` (if omitted, latest failed run is auto-selected)
  - `WORKFLOW_NAME` (filter latest failed run by workflow name, e.g. `ci`)
  - `BASE_BRANCH` (default `main`)
- Execute: `python -m mcp_server.run_repair`

## LLM auto-repair controls

- `MAX_REPAIR_ATTEMPTS` - number of patch generation/application retries (default `3`).
- `PATCH_STRATEGY` - patch format expected from model (must be `unified_diff`).
- `LLM_PATCH_MAX_CHARS` - upper bound on patch payload size.

## Governance model

- `risk_score < RISK_AUTO_FIX_THRESHOLD` -> autonomous auto-fix PR path.
- `RISK_AUTO_FIX_THRESHOLD <= risk_score < RISK_HUMAN_REVIEW_THRESHOLD` -> human approval required.
- `risk_score >= RISK_HUMAN_REVIEW_THRESHOLD` or high-risk file categories -> blocked/review-only path.
- `FORCE_AUTOFIX_ALL=true` -> bypass thresholds and force auto-fix path (dangerous; use only in controlled testing).

## Security notes

- Use least-privilege GitHub credentials.
- Keep production deployment credentials separate from auto-repair identity.
- Review generated PRs and audit artifacts before enabling automerge in production.

