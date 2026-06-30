# Chat pipeline latency benchmark

Run: 2026-06-30T02:43:38.573Z — endpoint `ai-project-deployments-resource.cognitiveservices.azure.com` — chat `gpt-5.4` — embed `text-embedding-3-small`

Times each model-facing step the server `runWorker` performs, against the live endpoint.

## Embedding (memory retrieval query)

| call | ms | dims | error |
|--|--|--|--|

## Agent generation — Responses API, no tools (pure model latency)

| prompt | TTFT ms | total ms | chars | tool evts | error |
|--|--|--|--|--|--|

## Reasoning-effort sweep — chat/completions, same medium prompt

| effort | TTFT ms | total ms | chars | error |
|--|--|--|--|--|

## Tool isolation — Responses API with server/function tools (40s abort)

Simple prompt that should answer instantly; any case that stalls to ~40s reveals the hanging tool.

| tools | TTFT ms | total ms | chars | tool evts | error |
|--|--|--|--|--|--|
| real ws+img+ci(skills) #1 | — | 40012 | 0 | 0 | This operation was aborted |
| real ws+img+ci(skills) #2 | — | 40001 | 0 | 0 | This operation was aborted |
| real ws+img+ci(skills) #3 | — | 40002 | 0 | 0 | This operation was aborted |
| fallback ws+img (no ci) | 2624 | 2912 | 11 | 0 |  |
| ci(skills) alone | 36173 | 36393 | 11 | 0 |  |

