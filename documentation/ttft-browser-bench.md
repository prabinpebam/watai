# TTFT browser benchmark (real Edge session)

Run: 2026-06-30T13:40:21.511Z — https://prabinpebam.github.io/watai/ — 5 reps/prompt. TTFT = send → first assistant token in the DOM.

| prompt | n | TTFT min | TTFT median | TTFT p95 | total median |
|--|--|--|--|--|--|
| Hi | 5 | 4086 | 4571 | 8010 | 10010 |
| What is the capital of France? | 5 | 3202 | 3999 | 5230 | 9954 |
| Explain how DNS resolution works in 3 sentences. | 5 | 3533 | 4094 | 4417 | 10952 |
| Write a TypeScript debounce function. | 5 | 4483 | 5215 | 5466 | 12272 |

### Client-side API calls (median across reps)

| endpoint | calls | median ms | p95 ms |
|--|--|--|--|
| GET /api/me | 1 | 1764 | 1764 |
| GET /api/credentials | 4 | 1324 | 2261 |
| GET /api/threads | 70 | 1177 | 1781 |
| POST /api/threads/:id/runs | 20 | 914 | 1027 |
| GET /api/threads/:id/runs/:id | 20 | 821 | 919 |
| POST /api/threads/:id/messages | 60 | 819 | 855 |
| GET /api/skills | 22 | 816 | 2255 |
| GET /api/threads/:id/lock | 41 | 799 | 835 |
| POST /api/threads | 74 | 794 | 830 |
| GET /api/threads/:id/messages | 172 | 444 | 838 |
| POST /api/negotiate | 3 | 386 | 1738 |

_ms unless noted. Per-rep raw data in the sibling .json._
