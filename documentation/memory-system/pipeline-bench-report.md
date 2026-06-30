# Chat pipeline latency benchmark

Run: 2026-06-30T06:49:42.537Z — endpoint `ai-project-deployments-resource.services.ai.azure.com` — chat `gpt-5.4` — embed `text-embedding-3-small`

Times each model-facing step the server `runWorker` performs, against the live endpoint.

## Embedding (memory retrieval query)

| call | ms | dims | error |
|--|--|--|--|

## Agent generation — Responses API, no tools (pure model latency)

| prompt | TTFT ms | total ms | chars | tool evts | error |
|--|--|--|--|--|--|

## Agent TTFT/total stats — 3 samples/prompt (no tools)

| prompt | n | TTFT min | TTFT median | TTFT p95 | TTFT max | total median | total p95 | errors |
|--|--|--|--|--|--|--|--|--|

## Reasoning-effort sweep — chat/completions, same medium prompt

| effort | TTFT ms | total ms | chars | error |
|--|--|--|--|--|

## Tool isolation — Responses API with server/function tools (40s abort)

Simple prompt that should answer instantly; any case that stalls to ~40s reveals the hanging tool.

| tools | TTFT ms | total ms | chars | tool evts | error |
|--|--|--|--|--|--|

## Context scaling — TTFT vs input (prefill) size, no tools

One-word answer, so TTFT ≈ time to process the input. Shows how a growing thread / large memory+skills system prompt slows the first token.

| approx input tokens | n | TTFT min | TTFT median | TTFT p95 | TTFT max |
|--|--|--|--|--|--|
| ~27tok | 3 | 971 | 1888 | 3120 | 3120 |
| ~1178tok | 3 | 772 | 905 | 1001 | 1001 |
| ~4174tok | 3 | 736 | 855 | 880 | 880 |
| ~12241tok | 3 | 945 | 1019 | 1021 | 1021 |
| ~24229tok | 3 | 1005 | 1305 | 2200 | 2200 |
| ~48227tok | 2 | 1394 | 1494 | 1494 | 1494 |

