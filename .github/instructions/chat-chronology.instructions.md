---
description: "Non-negotiable chat chronology and rendering invariants, including every intermediate state."
applyTo: "src/features/chat/**,src/data/**,src/lib/types.ts,api/src/application/run*.ts,api/src/application/message*.ts,api/src/adapters/**/messageStore.ts,api/src/ports/messageStore.ts,tests/e2e/**"
---

# Preserve Every Chat State

- Chat chronology is a primary product contract, not cosmetic polish. A submitted
  prompt must precede its own response in every observable intermediate render.
- A one-frame inversion, disappearing prompt, or later correction that jumps the
  conversation is a release blocker. Final-state correctness does not excuse it.
- Respect established rendering, logical createdAt/orderAt, multi-device chronology,
  optimistic turns, streaming overlays, persistence, reconciliation and scroll behavior.
  Read the controlling path and neighboring tests before changing it.
- Never repair this with role grouping, pinning every response to the bottom,
  arbitrary timestamp replacement, hiding transient content or delaying rendering.
- Reproduce races with delayed reads/writes and server responses. Observe every
  committed React render and meaningful DOM/frame state from submit through streaming
  and completion. Assert order and visibility continuously, not only after settling.
- Keep repairs local. Do not refactor chat rendering or adjust unrelated UI behavior
  during a chronology incident. Stop other work when the user escalates this invariant.