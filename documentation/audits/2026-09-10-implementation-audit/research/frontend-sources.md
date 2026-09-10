# Frontend primary-source register

**Access date for every source: 2026-09-10.** Eleven sources were fetched and read. “Current” means the available primary page was consulted, not that every newer publication was discovered. Dates below are included only where page text/metadata was verified. Undated pages are not assumed newly published. These references ground engineering criteria and proposals; none measures Watai or establishes conformance.

## F01 — Web Content Accessibility Guidelines (WCAG) 2.2

- **Publisher:** W3C. **URL:** https://www.w3.org/TR/WCAG22/
- **Verified version:** W3C Recommendation, **12 December 2024**; version URL https://www.w3.org/TR/2024/REC-WCAG22-20241212/.
- **Read/applicability:** keyboard operation, accessible names, status messages, reflow/focus, contrast, and Target Size (Minimum). Ordinary text uses the 4.5:1 AA contrast reference; target size is 24×24 CSS pixels with specified exceptions.
- **Categories:** C02.
- **Limits:** normative success criteria, not a checklist that source inspection alone can certify. A small target is not automatically a failure where an exception applies. The report's 44-pixel improvement preference is not substituted for the actual minimum.

## F02 — Dialog (Modal) Pattern

- **Publisher:** W3C WAI, ARIA Authoring Practices Guide. **URL:** https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- **Date:** no reliable publication/update date verified.
- **Read/applicability:** move focus inside on opening, contain Tab/Shift+Tab, support Escape, return focus appropriately, name the dialog, and ensure background content is actually inert before declaring modality.
- **Categories:** C02.
- **Limits:** implementation guidance, not independent WCAG certification. Complex content may appropriately omit `aria-describedby`; the recommendation is not to announce an entire lengthy dialog as one string.

## F03 — Understanding SC 4.1.3: Status Messages

- **Publisher:** W3C WAI. **URL:** https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- **Date:** no reliable publication/update date verified.
- **Read/applicability:** dynamic status must be programmatically exposed without requiring a focus move; a disappearing busy state may need an equivalent completion message. Context/atomicity matter.
- **Categories:** C01, C02.
- **Limits:** informative explanation of the criterion. It does not require every streamed token to be announced; excessive live updates can make the interface worse. Proposed reply-complete announcements require assistive-technology validation.

## F04 — VisualViewport

- **Publisher:** MDN Web Docs. **URL:** https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
- **Verified last modified:** **12 August 2026** (page footer/`datetime`).
- **Read/applicability:** distinction between layout and visual viewports, height/offset/scale, and resize/scroll events. Relevant to soft-keyboard panning and preserving browser pinch zoom.
- **Categories:** C02.
- **Limits:** API documentation, not a guarantee that Watai's fixed root or all installed-browser modes behave correctly. Feature compatibility and virtual-keyboard event order require device tests.

## F05 — Storage quotas and eviction criteria

- **Publisher:** MDN Web Docs. **URL:** https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- **Verified last modified:** **5 January 2026** (page footer/`datetime`).
- **Read/applicability:** browser-origin storage is best-effort by default; quota exceptions require handling; persistent storage changes eviction treatment; quota/eviction behavior differs by browser.
- **Categories:** C03; supporting C01 lost-input analysis.
- **Limits:** no universal available-byte budget, persistence grant, or protection against user deletion. IndexedDB storage is not automatically an archival backup or an account-ownership boundary.

## F06 — The service worker lifecycle

- **Publisher:** web.dev / Chrome guidance. **URL:** https://web.dev/articles/service-worker-lifecycle
- **Verified metadata:** `dateModified` **2016-09-29**. This is long-standing lifecycle guidance, not a claimed 2026 revision.
- **Read/applicability:** install readiness, version-specific caches, controlled clients, waiting/activation, and risks of premature `skipWaiting()`/`clients.claim()`. An application shell cache is separate from IndexedDB records.
- **Categories:** C03.
- **Limits:** does not say every installable application must implement a service worker, nor prescribe caching authenticated APIs. Browser installation criteria are not audited by this source. Lifecycle principles inform a proposed rollout, not an existing Watai implementation.

