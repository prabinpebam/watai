# Production milestones

Each file records one real-app milestone: exact frontend/backend identities, retained rollback targets, automated smoke evidence, and a short manual validation checklist.

Release order is backend-compatible code first, production API smoke second, frontend promotion third, and public-shell smoke last. Rollback restores code only; current data, consent, deletion, privacy, and migration ledgers remain authoritative.