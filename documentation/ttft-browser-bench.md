# TTFT browser benchmark (real Edge session)

Run: 2026-06-30T13:57:51.925Z — https://prabinpebam.github.io/watai/ — 5 reps/prompt. TTFT = send → first assistant token in the DOM.

| prompt | n | TTFT min | TTFT median | TTFT p95 | total median |
|--|--|--|--|--|--|
| Hi | 5 | 3849 | 5762 | 10995 | 12289 |
| What is the capital of France? | 5 | 3650 | 4360 | 5089 | 10991 |
| Explain how DNS resolution works in 3 sentences. | 5 | 3704 | 4076 | 6523 | 10706 |
| Write a TypeScript debounce function. | 5 | 3732 | 4401 | 4697 | 11372 |

### Client-side API calls (median across reps)

| endpoint | calls | median ms | p95 ms |
|--|--|--|--|
| GET /api/me | 1 | 1795 | 1795 |
| GET /api/credentials | 4 | 1446 | 2305 |
| GET /api/threads | 69 | 1190 | 1777 |
| POST /api/threads/:id/runs | 20 | 919 | 1232 |
| GET /api/skills | 22 | 830 | 2272 |
| GET /api/threads/:id/runs/:id | 20 | 823 | 1102 |
| POST /api/threads/:id/messages | 57 | 817 | 897 |
| GET /api/threads/:id/lock | 43 | 798 | 824 |
| POST /api/threads | 74 | 794 | 833 |
| GET /api/threads/:id/messages | 171 | 445 | 855 |
| POST /api/negotiate | 3 | 397 | 1787 |

_ms unless noted. Per-rep raw data in the sibling .json._
