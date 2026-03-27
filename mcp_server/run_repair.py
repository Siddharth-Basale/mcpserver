from __future__ import annotations

import asyncio
import json
import os

from dotenv import load_dotenv

from mcp_server.config import get_settings
from mcp_server.main import orchestrate_autofix
from mcp_server.tools.github_client import GitHubClient


def _compact_output(result: dict) -> dict:
    pr = result.get("pull_request") or {}
    analysis = result.get("analysis") or {}
    diagnosis = analysis.get("diagnosis") or {}
    governance = analysis.get("governance") or {}
    context = analysis.get("context") or {}
    attempts = result.get("attempts") or []

    return {
        "status": result.get("status"),
        "repository": context.get("repository"),
        "run_id": context.get("run_id"),
        "pull_request": {
            "number": pr.get("number"),
            "html_url": pr.get("html_url"),
            "branch": ((pr.get("head") or {}).get("ref") if isinstance(pr, dict) else None),
        },
        "diagnosis": {
            "summary": diagnosis.get("summary"),
            "root_cause": diagnosis.get("root_cause"),
            "risk_score": diagnosis.get("risk_score"),
        },
        "governance": {
            "decision": governance.get("decision"),
            "rationale": governance.get("rationale"),
        },
        "indexing_debug": result.get("indexing_debug"),
        "attempts": attempts,
    }


async def _main() -> int:
    load_dotenv()
    repository = os.getenv("REPOSITORY", "").strip()
    run_id_raw = os.getenv("RUN_ID", "").strip()
    workflow_name = os.getenv("WORKFLOW_NAME", "").strip()
    base_branch = os.getenv("BASE_BRANCH", "main").strip() or "main"

    if not repository:
        print("REPOSITORY is required.")
        return 1

    if run_id_raw:
        try:
            run_id = int(run_id_raw)
        except ValueError:
            print("RUN_ID must be an integer.")
            return 1
    else:
        settings = get_settings()
        github = GitHubClient(settings.GITHUB_TOKEN)
        run_id = await github.get_latest_failed_run_id(repository=repository, workflow_name=workflow_name)
        if not run_id:
            if workflow_name:
                print(f"No failed runs found for workflow '{workflow_name}' in {repository}.")
            else:
                print(f"No failed runs found in {repository}.")
            return 1
        print(f"Using latest failed run id: {run_id}")

    result = await orchestrate_autofix(repository=repository, run_id=run_id, base_branch=base_branch)
    print(json.dumps(_compact_output(result), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))

