# TTFT browser benchmark (real Edge session)

Run: 2026-06-30T13:27:19.732Z — https://prabinpebam.github.io/watai/ — 5 reps/prompt. TTFT = send → first assistant token in the DOM.

| prompt | n | TTFT min | TTFT median | TTFT p95 | total median |
|--|--|--|--|--|--|
| Hi | 4 | 7307 | 8051 | 8961 | 12544 |
| What is the capital of France? | 5 | 6539 | 7797 | 8672 | 12472 |
| Explain how DNS resolution works in 3 sentences. | 5 | 6967 | 7042 | 7208 | 12379 |
| Write a TypeScript debounce function. | 5 | 6578 | 8001 | 8884 | 13322 |

### Client-side API calls (median across reps)

| endpoint | calls | median ms | p95 ms |
|--|--|--|--|
| GET /api/me | 1 | 1175 | 1175 |
| GET /api/skills | 39 | 1011 | 1731 |
| POST /api/threads/:id/runs | 19 | 898 | 1259 |
| POST /api/threads/:id/messages | 20 | 839 | 934 |
| GET /api/threads/:id/runs/:id | 19 | 819 | 842 |
| GET /api/threads | 86 | 813 | 1489 |
| POST /api/threads | 20 | 807 | 945 |
| GET /api/threads/:id/lock | 42 | 802 | 1163 |
| GET /api/credentials | 5 | 790 | 1412 |
| GET /api/threads/:id/messages | 167 | 465 | 879 |
| POST /api/negotiate | 3 | 390 | 1183 |

_ms unless noted. Per-rep raw data in the sibling .json._