## F07 — useEffect

- **Publisher:** React documentation. **URL:** https://react.dev/reference/react/useEffect
- **Date:** no reliable publication/update date verified.
- **Read/applicability:** synchronize external systems; cleanup mirrors setup on change/unmount; development Strict Mode intentionally stresses cleanup. Relevant to media capture, subscriptions, and asynchronous result ownership.
- **Categories:** C03; supporting C01 recovery.
- **Limits:** does not provide database transaction guarantees or require a particular query library. Development-only double setup is not represented as evidence of production incidence.

## F08 — Caching in MSAL.js

- **Publisher:** Microsoft Learn. **URL:** https://learn.microsoft.com/en-us/entra/msal/javascript/browser/caching
- **Verified updated:** **15 March 2026** (`ms.date`, `updated_at`).
- **Read/applicability:** local/session/memory cache tradeoffs; local storage shares authentication artifacts across tabs; use public MSAL account/token APIs rather than depending on internal cache entities. MSAL v4 encryption limits artifact persistence, not exposure to arbitrary same-origin script.
- **Categories:** C03.
- **Limits:** provider guidance on authentication artifacts, not Watai's IndexedDB/draft ownership. The audit does not call localStorage intrinsically exploitable or assume clearing MSAL clears application data.

## F09 — Interaction to Next Paint (INP)

- **Publisher:** web.dev. **URL:** https://web.dev/articles/inp
- **Verified published:** **6 May 2022**; **last updated 2 September 2025**.
- **Read/applicability:** interaction responsiveness throughout a visit; next-paint feedback; good INP ≤200 ms at the 75th percentile, segmented by mobile/desktop; laboratory and field evidence differ.
- **Categories:** C03; supports the broader performance handoff.
- **Limits:** INP is not complete network task latency or model time-to-first-token. The proposed threshold is not a measured Watai result; synthetic tests cannot replace representative field evidence.

## F10 — MediaDevices: getUserMedia() method

- **Publisher:** MDN Web Docs. **URL:** https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- **Verified last modified:** **30 November 2025** (page footer/`datetime`).
- **Read/applicability:** secure-context and permission requirements; returned MediaStream; permission/device failures; the permission promise may remain unsettled indefinitely if ignored.
- **Categories:** C01, C02.
- **Limits:** permission alone does not implement a trustworthy mute/cancel state machine. Device handling, delayed resolution after unmount, and browser indicators must be tested; no real microphone was accessed in this audit.

## F11 — 10 Usability Heuristics for User Interface Design

- **Publisher/author:** Nielsen Norman Group / Jakob Nielsen. **URL:** https://www.nngroup.com/articles/ten-usability-heuristics/
- **Verified metadata:** published **24 April 1994**, modified **20 August 2026**. The page also describes the 2020 explanatory revision; metadata does not establish the extent of the 2026 changes.
- **Read/applicability:** system-status visibility, user control, consistency, error prevention, recognition, and constructive recovery. Grounds accurate “temporary,” “mute,” “test,” and export labeling.
- **Categories:** C01; supporting C02/C03 interaction consequences.
- **Limits:** primary heuristic guidance, not controlled user research on Watai or a quantitative scoring formula. The /10 ratings are the auditor's explicit judgments.

## Retrieval and category coverage

The web-fetch simplifier returned only titles for three MDN pages and nonrepresentative sections for WCAG. The same public URLs were therefore fetched with Python's standard-library HTTP client and parsed in memory to read substantive text/date metadata. No repository code or user content was uploaded. React returned its official textual document. No inaccessible source is counted as read.

| Scored category | Direct supporting sources |
| --- | --- |
| C01 Product and interaction UX | F03, F10, F11 |
| C02 Accessibility and mobile resilience | F01, F02, F03, F04, F10 |
| C03 Client architecture and offline consistency | F05, F06, F07, F08, F09 |
