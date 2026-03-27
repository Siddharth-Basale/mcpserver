from __future__ import annotations

import json

import httpx

from mcp_server.config import Settings
from mcp_server.tools.schemas import DiagnosisResult, PatchGenerationResult, PipelineContext


SYSTEM_PROMPT = """You are a CI/CD repair agent.
Return strict JSON with keys:
summary, root_cause, confidence, proposed_fix, risk_score, reason_codes.
Keep risk_score in [0,1], higher means riskier autonomous remediation.
"""

PATCH_PROMPT = """You are an autonomous code repair agent.
Generate a unified diff patch that fixes the CI failure.
Rules:
- Output strict JSON with keys: patch, rationale, touched_files.
- patch must be valid unified diff with file headers:
  --- a/<path>
  +++ b/<path>
- Only include files that already exist in provided file contents.
- Keep patch minimal and focused on fixing failing tests/build.
- Do not include markdown fences.
- Prefer using the relevant line-grounded context below when selecting exact lines for patch hunks.
"""

RETRIEVAL_QUERY_PROMPT = """You generate one high-signal code search query for retrieval.
Return strict JSON with key:
- query

Rules:
- Query must target files that likely need editing for the failure.
- Include concrete file/path hints when relevant (e.g., .github/workflows/ci.yml, requirements.txt, pyproject.toml).
- Keep it concise and specific for lexical/symbol search (single line).
- Do not include markdown fences or extra keys.
"""


async def diagnose_failure(settings: Settings, context: PipelineContext) -> DiagnosisResult:
    payload = {
        "model": settings.OPENAI_MODEL,
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": SYSTEM_PROMPT}]},
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            f"Repository: {context.repository}\n"
                            f"Run ID: {context.run_id}\n"
                            f"Commit: {context.commit_sha}\n"
                            f"Changed files: {context.changed_files}\n"
                            f"Failing tests: {context.failing_tests}\n"
                            f"Logs:\n{context.logs_excerpt}"
                        ),
                    }
                ],
            },
        ],
        "text": {"format": {"type": "json_object"}},
    }
    headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/responses",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

    raw_text = _extract_text_output(data)
    parsed = json.loads(raw_text)
    return DiagnosisResult.model_validate(parsed)


def _extract_text_output(response: dict) -> str:
    for item in response.get("output", []):
        if item.get("type") != "message":
            continue
        for block in item.get("content", []):
            if block.get("type") == "output_text":
                return block.get("text", "{}")
    return "{}"


async def generate_patch_with_llm(
    settings: Settings,
    context: PipelineContext,
    diagnosis: DiagnosisResult,
    file_contents: dict[str, str],
    retrieval_context: str,
    previous_attempt_feedback: str = "",
) -> PatchGenerationResult:
    files_blob = "\n\n".join(
        f"### FILE: {path}\n{content}"
        for path, content in file_contents.items()
    )
    payload = {
        "model": settings.OPENAI_MODEL,
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": PATCH_PROMPT}]},
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            f"Repository: {context.repository}\n"
                            f"Run ID: {context.run_id}\n"
                            f"Diagnosis summary: {diagnosis.summary}\n"
                            f"Root cause: {diagnosis.root_cause}\n"
                            f"Proposed fix: {diagnosis.proposed_fix}\n"
                            f"Failing tests: {context.failing_tests}\n"
                            f"Relevant indexed code context:\n{retrieval_context}\n\n"
                            f"Attempt feedback: {previous_attempt_feedback}\n"
                            f"Logs excerpt:\n{context.logs_excerpt}\n\n"
                            f"Available files (edit only these):\n{files_blob}\n"
                        ),
                    }
                ],
            },
        ],
        "text": {"format": {"type": "json_object"}},
    }
    headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/responses",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json()
    raw_text = _extract_text_output(data)
    parsed = json.loads(raw_text)
    result = PatchGenerationResult.model_validate(parsed)
    if len(result.patch) > settings.LLM_PATCH_MAX_CHARS:
        result.patch = result.patch[: settings.LLM_PATCH_MAX_CHARS]
    return result


async def generate_retrieval_query_with_llm(
    settings: Settings,
    context: PipelineContext,
    diagnosis: DiagnosisResult,
    candidate_paths: list[str],
) -> str:
    payload = {
        "model": settings.OPENAI_MODEL,
        "input": [
            {"role": "system", "content": [{"type": "input_text", "text": RETRIEVAL_QUERY_PROMPT}]},
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            f"Repository: {context.repository}\n"
                            f"Run ID: {context.run_id}\n"
                            f"Diagnosis summary: {diagnosis.summary}\n"
                            f"Root cause: {diagnosis.root_cause}\n"
                            f"Failing tests: {context.failing_tests}\n"
                            f"Changed files: {context.changed_files}\n"
                            f"Candidate files: {candidate_paths}\n"
                            f"Logs excerpt:\n{context.logs_excerpt[:2500]}"
                        ),
                    }
                ],
            },
        ],
        "text": {"format": {"type": "json_object"}},
    }
    headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            "https://api.openai.com/v1/responses",
            headers=headers,
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

    raw_text = _extract_text_output(data)
    parsed = json.loads(raw_text)
    query = str(parsed.get("query", "")).strip()
    return query

