# Archived specifications

These documents describe **superseded** versions of Watai's architecture. They are kept
for historical reference and to explain why the current design looks the way it does.

## Why these were archived — the 2026 direction change

Watai began as a **BYO-key, client-side** app: the user's Azure OpenAI key lived only in
the browser, and **all generation (chat, image, voice, tools) ran in the browser tab**.
That model had a fatal experience flaw on mobile: a long-running generation (especially
image generation) is bound to the page, so **locking the phone, switching apps, closing
the tab, or a Wi‑Fi↔cellular handover kills the in-flight request** — leading to a high
failure rate that desktop never sees.

The product now requires that **once a prompt is submitted, generation completes and is
stored server-side regardless of the client** — the user can close the app and find the
finished message when they return. Achieving that forces a defining change: the Azure
OpenAI (and Tavily) credentials must move **server-side** (a server worker cannot use a
key that only exists in a browser). We accept that trade and store credentials encrypted
on the server, synced across all of a user's devices, with strict security controls.

## Index

| Archived file | Superseded by |
| --- | --- |
| [02-architecture-v1-byo-client.md](02-architecture-v1-byo-client.md) | [../02-architecture.md](../02-architecture.md) |
| [03-api-integration-v1-byo-client.md](03-api-integration-v1-byo-client.md) | [../03-api-integration.md](../03-api-integration.md) + [../06-server-runs-and-migration.md](../06-server-runs-and-migration.md) |

The current source of truth for the new direction is
[../06-server-runs-and-migration.md](../06-server-runs-and-migration.md).
