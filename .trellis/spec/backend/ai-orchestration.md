# AI Orchestration Conventions

Established in task `11-24-ai-orchestration`. Rationale: that task's `design.md`.

## Ownership

- **The backend owns every prompt.** Templates live in `backend/app/ai/prompts/` (`system.md`, `role.md`, `modes/*.md`, `fragments.toml` with `${name}` placeholders). The frontend sends data only: project snapshot, user text, options, and catalog hints as structured fields.
- Request models for AI endpoints use `extra="forbid"`: a client sending `messages`, `system` or `model` gets 422. Never add a field that lets the client inject instructions or pick a model.
- Assembly (`app/ai/assemble.py`) works on the raw snapshot dicts and reproduces JavaScript semantics (`undefined`, truthiness, `Math.round`, number printing). Keep that when editing; `tests/test_assemble_golden.py` compares against 45 captured cases from the original frontend. A deliberate behaviour change goes into `INTENTIONAL_CHANGES` with a reason, never by re-capturing the golden file.

## Changing prompts (user rule: CI never calls models)

1. Edit the templates, assembly or `backend/evals/cases.json`.
2. Bump `backend/app/ai/prompts/VERSION` (`<yyyy-mm-dd.n> <sha256>`); `test_version_matches_template_content` prints the new hash.
3. Run the live evaluation with the real model from `.env`: `cd backend && uv run python -m evals.run --live` (or `--only <ids>`).
4. Commit `docs/evals/` together with the change.

CI replays `docs/evals/recordings.json`: every case's messages hash must match the current assembly, and the checks must reproduce the recorded results. A stale recording fails with the exact case ids to re-run.

## Structured output

- Each generation mode has a Pydantic model in `app/ai/schemas.py`; field names match what the frontend reads, so no adapter exists.
- Send `strict_json_schema(model)`: structure only (fields, types, enums). Counts and lengths are validated locally; OpenAI strict mode rejects `minItems`/`maxLength`.
- Path: `structured_completion()` in `app/ai/plan.py` — strict schema → validate → one repair retry with the validation errors → `StructuredOutputInvalid` (502, `structured_output_invalid`). The API and the evaluation both call it.
- `LLM_STRUCTURED_OUTPUT=prompt` for providers without JSON-schema support.

## Providers

- `app/ai/providers/`: `LLMProvider` (`stream_chat`, `complete_json`), `VisionProvider`, sync / async image generation. Implementations: OpenAI-compatible, Kling, Mock.
- Providers never see user URLs. The service layer resolves image references through `ai.image_refs` and passes bytes (`ResolvedImage`); async providers that fetch images themselves (Kling) receive only public URLs of validated keys.
- Provider selection: `AI_PROVIDER=auto` uses real models when `LLM_API_KEY` is set and demo mode otherwise; an explicit `openai` without a key is a 503, never a silent fallback.

## Demo mode

- Demo output must be honest: replies carry the demo tag, the UI shows 「演示模式」, and image generation works only for sample venues (user photos are refused, never replaced by a sample image).
- Scripted chat replies (`mock_chat.py`) must use the same protocol lines as real replies (建议方向 / 建议主题 / ```调整建议```). `tests/test_ai_providers.py` parses them with the frontend's patterns.
- Mock structured fixtures live in `providers/mock_fixtures/` and must pass the same Pydantic validation (tested).

## Tests stay hermetic

- `conftest.py` sets `SCENEFLOW_IGNORE_DOTENV=1` and clears key variables before importing the app, so tests never read a developer's `.env` or real keys.
- Real-model checks are manual and happen when the change is made (live eval, or the Docker stack with `.env`), not in CI.
