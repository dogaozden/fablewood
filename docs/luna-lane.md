# The Luna Lane — canonical harness contract

GPT-5.6-Luna via Codex CLI on the author's ChatGPT subscription (auth mode: chatgpt tokens — **NO API keys, ever**). Verified against codex-cli **0.144.6**, 2026-08-02 (luna-orch research sortie; raw evidence in that report). Every chaperone brief references THIS file instead of re-deriving the pattern.

## Canonical worker invocation (adopt everywhere)

```bash
codex exec -C <workdir> -s workspace-write \
  --json --output-schema <schema.json> -o <out.json> \
  --ephemeral --disable memories --disable goals \
  "<task prompt>"
```

Why each flag:
- `--json` — streams JSONL lifecycle events (`item.completed` per tool call, `turn.completed` with token usage) to stdout. The chaperone tails/greps this for **actual tool-call evidence**, not vibes.
- `--output-schema <FILE>` — JSON Schema for the final answer (e.g. `{status, files_changed[], tests_run, summary}`). Verified working: schema-exact output lands in the `-o` file. Machine-checkable self-report.
- `-o <file>` — final message alone, pre-parsed for jq.
- `--ephemeral` — don't grow the rollout store (already 2 GB / 360 files).
- `--disable memories --disable goals` — Codex persists memories/goals across nominally independent execs (sqlite in CODEX_HOME); parallel workers MUST NOT bleed context into each other.
- Reasoning effort: **`max` is already the global default** in ~/.codex/config.toml. Override syntax when needed: `-c model_reasoning_effort="high"` (valid: low/medium/high/xhigh/ultra/max). A blogged `-e high` shorthand does NOT exist in 0.144.6 — don't use it.
- Worktree jobs: linked worktrees need `--add-dir <main-repo>/.git` or git operations fail inside the sandbox (July lesson, still true).
- Scratch (non-repo) jobs: add `--skip-git-repo-check` and `-s read-only` where writing isn't needed.

## Parallelism

- Launch workers as **background Bash processes**; never block sequentially when tasks are independent.
- **3–5 concurrent workers** to start (reasoned recommendation, not a documented cap — quota is an aggregate 5-hour rolling window shared with cloud tasks, weighted by effort). Watch for HTTP 429 `usage_limit_reached` in the JSONL; on 429, back off and halve concurrency.
- There is no headless remaining-quota query — budget by watching 429s.
- Pre-flight a big batch with `codex doctor` (auth/feature/reachability in one shot).
- Wall-clock: even trivial prompts run ~80–90 s at high effort — budget 2+ min timeouts minimum; poll, don't wait synchronously.
- Known benign noise: repeated `codex_models_manager … failed to refresh available models: timeout` lines — does not affect the exec; ignore.

## Chaperone verification contract (non-negotiable)

1. Schema conformance ≠ truthfulness. For every worker: independently re-check **at least one** claim (`git diff --stat` on claimed files; re-run one claimed test; open the file at a cited line).
2. Grep the JSONL for real tool-call events matching the claimed work.
3. Non-conforming/empty output → ONE retry with specific corrections; still bad → report the gap honestly and move on. Never silently accept, never silently redo forever.
4. No git commits by Luna or chaperone unless the brief explicitly grants it — the orchestrator commits at the gate.

## Later-phase options (do not adopt without a new decision)

- **MCP server** — `codex mcp-server` exists; would make Luna a first-class Claude Code tool (register via `.mcp.json`: `{"mcpServers":{"codex":{"command":"codex","args":["mcp-server"]}}}`). Single-shot calls are the safe mode; **multi-turn is broken upstream** (`codex-reply` never gets a conversationId — openai/codex #8580 et al.; workaround: `structuredContent.threadId`). Registration is a config change — **the author's call only**.
- **Cloud tasks** — exist on the $20 Plus plan (10–60 tasks / 5-hr window, shared quota with local exec); `codex cloud exec --env <ID>` needs a pre-configured environment (web UI + GitHub) that is NOT yet verified for this repo. Has built-in `--attempts N` best-of-N.
- **Luna-internal subagents** — `multi_agent` is stable and enabled (cap 8 threads/session); a task prompt may tell Luna to split work internally. Use only under the #1 wrapper: chaperone verification granularity drops, so the final schema'd output still gets independently checked.
- **app-server daemon / exec-server** — experimental/immature; startup cost is not the bottleneck (reasoning latency is). Skip unless a concrete need appears.

Source: luna-orch-research-sonnet report, 2026-08-02, with live smoke-test evidence; upstream refs cited there.
