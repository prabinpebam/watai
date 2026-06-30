# TTFT browser benchmark (real Edge session)

Run: 2026-06-30T10:14:05.356Z — https://prabinpebam.github.io/watai/ — 5 reps/prompt. TTFT = send → first assistant token in the DOM.

| prompt | n | TTFT min | TTFT median | TTFT p95 | total median | POST /runs median |
|--|--|--|--|--|--|--|
| Hi | 5 | 66 | 9166 | 20617 | 13646 | 0 |
| What is the capital of France? | 5 | 7668 | 8482 | 17190 | 13237 | 0 |
| Explain how DNS resolution works in 3 sentences. | 5 | 7735 | 8124 | 18396 | 13677 | 0 |
| Write a TypeScript debounce function. | 5 | 7960 | 8086 | 8344 | 13520 | 0 |

_ms unless noted. Per-rep raw data in the sibling .json._
